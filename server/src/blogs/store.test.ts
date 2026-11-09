/**
 * The blog ingest writes through the same pool as the issue crawl, so the same CleaningClient
 * cleans its parameters. No Postgres needed: test/fakeDb.ts records what would be sent.
 */
import { describe, expect, it, vi } from 'vitest';
import { createBlogStore } from '../db/stores.js';
import { fakeDb, pgError, sentStrings } from '../test/fakeDb.js';
import type { ParsedPost } from './feed.js';

const NUL = '\u0000';
const post = (overrides: Partial<ParsedPost> = {}): ParsedPost => ({
  url: 'https://blog.test/a',
  title: 'A post',
  publishedAt: new Date('2026-11-01T00:00:00Z'),
  excerpt: 'Short excerpt.',
  tags: ['rust'],
  repos: ['acme/app'],
  ...overrides,
});

describe('blog ingest writes: NUL in any text field', () => {
  it.each<[string, Partial<ParsedPost>]>([
    ['url', { url: `https://blog.test/a${NUL}` }],
    ['title', { title: `A ${NUL}post` }],
    ['excerpt', { excerpt: `Short${NUL} excerpt.` }],
    ['tags[]', { tags: [`ru${NUL}st`, 'security'] }],
    ['repos[]', { repos: [`acme/a${NUL}pp`] }],
  ])('%s: nothing sent to Postgres contains NUL', async (_field, overrides) => {
    const { pool, client } = fakeDb();
    client.respond = () => ({ rows: [{ inserted: true }] });
    const result = await createBlogStore(pool, () => {}).upsertPosts(1, [post(overrides)]);
    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 0 });
    expect(sentStrings(client.sent).filter((s) => s.includes(NUL))).toEqual([]);
  });

  it('cleans the error message stored on a failing source', async () => {
    const { pool, client } = fakeDb();
    await createBlogStore(pool, () => {}).markFetched(1, `HTTP 500${NUL}`);
    expect(client.sent[0]!.values).toEqual([1, 'HTTP 500']);
  });
});

describe('blog ingest writes: one bad post never drops the feed', () => {
  it('retries post by post on a data/constraint error, logging and skipping only the bad one', async () => {
    const { pool, client } = fakeDb();
    client.fail = (_text, values) => (values.includes('https://blog.test/bad') ? pgError('23514', 'check constraint') : undefined);
    client.respond = (_text, values) => ({ rows: Array.from({ length: values.length / 7 }, () => ({ inserted: true })) });
    const log = vi.fn();

    const result = await createBlogStore(pool, log).upsertPosts(1, [
      post({ url: 'https://blog.test/a' }),
      post({ url: 'https://blog.test/bad' }),
      post({ url: 'https://blog.test/c' }),
    ]);

    expect(result).toEqual({ inserted: 2, updated: 0, skipped: 1 });
    expect(log).toHaveBeenCalledWith('Skipped blog post https://blog.test/bad: 23514: check constraint');
  });

  it('still throws on errors that are not about the post data', async () => {
    const { pool, client } = fakeDb();
    client.fail = () => pgError('57P01', 'terminating connection');
    await expect(createBlogStore(pool, () => {}).upsertPosts(1, [post()])).rejects.toThrow('terminating connection');
  });
});
