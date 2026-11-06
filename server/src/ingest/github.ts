export interface GitHubLabel {
  name: string;
}

export interface GitHubSearchIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  repository_url: string; // https://api.github.com/repos/{owner}/{name}
  body: string | null;
  labels: (GitHubLabel | string)[];
  comments: number;
  state: string;
  assignee: { login: string } | null;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

/** Shape of GET /repos/{owner}/{repo}/issues/{number}: the fields we use match search items. */
export type GitHubIssue = GitHubSearchIssue;

const GONE_STATUSES = new Set([404, 410, 451]);

export interface SearchPage {
  totalCount: number;
  incomplete: boolean;
  items: GitHubSearchIssue[];
}

export interface GitHubClientOptions {
  token?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
  /**
   * Minimum gap between requests. Defaults suit the search API (30 req/min with a token, 10 without);
   * use a separate client with a smaller gap for core endpoints such as getIssue.
   */
  minIntervalMs?: number;
  maxRetries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GitHubClient {
  private readonly token?: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private lastRequestAt = -Infinity;
  requestCount = 0;

  constructor(opts: GitHubClientOptions = {}) {
    this.token = opts.token;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.minIntervalMs = opts.minIntervalMs ?? (opts.token ? 2100 : 6100);
    this.maxRetries = opts.maxRetries ?? 6;
  }

  async searchIssues(query: string, page: number, perPage = 100): Promise<SearchPage> {
    const url = new URL('https://api.github.com/search/issues');
    url.searchParams.set('q', query);
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));

    const body = (await this.request(url.toString())) as {
      total_count: number;
      incomplete_results: boolean;
      items: GitHubSearchIssue[];
    };
    return { totalCount: body.total_count, incomplete: body.incomplete_results, items: body.items };
  }

  /**
   * Fetches a single issue from the core REST API (5000 req/hr with a token).
   * Returns null when it is gone: deleted (410), not found or repo removed or private (404),
   * or blocked (451). Transferred issues redirect, so the result can belong to a different repo.
   */
  async getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue | null> {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`;
    return (await this.request(url, { goneOk: true })) as GitHubIssue | null;
  }

  private async request(url: string, opts: { goneOk?: boolean } = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-issue-matcher',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
      this.requestCount++;

      const res = await this.fetchFn(url, { headers });

      if (res.ok) {
        // Proactively pause when the window is exhausted, so the next call doesn't 403.
        if (res.headers.get('x-ratelimit-remaining') === '0') {
          const ms = this.msUntilReset(res.headers);
          this.log(`Rate limit window exhausted; sleeping ${Math.ceil(ms / 1000)}s`);
          await this.sleep(ms);
        }
        return res.json();
      }

      if (opts.goneOk && GONE_STATUSES.has(res.status)) return null;

      const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        const text = await res.text().catch(() => '');
        throw new Error(`GitHub ${res.status} for ${url}: ${text.slice(0, 300)}`);
      }

      const ms = this.backoffMs(res, attempt);
      this.log(`GitHub ${res.status}; retry ${attempt + 1}/${this.maxRetries} in ${Math.ceil(ms / 1000)}s`);
      await this.sleep(ms);
    }
  }

  private msUntilReset(headers: Headers): number {
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (!Number.isFinite(reset) || reset <= 0) return 60_000;
    return Math.max(reset * 1000 - this.now(), 0) + 1000;
  }

  private backoffMs(res: Response, attempt: number): number {
    const retryAfter = Number(res.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    if (res.headers.get('x-ratelimit-remaining') === '0') return this.msUntilReset(res.headers);
    if (res.status >= 500) return 2 ** attempt * 1000;
    // Secondary rate limit without hints: GitHub recommends waiting at least a minute.
    return 60_000 * (attempt + 1);
  }
}
