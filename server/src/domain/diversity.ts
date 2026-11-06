/** Default cap on issues from one repo within a single page of results. */
export const MAX_PER_REPO_PER_PAGE = 2;

/**
 * Reorders a ranked list so that each page of `pageSize` holds at most `maxPerRepo` items from
 * any one repo. Extras are deferred to later pages in their original rank order; nothing is
 * dropped, so the output is a permutation of the input.
 *
 * When too few distinct repos remain to fill a page within the cap (e.g. the tail is all one
 * repo), the page is topped up with deferred items in rank order. Page sizes stay constant, so
 * the cap is relaxed only where it can't be met.
 *
 * Pure: page boundaries depend on `pageSize`, so call it with the same page size you paginate with.
 */
export function diversifyByRepo<T>(
  items: readonly T[],
  repoOf: (item: T) => string,
  pageSize: number,
  maxPerRepo = MAX_PER_REPO_PER_PAGE,
): T[] {
  if (pageSize < 1) throw new RangeError('pageSize must be >= 1');
  if (maxPerRepo < 1) throw new RangeError('maxPerRepo must be >= 1');

  const out: T[] = [];
  let pending = items.slice();

  while (pending.length > 0) {
    const counts = new Map<string, number>();
    const page: T[] = [];
    const deferred: T[] = [];

    for (const item of pending) {
      if (page.length === pageSize) {
        deferred.push(item);
        continue;
      }
      const repo = repoOf(item);
      const n = counts.get(repo) ?? 0;
      if (n < maxPerRepo) {
        counts.set(repo, n + 1);
        page.push(item);
      } else {
        deferred.push(item);
      }
    }

    // Every remaining item was scanned and the page still has room: only over-cap repos are left.
    let taken = 0;
    while (page.length < pageSize && taken < deferred.length) page.push(deferred[taken++]!);

    out.push(...page);
    pending = taken > 0 ? deferred.slice(taken) : deferred;
  }

  return out;
}
