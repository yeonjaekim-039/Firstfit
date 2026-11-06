import { describe, expect, it } from 'vitest';
import { diversifyByRepo } from './diversity.js';

interface Item {
  id: number;
  repo: string;
}

/** Builds items from a repo sequence: 'aab' -> [{1,a},{2,a},{3,b}]. */
const items = (repos: string): Item[] => [...repos].map((repo, i) => ({ id: i + 1, repo }));
const run = (list: Item[], pageSize: number, max = 2) => diversifyByRepo(list, (i) => i.repo, pageSize, max);
const repos = (list: Item[]) => list.map((i) => i.repo).join('');
const pages = (list: Item[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, p) => list.slice(p * size, (p + 1) * size));

describe('diversifyByRepo', () => {
  it('leaves an already-diverse list untouched', () => {
    const list = items('abcdabcd');
    expect(run(list, 4)).toEqual(list);
  });

  it('caps each repo at 2 per page and pushes extras to the next page', () => {
    // Page size 4: "aaaa bbcc" -> page 1 can take a,a then b,b; the 3rd/4th a move down.
    const out = run(items('aaaabbcc'), 4);
    expect(repos(out)).toBe('aabbaacc');
    expect(out.map((i) => i.id)).toEqual([1, 2, 5, 6, 3, 4, 7, 8]);
  });

  it('keeps rank order among selected items and among deferred items', () => {
    const out = run(items('aaabbbcdef'), 5);
    expect(out.map((i) => i.id)).toEqual([1, 2, 4, 5, 7, 3, 6, 8, 9, 10]);
  });

  it('never drops or duplicates items (output is a permutation)', () => {
    const list = items('aaaaaaabbbbbcccdde');
    const out = run(list, 3);
    expect(out).toHaveLength(list.length);
    expect(new Set(out.map((i) => i.id))).toEqual(new Set(list.map((i) => i.id)));
  });

  it('satisfies the cap on every page whenever enough distinct repos remain', () => {
    // 40 items over 8 repos, heavily clustered at the top.
    const list = items('aaaaaaaabbbbbbbbccccccddddddeeeeffffgghh');
    const out = run(list, 8);
    for (const page of pages(out, 8)) {
      const counts = new Map<string, number>();
      for (const i of page) counts.set(i.repo, (counts.get(i.repo) ?? 0) + 1);
      const distinctLeft = new Set(page.map((i) => i.repo)).size;
      // A page only exceeds the cap if it had to (fewer than pageSize/2 distinct repos available).
      if (distinctLeft * 2 >= page.length) expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    }
  });

  it('fills pages with over-cap items when only one repo is left, rather than leaving gaps', () => {
    const out = run(items('aaaaab'), 4);
    // Page 1: a,a,b then only "a"s remain -> top up with a; page 2: the remaining a's.
    expect(repos(out)).toBe('aaba' + 'aa');
    expect(pages(out, 4).map((p) => p.length)).toEqual([4, 2]);
  });

  it('applies the cap per page, so a repo can reappear on later pages', () => {
    const out = run(items('aaaaaabcdefghij'), 5);
    for (const page of pages(out, 5)) {
      expect(page.filter((i) => i.repo === 'a').length).toBeLessThanOrEqual(2);
    }
  });

  it('respects a custom cap and page size 1', () => {
    expect(repos(run(items('aaabbb'), 6, 1))).toBe('ab' + 'aabb');
    expect(run(items('aab'), 1)).toEqual(items('aab'));
  });

  it('handles empty input and rejects bad arguments', () => {
    expect(run([], 20)).toEqual([]);
    expect(() => run(items('a'), 0)).toThrow(RangeError);
    expect(() => run(items('a'), 5, 0)).toThrow(RangeError);
  });

  it('does not mutate the input', () => {
    const list = items('aaab');
    const copy = list.slice();
    run(list, 2);
    expect(list).toEqual(copy);
  });
});
