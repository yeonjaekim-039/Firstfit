import type { GitHubSearchIssue, SearchPage } from './github.js';
import { buildQuery, type DateWindow, SEARCH_RESULT_CAP, splitWindow } from './queries.js';

export interface SearchClient {
  searchIssues(query: string, page: number, perPage?: number): Promise<SearchPage>;
}

export interface CrawlOptions {
  client: SearchClient;
  label: string;
  language: string;
  window: DateWindow;
  onItems: (items: GitHubSearchIssue[]) => Promise<void>;
  shouldStop?: () => boolean;
  log?: (msg: string) => void;
  perPage?: number;
}

/**
 * Pages through every result for one (label, language) pair.
 * GitHub caps each query at 1000 results, so when a window reports more than that,
 * it is split by creation date and each half is crawled recursively.
 */
export async function crawl(opts: CrawlOptions): Promise<void> {
  const { client, label, language, window, onItems, shouldStop = () => false, log = () => {} } = opts;
  const perPage = opts.perPage ?? 100;
  if (shouldStop()) return;

  const query = buildQuery(label, language, window);
  const first = await client.searchIssues(query, 1, perPage);
  if (first.incomplete) log(`Incomplete results for: ${query}`);
  await onItems(first.items);

  if (first.totalCount > SEARCH_RESULT_CAP) {
    const halves = splitWindow(window);
    if (halves) {
      log(`${label} / ${language} ${window.from}..${window.to}: ${first.totalCount} results, splitting`);
      for (const half of halves) await crawl({ ...opts, window: half });
      return;
    }
    log(`Single-day window ${window.from} still has ${first.totalCount} results; taking first ${SEARCH_RESULT_CAP}`);
  }

  const lastPage = Math.ceil(Math.min(first.totalCount, SEARCH_RESULT_CAP) / perPage);
  for (let page = 2; page <= lastPage; page++) {
    if (shouldStop()) return;
    const result = await client.searchIssues(query, page, perPage);
    await onItems(result.items);
    if (result.items.length < perPage) break;
  }
}
