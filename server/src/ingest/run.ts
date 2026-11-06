/**
 * Ingestion CLI: pulls open beginner-friendly issues from the GitHub search API into Postgres,
 * then re-checks open issues the crawl didn't see so closed issues stop being shown.
 *
 *   npm run ingest                                   # all labels x all languages, then sweep
 *   npm run ingest -- --languages=Go,Rust            # crawl + sweep scoped to Go and Rust
 *   npm run ingest -- --max-issues=500               # partial crawl: sweep is skipped
 *   npm run ingest -- --recheck-only                 # sweep issues not seen in the last 24h
 *   npm run ingest -- --recheck-only --stale-before=2026-11-06T20:00:00Z
 *   npm run ingest -- --no-sweep --max-rechecks=1000
 */
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { crawl } from './crawl.js';
import { GitHubClient } from './github.js';
import { mapIssue } from './mapIssue.js';
import { fullWindow, LABELS, LANGUAGES } from './queries.js';
import { sweepStale } from './sweep.js';
import { upsertBatch } from './upsert.js';

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function main() {
  const { values } = parseArgs({
    options: {
      languages: { type: 'string' },
      labels: { type: 'string' },
      'max-issues': { type: 'string' },
      'recheck-only': { type: 'boolean', default: false },
      'no-sweep': { type: 'boolean', default: false },
      'stale-before': { type: 'string' },
      'max-rechecks': { type: 'string', default: '3000' },
    },
  });
  const split = (s?: string) => s?.split(',').map((x) => x.trim()).filter(Boolean);
  const languageArg = split(values.languages);
  const languages = languageArg ?? LANGUAGES;
  const labels = split(values.labels) ?? LABELS;
  const maxIssues = values['max-issues'] ? Number(values['max-issues']) : Infinity;
  const maxRechecks = Number(values['max-rechecks']);

  if (!config.githubToken) {
    log('WARNING: GITHUB_TOKEN is not set. Unauthenticated search is limited to 10 requests/minute.');
  }

  // Use the DB clock so the cutoff compares cleanly with ingested_at (set by now()).
  const { rows: clock } = await pool.query<{ now: Date }>('SELECT now()');
  const runStartedAt = clock[0]!.now;

  if (!values['recheck-only']) {
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
    log(`Crawl done. Upserted ${seen.size} distinct issues.`);
  }

  // Unseen means "maybe closed" only when the crawl covered every target label without a cap.
  const fullCoverage = labels.length === LABELS.length && LABELS.every((l) => labels.includes(l));
  const sweepable = values['recheck-only'] || (fullCoverage && maxIssues === Infinity);
  if (values['no-sweep']) {
    log('Skipping stale-issue sweep (--no-sweep).');
  } else if (!sweepable) {
    log('Skipping stale-issue sweep: partial crawl (--labels or --max-issues). Run with --recheck-only later.');
  } else {
    const cutoff = values['recheck-only']
      ? values['stale-before']
        ? new Date(values['stale-before'])
        : new Date(runStartedAt.getTime() - 24 * 3600_000)
      : runStartedAt;
    if (Number.isNaN(cutoff.getTime())) throw new Error(`Invalid --stale-before: ${values['stale-before']}`);

    // Core API: 5000 req/hr with a token (~0.72s apart); 60/hr without.
    const fetcher = new GitHubClient({ token: config.githubToken, log, minIntervalMs: config.githubToken ? 750 : 60_000 });
    const result = await sweepStale({
      pool,
      fetcher,
      cutoff,
      languages: languageArg,
      targetLabels: LABELS,
      maxChecks: maxRechecks,
      log,
    });
    log(
      `Sweep done: checked ${result.checked} (closed ${result.closed}, delisted ${result.delisted}, ` +
        `still open ${result.refreshed}); ${result.remaining} left for the next run.`,
    );
  }

  const { rows } = await pool.query<{ state: string; count: string }>(
    'SELECT state, count(*) FROM issues GROUP BY state ORDER BY state',
  );
  log(`issues table: ${rows.map((r) => `${r.state}=${r.count}`).join(', ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
