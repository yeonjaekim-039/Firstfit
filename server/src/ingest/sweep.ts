import type pg from 'pg';
import type { Difficulty } from '../domain/types.js';
import { computeDifficulty } from './difficulty.js';
import type { GitHubIssue } from './github.js';
import { normalizeLabels, parseRepoUrl, pgText } from './mapIssue.js';

/** Issues still marked open that the latest crawl did not return. */
export interface StaleIssue {
  id: number;
  owner: string;
  repo: string;
  number: number;
}

export type Reconciliation =
  | { action: 'close'; reason: 'gone' | 'transferred' | 'closed' }
  | { action: 'delist' }
  | {
      action: 'refresh';
      title: string;
      labels: string[];
      assignee: string | null;
      commentCount: number;
      bodyLength: number;
      difficulty: Difficulty;
      updatedAt: string;
    };

/**
 * Decides what to do with a stored open issue after re-fetching it from GitHub.
 * Pure: no I/O.
 */
export function reconcile(stored: StaleIssue, fetched: GitHubIssue | null, targetLabels: string[]): Reconciliation {
  if (!fetched) return { action: 'close', reason: 'gone' };

  // Transferred issues redirect to their new home, which has a different repo and number.
  const { owner, name } = parseRepoUrl(fetched.repository_url);
  const moved =
    owner.toLowerCase() !== stored.owner.toLowerCase() ||
    name.toLowerCase() !== stored.repo.toLowerCase() ||
    fetched.number !== stored.number;
  if (moved) return { action: 'close', reason: 'transferred' };

  if (fetched.state !== 'open') return { action: 'close', reason: 'closed' };

  const labels = normalizeLabels(fetched.labels);
  const targets = new Set(targetLabels.map((l) => l.toLowerCase()));
  if (!labels.some((l) => targets.has(l))) return { action: 'delist' };

  const bodyLength = fetched.body?.length ?? 0;
  return {
    action: 'refresh',
    title: pgText(fetched.title),
    labels,
    assignee: fetched.assignee ? pgText(fetched.assignee.login) : null,
    commentCount: fetched.comments,
    bodyLength,
    difficulty: computeDifficulty({ labels, commentCount: fetched.comments, bodyLength }),
    updatedAt: fetched.updated_at,
  };
}

export interface IssueFetcher {
  getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue | null>;
}

export interface SweepOptions {
  pool: pg.Pool;
  fetcher: IssueFetcher;
  /** Open issues whose ingested_at (last seen in search) is before this are re-checked. */
  cutoff: Date;
  targetLabels: string[];
  /** Restrict to these languages (the scope that was just crawled). Omit for all. */
  languages?: string[];
  maxChecks: number;
  log?: (msg: string) => void;
}

export interface SweepResult {
  checked: number;
  closed: number;
  delisted: number;
  refreshed: number;
  /** Stale issues left for a later run because maxChecks was reached. */
  remaining: number;
}

export async function findStaleIssues(
  pool: pg.Pool,
  cutoff: Date,
  languages: string[] | undefined,
  limit: number,
): Promise<{ rows: StaleIssue[]; total: number }> {
  const params: unknown[] = [cutoff];
  let langClause = '';
  if (languages?.length) {
    params.push(languages.map((l) => l.toLowerCase()));
    langClause = 'AND lower(i.language) = ANY($2)';
  }
  params.push(limit);
  const { rows } = await pool.query<{ id: string; owner: string; name: string; number: number; total: string }>(
    `SELECT i.id, r.owner, r.name, i.number, count(*) OVER () AS total
       FROM issues i JOIN repos r ON r.id = i.repo_id
      WHERE i.state = 'open' AND NOT r.archived AND i.ingested_at < $1 ${langClause}
      ORDER BY i.ingested_at ASC
      LIMIT $${params.length}`,
    params,
  );
  return {
    total: rows.length ? Number(rows[0]!.total) : 0,
    rows: rows.map((r) => ({ id: Number(r.id), owner: r.owner, repo: r.name, number: r.number })),
  };
}

async function apply(pool: pg.Pool, id: number, r: Reconciliation): Promise<void> {
  if (r.action === 'close' || r.action === 'delist') {
    await pool.query('UPDATE issues SET state = $2, ingested_at = now() WHERE id = $1', [
      id,
      r.action === 'close' ? 'closed' : 'delisted',
    ]);
    return;
  }
  await pool.query(
    `UPDATE issues
        SET title = $2, labels = $3, assignee = $4, comment_count = $5, body_length = $6,
            difficulty = $7, github_updated_at = $8, state = 'open', ingested_at = now()
      WHERE id = $1`,
    [id, r.title, r.labels, r.assignee, r.commentCount, r.bodyLength, r.difficulty, r.updatedAt],
  );
}

/** Re-checks open issues the crawl didn't see, and closes, delists or refreshes each one. */
export async function sweepStale(opts: SweepOptions): Promise<SweepResult> {
  const log = opts.log ?? (() => {});
  const { rows, total } = await findStaleIssues(opts.pool, opts.cutoff, opts.languages, opts.maxChecks);
  const result: SweepResult = { checked: 0, closed: 0, delisted: 0, refreshed: 0, remaining: total - rows.length };
  if (total === 0) return result;
  log(`Re-checking ${rows.length} of ${total} open issues not seen in this run`);

  for (const stale of rows) {
    const fetched = await opts.fetcher.getIssue(stale.owner, stale.repo, stale.number);
    const r = reconcile(stale, fetched, opts.targetLabels);
    await apply(opts.pool, stale.id, r);
    result.checked++;
    if (r.action === 'close') result.closed++;
    else if (r.action === 'delist') result.delisted++;
    else result.refreshed++;
    if (result.checked % 250 === 0) log(`  re-checked ${result.checked}/${rows.length}`);
  }
  return result;
}
