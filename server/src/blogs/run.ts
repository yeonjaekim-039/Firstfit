/**
 * Blog ingest CLI: fetches every active company engineering-blog feed and upserts post
 * metadata. Safe to re-run (posts are keyed by canonical URL). Runs daily from the same
 * systemd service as the issue crawl.
 *
 *   npm run ingest:blogs                 # dev (tsx)
 *   node dist/blogs/run.js               # production image
 *
 * Exits 0 when at least one feed succeeded, 1 when every feed failed.
 */
import { pool } from '../db/pool.js';
import { createBlogStore } from '../db/stores.js';
import { ingestBlogs } from './ingest.js';

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function main() {
  const results = await ingestBlogs({ store: createBlogStore(pool, log), log });
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  log(
    `Blogs done: ${ok.length}/${results.length} feeds ok, ` +
      `${ok.reduce((n, r) => n + r.inserted, 0)} new posts, ${ok.reduce((n, r) => n + r.updated, 0)} updated` +
      (failed.length ? `; failed: ${failed.map((r) => `${r.company} (${r.error})`).join(', ')}` : ''),
  );
  return results.length > 0 && ok.length === 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
