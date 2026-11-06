import type pg from 'pg';
import type { IssueRow, RepoRow } from './mapIssue.js';

/** Builds "($1, $2, ...), ($n+1, ...)" placeholder groups for a multi-row INSERT. */
function placeholders(rowCount: number, cols: number): string {
  return Array.from({ length: rowCount }, (_, row) => {
    const group = Array.from({ length: cols }, (_, col) => '$' + (row * cols + col + 1));
    return '(' + group.join(', ') + ')';
  }).join(', ');
}

/**
 * Upserts one page of search results in a single transaction.
 * Rows are de-duplicated first: Postgres rejects an ON CONFLICT DO UPDATE
 * that touches the same row twice within one statement.
 */
export async function upsertBatch(
  pool: pg.Pool,
  repos: RepoRow[],
  issues: IssueRow[],
): Promise<number> {
  if (issues.length === 0) return 0;
  const uniqueRepos = [...new Map(repos.map((r) => [r.fullName, r])).values()];
  const uniqueIssues = [...new Map(issues.map((i) => [i.id, i])).values()];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const repoParams = uniqueRepos.flatMap((r) => [r.fullName, r.owner, r.name, r.htmlUrl, r.language]);
    const { rows: repoRows } = await client.query<{ id: number; full_name: string }>(
      `INSERT INTO repos (full_name, owner, name, html_url, language)
       VALUES ${placeholders(uniqueRepos.length, 5)}
       ON CONFLICT (full_name) DO UPDATE
         SET language = COALESCE(repos.language, EXCLUDED.language), updated_at = now()
       RETURNING id, full_name`,
      repoParams,
    );
    const repoIds = new Map(repoRows.map((r) => [r.full_name, r.id]));

    const issueParams = uniqueIssues.flatMap((iss) => [
      iss.id,
      repoIds.get(iss.repoFullName),
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
       VALUES ${placeholders(uniqueIssues.length, 14)}
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

    await client.query('COMMIT');
    return uniqueIssues.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
