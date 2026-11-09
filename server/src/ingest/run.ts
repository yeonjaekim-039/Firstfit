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
 *   npm run ingest -- --repo-meta-only               # only fetch missing/stale repo metadata
 *   npm run ingest -- --no-repo-meta --repo-max-age-days=30
 *
 * Phases: crawl -> repo metadata (stars, last push, archived; GraphQL, needs a token) -> sweep.
 */
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { crawl } from './crawl.js';
import { GitHubClient } from './github.js';
import { mapIssue } from './mapIssue.js';
import { fullWindow, LABELS, LANGUAGES } from './queries.js';
import { enrichRepos } from './repoMeta.js';
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
      'repo-meta-only': { type: 'boolean', default: false },
      'no-repo-meta': { type: 'boolean', default: false },
      'repo-max-age-days': { type: 'string', default: '7' },
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

  const repoMetaOnly = values['repo-meta-only'];

  if (!values['recheck-only'] && !repoMetaOnly) {
    const client = new GitHubClient({ token: config.githubToken, log });
    const seen = new Set<number>();
    const window = fullWindow();
    // Repos already known to be archived (or gone): don't ingest their issues.
    const { rows: archivedRows } = await pool.query<{ full_name: string }>(
      'SELECT full_name FROM repos WHERE archived',
    );
    const archived = new Set(archivedRows.map((r) => r.full_name.toLowerCase()));
    let skippedArchived = 0;
    let skippedBadRows = 0;

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
            const all = items.filter((i) => !i.pull_request).map((i) => mapIssue(i, language));
            const mapped = all.filter((m) => !archived.has(m.repo.fullName.toLowerCase()));
            skippedArchived += all.length - mapped.length;
            // A bad row is logged and skipped inside upsertBatch; it never stops the crawl.
            const { skipped } = await upsertBatch(pool, mapped.map((m) => m.repo), mapped.map((m) => m.issue), log);
            skippedBadRows += skipped;
            for (const m of mapped) seen.add(m.issue.id);
          },
        });
        log(`${language} / "${label}": +${seen.size - before} new (total ${seen.size}, ${client.requestCount} requests)`);
        if (seen.size >= maxIssues) break;
      }
      if (seen.size >= maxIssues) break;
    }
    log(
      `Crawl done. Saw ${seen.size} distinct issues; skipped ${skippedArchived} from archived repos` +
        ` and ${skippedBadRows} that failed to write (logged above).`,
    );
  }

  if (values['no-repo-meta'] || values['recheck-only']) {
    // Explicitly skipped, or a recheck-only run.
  } else if (!config.githubToken) {
    log('Skipping repo metadata: the GraphQL API requires GITHUB_TOKEN.');
  } else {
    const gql = new GitHubClient({ token: config.githubToken, log, minIntervalMs: 1000 });
    const r = await enrichRepos({ pool, client: gql, maxAgeDays: Number(values['repo-max-age-days']), log });
    log(`Repo metadata: updated ${r.fetched} (${r.archived} archived or gone), ${r.skipped} failed and will retry next run.`);
  }
  if (repoMetaOnly) return;

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
