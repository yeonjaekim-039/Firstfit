import { describe, expect, it } from 'vitest';
import { crawl, type SearchClient } from './crawl.js';
import type { GitHubSearchIssue } from './github.js';

const fakeItem = (id: number) => ({ id }) as GitHubSearchIssue;

/** Fake search backend: each issue has a creation day; queries filter by the created: range. */
function fakeClient(createdDays: string[], perPageCap = 1000) {
  const calls: { query: string; page: number }[] = [];
  const client: SearchClient = {
    async searchIssues(query, page, perPage = 100) {
      calls.push({ query, page });
      const [, from, to] = /created:(\S+)\.\.(\S+)/.exec(query)!;
      const matching = createdDays
        .map((day, i) => ({ day, id: i }))
        .filter(({ day }) => day >= from! && day <= to!);
      const capped = matching.slice(0, perPageCap);
      const items = capped.slice((page - 1) * perPage, page * perPage).map((m) => fakeItem(m.id));
      return { totalCount: matching.length, incomplete: false, items };
    },
  };
  return { client, calls };
}

describe('crawl', () => {
  it('paginates through a window under the cap', async () => {
    const days = Array.from({ length: 250 }, () => '2024-03-01');
    const { client, calls } = fakeClient(days);
    const seen: number[] = [];
    await crawl({
      client,
      label: 'easy',
      language: 'Go',
      window: { from: '2024-01-01', to: '2024-12-31' },
      onItems: async (items) => void seen.push(...items.map((i) => i.id)),
    });
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3]);
    expect(new Set(seen).size).toBe(250);
  });

  it('splits windows that exceed the 1000-result cap and recovers every issue', async () => {
    // 1500 issues: 750 in January, 750 in December.
    const days = [
      ...Array.from({ length: 750 }, () => '2024-01-15'),
      ...Array.from({ length: 750 }, () => '2024-12-15'),
    ];
    const { client } = fakeClient(days);
    const seen = new Set<number>();
    await crawl({
      client,
      label: 'easy',
      language: 'Go',
      window: { from: '2024-01-01', to: '2024-12-31' },
      onItems: async (items) => items.forEach((i) => seen.add(i.id)),
    });
    expect(seen.size).toBe(1500);
  });

  it('stops early when shouldStop returns true', async () => {
    const days = Array.from({ length: 500 }, () => '2024-03-01');
    const { client, calls } = fakeClient(days);
    let count = 0;
    await crawl({
      client,
      label: 'easy',
      language: 'Go',
      window: { from: '2024-01-01', to: '2024-12-31' },
      onItems: async (items) => void (count += items.length),
      shouldStop: () => count >= 200,
    });
    expect(calls).toHaveLength(2);
  });
});
