import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './github.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

const page = { total_count: 1, incomplete_results: false, items: [] };

function makeClient(responses: Response[], start = 1_000_000) {
  let clock = start;
  const sleeps: number[] = [];
  const fetchFn = vi.fn(async () => responses.shift()!);
  const client = new GitHubClient({
    token: 't',
    fetchFn: fetchFn as unknown as typeof fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    minIntervalMs: 0,
  });
  return { client, fetchFn, sleeps };
}

describe('GitHubClient', () => {
  it('sends auth header and search params', async () => {
    const { client, fetchFn } = makeClient([jsonResponse(page)]);
    await client.searchIssues('is:issue label:"good first issue"', 2);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe('is:issue label:"good first issue"');
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(parsed.searchParams.get('per_page')).toBe('100');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('waits for the reset time when the primary limit is hit, then retries', async () => {
    const resetEpoch = 1_000 + 30; // clock starts at 1_000_000ms = 1000s
    const { client, sleeps, fetchFn } = makeClient([
      jsonResponse({ message: 'rate limited' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetEpoch),
      }),
      jsonResponse(page),
    ]);
    const result = await client.searchIssues('q', 1);
    expect(result.totalCount).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(31_000);
  });

  it('honours retry-after on secondary rate limits', async () => {
    const { client, sleeps } = makeClient([
      jsonResponse({}, 429, { 'retry-after': '7' }),
      jsonResponse(page),
    ]);
    await client.searchIssues('q', 1);
    expect(sleeps).toContain(7_000);
  });

  it('pauses proactively after a successful response that exhausts the window', async () => {
    const { client, sleeps } = makeClient([
      jsonResponse(page, 200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(1_000 + 10) }),
    ]);
    await client.searchIssues('q', 1);
    expect(sleeps).toEqual([11_000]);
  });

  it('getIssue returns null for gone issues and throws for other errors', async () => {
    for (const status of [404, 410, 451]) {
      const { client } = makeClient([jsonResponse({ message: 'gone' }, status)]);
      await expect(client.getIssue('acme', 'widgets', 7)).resolves.toBeNull();
    }
    const { client, fetchFn } = makeClient([jsonResponse({ message: 'bad' }, 422)]);
    await expect(client.getIssue('acme', 'widgets', 7)).rejects.toThrow(/422/);
    expect(String(fetchFn.mock.calls[0]![0 as never])).toBe('https://api.github.com/repos/acme/widgets/issues/7');
  });

  it('graphql POSTs query and variables and returns partial data with errors', async () => {
    const { client, fetchFn } = makeClient([
      jsonResponse({ data: { r0: null }, errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'nf' }] }),
    ]);
    const result = await client.graphql('query($o0: String!) { r0: repository(owner: $o0) { id } }', { o0: 'a' });
    expect(result).toEqual({ data: { r0: null }, errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'nf' }] });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/graphql');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      query: 'query($o0: String!) { r0: repository(owner: $o0) { id } }',
      variables: { o0: 'a' },
    });
  });

  it('graphql retries RATE_LIMITED responses after waiting', async () => {
    const { client, sleeps } = makeClient([
      jsonResponse({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }),
      jsonResponse({ data: { ok: true } }),
    ]);
    expect(await client.graphql('{ ok }', {})).toEqual({ data: { ok: true }, errors: [] });
    expect(sleeps).toContain(60_000);
  });

  it('graphql refuses to run without a token', async () => {
    const tokenless = new GitHubClient({ fetchFn: vi.fn() as unknown as typeof fetch, minIntervalMs: 0 });
    await expect(tokenless.graphql('{ ok }', {})).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it('search still throws on 404', async () => {
    const { client } = makeClient([jsonResponse({ message: 'nope' }, 404)]);
    await expect(client.searchIssues('q', 1)).rejects.toThrow(/404/);
  });

  it('throws on non-retryable errors', async () => {
    const { client } = makeClient([jsonResponse({ message: 'bad query' }, 422)]);
    await expect(client.searchIssues('q', 1)).rejects.toThrow(/422/);
  });

  it('spaces requests by minIntervalMs', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const client = new GitHubClient({
      fetchFn: (async () => jsonResponse(page)) as unknown as typeof fetch,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      minIntervalMs: 2000,
    });
    await client.searchIssues('q', 1);
    await client.searchIssues('q', 2);
    expect(sleeps).toEqual([2000]);
  });
});
