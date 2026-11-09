import type pg from 'pg';
import { cleanText } from '../db/clean.js';
import type { IssueRow, RepoRow } from './mapIssue.js';

/** Builds "($1, $2, ...), ($n+1, ...)" placeholder groups for a multi-row INSERT. */
export function placeholders(rowCount: number, cols: number): string {
  return Array.from({ length: rowCount }, (_, row) => {
    const group = Array.from({ length: cols }, (_, col) => '$' + (row * cols + col + 1));
    return '(' + group.join(', ') + ')';
  }).join(', ');
}

/** The subset of pg.Pool that upsertBatch needs (lets tests pass a fake without a database). */
export type Connectable = Pick<pg.Pool, 'connect'>;

export interface UpsertResult {
  upserted: number;
  /** Issues that failed on their own (bad data or a constraint) and were skipped. */
  skipped: number;
}

/**
 * SQLSTATE classes caused by the row's own data: 22 = data exception (e.g. 22021 invalid
 * encoding), 23 = integrity constraint violation (e.g. 23505 unique). Retrying row by row
 * isolates these. Anything else (connection lost, syntax error) is a real failure.
 */
export function isRowDataError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && (code.startsWith('22') || code.startsWith('23'));
}

const errorText = (err: unknown) => {
  const e = err as { code?: string; message?: string; detail?: string };
  return [e.code, e.message, e.detail].filter(Boolean).join(': ');
};

async function writeRows(client: pg.PoolClient, repos: RepoRow[], issues: IssueRow[]): Promise<void> {
  const repoParams = repos.flatMap((r) => [r.fullName, r.owner, r.name, r.htmlUrl, r.language]);
  const { rows: repoRows } = await client.query<{ id: number; full_name: string }>(
    `INSERT INTO repos (full_name, owner, name, html_url, language)
     VALUES ${placeholders(repos.length, 5)}
     ON CONFLICT (full_name) DO UPDATE
       SET language = COALESCE(repos.language, EXCLUDED.language), updated_at = now()
     RETURNING id, full_name`,
    repoParams,
  );
  // RETURNING gives back the stored (cleaned) name, so look rows up by the cleaned name too.
  const repoIds = new Map(repoRows.map((r) => [r.full_name, r.id]));

  const issueParams = issues.flatMap((iss) => [
    iss.id,
    repoIds.get(cleanText(iss.repoFullName)),
    iss.number,
    iss.title,
    iss.url,
    iss.bodyLength,
    iss.labels,
    iss.language,
    iss.commentCount,
    iss.state,
    iss.assignee,
    iss.difficulty,
    iss.createdAt,
    iss.updatedAt,
  ]);
  await client.query(
    `INSERT INTO issues (id, repo_id, number, title, url, body_length, labels, language,
                         comment_count, state, assignee, difficulty, github_created_at, github_updated_at)
     VALUES ${placeholders(issues.length, 14)}
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       url = EXCLUDED.url,
       body_length = EXCLUDED.body_length,
       labels = EXCLUDED.labels,
       language = EXCLUDED.language,
       comment_count = EXCLUDED.comment_count,
       state = EXCLUDED.state,
       assignee = EXCLUDED.assignee,
       difficulty = EXCLUDED.difficulty,
       github_updated_at = EXCLUDED.github_updated_at,
       ingested_at = now()`,
    issueParams,
  );
}

async function inTransaction(client: pg.PoolClient, work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Upserts one page of search results. Parameters are cleaned (NUL removed) by the pool's
 * CleaningClient, the single shared point for every database write (db/clean.ts).
 *
 * The page goes in as one transaction. If that fails because of a row's own data (SQLSTATE
 * class 22/23), the page is retried one issue at a time so a single bad row can't drop the
 * other 99: each failing issue is logged with its repo and number, skipped, and the rest are
 * written. Rows are de-duplicated first: Postgres rejects an ON CONFLICT DO UPDATE that
 * touches the same row twice within one statement.
 */
export async function upsertBatch(
  pool: Connectable,
  repos: RepoRow[],
  issues: IssueRow[],
  log: (msg: string) => void = console.warn,
): Promise<UpsertResult> {
  if (issues.length === 0) return { upserted: 0, skipped: 0 };
  const repoByName = new Map(repos.map((r) => [r.fullName, r]));
  const uniqueRepos = [...repoByName.values()];
  const uniqueIssues = [...new Map(issues.map((i) => [i.id, i])).values()];

  const client = await pool.connect();
  try {
    try {
      await inTransaction(client, () => writeRows(client, uniqueRepos, uniqueIssues));
      return { upserted: uniqueIssues.length, skipped: 0 };
    } catch (err) {
      if (!isRowDataError(err)) throw err;
      log(`Batch of ${uniqueIssues.length} issues failed (${errorText(err)}); retrying one by one`);
    }

    const result: UpsertResult = { upserted: 0, skipped: 0 };
    for (const issue of uniqueIssues) {
      const repo = repoByName.get(issue.repoFullName);
      if (!repo) {
        result.skipped++;
        log(`Skipped issue ${issue.repoFullName}#${issue.number} (id ${issue.id}): no repo row in this batch`);
        continue;
      }
      try {
        await inTransaction(client, () => writeRows(client, [repo], [issue]));
        result.upserted++;
      } catch (err) {
        if (!isRowDataError(err)) throw err;
        result.skipped++;
        log(`Skipped issue ${issue.repoFullName}#${issue.number} (id ${issue.id}): ${errorText(err)}`);
      }
    }
    return result;
  } finally {
    client.release();
  }
}
