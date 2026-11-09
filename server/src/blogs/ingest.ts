import { fetchFeedXml, type FetchFn, parseFeed, type ParsedPost } from './feed.js';

export interface BlogSource {
  id: number;
  company: string;
  feedUrl: string;
}

/** Persistence used by the blog ingest job (pg implementation in db/stores.ts). */
export interface BlogIngestStore {
  activeSources(): Promise<BlogSource[]>;
  /** Inserts new posts and refreshes changed ones, keyed by canonical URL. Safe to repeat. */
  upsertPosts(sourceId: number, posts: ParsedPost[]): Promise<{ inserted: number; updated: number; skipped: number }>;
  /** Records a successful fetch (error = null: sets last_fetched_at) or a failure (keeps last_fetched_at). */
  markFetched(sourceId: number, error: string | null): Promise<void>;
}

export interface FeedResult {
  company: string;
  feedUrl: string;
  ok: boolean;
  error?: string;
  /** Posts in the feed after de-duplication. */
  parsed: number;
  inserted: number;
  updated: number;
  /** Posts rejected on their own (bad data or a constraint) and skipped. */
  skipped: number;
}

export interface IngestBlogsOptions {
  store: BlogIngestStore;
  fetchFn?: FetchFn;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

/** Fetches every active feed in turn. A failing feed is recorded and skipped; it never stops the run. */
export async function ingestBlogs({ store, fetchFn, timeoutMs, log = () => {} }: IngestBlogsOptions): Promise<FeedResult[]> {
  const sources = await store.activeSources();
  const results: FeedResult[] = [];

  for (const source of sources) {
    const base = { company: source.company, feedUrl: source.feedUrl };
    try {
      const xml = await fetchFeedXml(source.feedUrl, fetchFn, timeoutMs);
      const posts = await parseFeed(xml);
      if (posts.length === 0) throw new Error('feed parsed but contained no usable items');
      const { inserted, updated, skipped } = await store.upsertPosts(source.id, posts);
      await store.markFetched(source.id, null);
      results.push({ ...base, ok: true, parsed: posts.length, inserted, updated, skipped });
      log(
        `${source.company}: ${posts.length} posts in feed, ${inserted} new, ${updated} updated` +
          (skipped ? `, ${skipped} skipped (bad data, logged)` : ''),
      );
    } catch (err) {
      const message = errorMessage(err);
      results.push({ ...base, ok: false, error: message, parsed: 0, inserted: 0, updated: 0, skipped: 0 });
      log(`${source.company}: FAILED (${message}); skipping`);
      await store.markFetched(source.id, message).catch(() => {});
    }
  }
  return results;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timed out';
    // Parser errors can be long; keep the stored message short.
    return err.message.split('\n')[0]!.slice(0, 300);
  }
  return String(err).slice(0, 300);
}
