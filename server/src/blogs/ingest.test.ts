import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedPost } from './feed.js';
import { type BlogIngestStore, type BlogSource, ingestBlogs } from './ingest.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** In-memory store keyed by canonical URL, mirroring the pg upsert's semantics. */
function memoryStore(sources: BlogSource[]) {
  const posts = new Map<string, ParsedPost & { sourceId: number }>();
  const fetched: Record<number, string | null> = {};
  const store: BlogIngestStore = {
    async activeSources() {
      return sources;
    },
    async upsertPosts(sourceId, batch) {
      let inserted = 0;
      let updated = 0;
      for (const p of batch) {
        const existing = posts.get(p.url);
        if (!existing) {
          posts.set(p.url, { ...p, sourceId });
          inserted++;
        } else if (JSON.stringify({ ...existing, sourceId: undefined }) !== JSON.stringify({ ...p, sourceId: undefined })) {
          posts.set(p.url, { ...p, sourceId: existing.sourceId });
          updated++;
        }
      }
      return { inserted, updated, skipped: 0 };
    },
    async markFetched(sourceId, error) {
      fetched[sourceId] = error;
    },
  };
  return { store, posts, fetched };
}

const SOURCES: BlogSource[] = [
  { id: 1, company: 'Medium Co', feedUrl: 'https://feeds.test/medium' },
  { id: 2, company: 'Press Co', feedUrl: 'https://feeds.test/wordpress' },
  { id: 3, company: 'Broken Co', feedUrl: 'https://feeds.test/broken' },
  { id: 4, company: 'Html Co', feedUrl: 'https://feeds.test/html' },
  { id: 5, company: 'Slow Co', feedUrl: 'https://feeds.test/slow' },
];

const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
  switch (url) {
    case 'https://feeds.test/medium':
      return new Response(fixture('medium.rss.xml'));
    case 'https://feeds.test/wordpress':
      return new Response(fixture('wordpress.rss.xml'));
    case 'https://feeds.test/html':
      return new Response(fixture('not-a-feed.html'));
    case 'https://feeds.test/slow':
      // Never resolves on its own; only the timeout signal ends it.
      return new Promise<Response>((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      );
    default:
      return new Response('Not Found', { status: 404 });
  }
});

describe('ingestBlogs', () => {
  it('keeps going when individual feeds fail (404, HTML page, timeout) and records each failure', async () => {
    const { store, fetched } = memoryStore(SOURCES);
    const results = await ingestBlogs({ store, fetchFn: fakeFetch, timeoutMs: 50 });

    expect(results.map((r) => [r.company, r.ok, r.error ?? null, r.inserted])).toEqual([
      ['Medium Co', true, null, 1],
      ['Press Co', true, null, 2],
      ['Broken Co', false, 'HTTP 404', 0],
      ['Html Co', false, 'not a feed (got an HTML page)', 0],
      ['Slow Co', false, 'timed out', 0],
    ]);
    expect(fetched).toEqual({ 1: null, 2: null, 3: 'HTTP 404', 4: 'not a feed (got an HTML page)', 5: 'timed out' });
  });

  it('is safe to re-run: a second run inserts nothing new and changes nothing', async () => {
    const { store, posts } = memoryStore(SOURCES.slice(0, 2));
    const first = await ingestBlogs({ store, fetchFn: fakeFetch });
    const second = await ingestBlogs({ store, fetchFn: fakeFetch });

    expect(first.map((r) => r.inserted)).toEqual([1, 2]);
    expect(second.map((r) => [r.inserted, r.updated])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(posts.size).toBe(3);
  });

  it('de-duplicates a feed that lists the same article under tracking-parameter variants', async () => {
    const { store, posts } = memoryStore([SOURCES[0]!]);
    const [result] = await ingestBlogs({ store, fetchFn: fakeFetch });
    // medium.rss.xml lists the same article twice (once with utm_* params, "www." and a #fragment).
    expect(result!.parsed).toBe(1);
    expect([...posts.keys()]).toEqual(['https://techblog.example.com/scaling-python-pipelines-6b0811a1c015']);
  });
});
