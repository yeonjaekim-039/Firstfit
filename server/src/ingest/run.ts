/**
 * Ingestion CLI: pulls open beginner-friendly issues from the GitHub search API into Postgres.
 *
 *   npm run ingest                                   # all labels x all languages
 *   npm run ingest -- --languages=Go,Rust --labels="good first issue" --max-issues=500
 */
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { crawl } from './crawl.js';
import { GitHubClient } from './github.js';
import { mapIssue } from './mapIssue.js';
import { fullWindow, LABELS, LANGUAGES } from './queries.js';
import { upsertBatch } from './upsert.js';

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function main() {
  const { values } = parseArgs({
    options: {
      languages: { type: 'string' },
      labels: { type: 'string' },
      'max-issues': { type: 'string' },
    },
  });
  const split = (s?: string) => s?.split(',').map((x) => x.trim()).filter(Boolean);
  const languages = split(values.languages) ?? LANGUAGES;
  const labels = split(values.labels) ?? LABELS;
  const maxIssues = values['max-issues'] ? Number(values['max-issues']) : Infinity;

  if (!config.githubToken) {
    log('WARNING: GITHUB_TOKEN is not set. Unauthenticated search is limited to 10 requests/minute.');
  }
  const client = new GitHubClient({ token: config.githubToken, log });
  const seen = new Set<number>();
  const window = fullWindow();

  for (const language of languages) {
    for (const label of labels) {
      const before = seen.size;
      await crawl({
        client,
        label,
        language,
        window,
        log,
        shouldStop: () => seen.size >= maxIssues,
        onItems: async (items) => {
          const mapped = items.filter((i) => !i.pull_request).map((i) => mapIssue(i, language));
          await upsertBatch(pool, mapped.map((m) => m.repo), mapped.map((m) => m.issue));
          for (const m of mapped) seen.add(m.issue.id);
        },
      });
      log(`${language} / "${label}": +${seen.size - before} new (total ${seen.size}, ${client.requestCount} requests)`);
      if (seen.size >= maxIssues) break;
    }
    if (seen.size >= maxIssues) break;
  }

  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM issues');
  log(`Done. Upserted ${seen.size} distinct issues this run; issues table now has ${rows[0]!.count} rows.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
