import { describe, expect, it, vi } from 'vitest';
import { fakeDb, pgError, sentStrings } from '../test/fakeDb.js';
import type { IssueRow, RepoRow } from './mapIssue.js';
import { isRowDataError, upsertBatch } from './upsert.js';

const repo = (overrides: Partial<RepoRow> = {}): RepoRow => ({
  fullName: 'acme/app',
  owner: 'acme',
  name: 'app',
  htmlUrl: 'https://github.com/acme/app',
  language: 'Ruby',
  ...overrides,
});

const issue = (overrides: Partial<IssueRow> = {}): IssueRow => {
  const id = overrides.id ?? 1;
  return {
    id,
    repoFullName: 'acme/app',
    number: id,
    title: `Issue ${id}`,
    url: `https://github.com/acme/app/issues/${id}`,
    bodyLength: 10,
    labels: ['good first issue'],
    language: 'Ruby',
    commentCount: 0,
    state: 'open',
    assignee: null,
    difficulty: 'easy',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    ...overrides,
  };
};

const NUL = '\u0000';
const issueInsert = (sent: { text: string; values: unknown[] }[]) => sent.find((q) => q.text.includes('INSERT INTO issues'))!;

describe('upsertBatch: NUL in any written text field', () => {
  // Every text column the crawl writes, for both tables.
  const cases: [string, RepoRow, IssueRow][] = [
    ['repos.full_name (and the issue → repo link)', repo({ fullName: `acme/a${NUL}pp` }), issue({ repoFullName: `acme/a${NUL}pp` })],
    ['repos.owner', repo({ owner: `ac${NUL}me` }), issue()],
    ['repos.name', repo({ name: `a${NUL}pp` }), issue()],
    ['repos.html_url', repo({ htmlUrl: `https://github.com/acme/app${NUL}` }), issue()],
    ['repos.language', repo({ language: `Ru${NUL}by` }), issue()],
    ['issues.title', repo(), issue({ title: `Crash on ${NUL} in input` })],
    ['issues.url', repo(), issue({ url: `https://github.com/acme/app/issues/1${NUL}` })],
    ['issues.labels[]', repo(), issue({ labels: [`bug${NUL}`, `good first issue${NUL}`] })],
    ['issues.language', repo(), issue({ language: `Ru${NUL}by` })],
    ['issues.state', repo(), issue({ state: `open${NUL}` })],
    ['issues.assignee', repo(), issue({ assignee: `oct${NUL}ocat` })],
    ['issues.difficulty', repo(), issue({ difficulty: `easy${NUL}` as IssueRow['difficulty'] })],
  ];

  it.each(cases)('%s: nothing sent to Postgres contains NUL, and the row is written', async (_field, r, i) => {
    const { pool, client } = fakeDb();
    const result = await upsertBatch(pool, [r], [i], () => {});

    expect(result).toEqual({ upserted: 1, skipped: 0 });
    expect(sentStrings(client.sent).filter((s) => s.includes(NUL))).toEqual([]);
    // The issue still points at its repo (repo_id is the 2nd column), even when the name was cleaned.
    expect(issueInsert(client.sent).values[1]).toBe(100);
  });
});

describe('upsertBatch: one bad row never drops the batch', () => {
  const issues = [1, 2, 3].map((id) => issue({ id }));
  /** Fails any issues INSERT that includes issue id 2 (as a duplicate key would). */
  const failOnIssue2 = (code: string) => (text: string, values: unknown[]) =>
    text.includes('INSERT INTO issues') && values.includes(2) ? pgError(code, 'duplicate key value') : undefined;

  it.each(['23505', '22021'])('retries row by row on %s, skips and logs only the bad issue', async (code) => {
    const { pool, client } = fakeDb();
    client.fail = failOnIssue2(code);
    const log = vi.fn();

    const result = await upsertBatch(pool, [repo()], issues, log);

    expect(result).toEqual({ upserted: 2, skipped: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Batch of 3 issues failed/));
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`Skipped issue acme/app#2 (id 2): ${code}`));
    // Issues 1 and 3 were each committed on their own.
    const committedIssueIds = client.sent
      .filter((q) => q.text.includes('INSERT INTO issues') && !q.values.includes(2))
      .map((q) => q.values[0]);
    expect(committedIssueIds).toEqual([1, 3]);
    expect(client.sent.filter((q) => q.text === 'COMMIT')).toHaveLength(2);
    expect(client.released).toBe(true);
  });

  it('writes the whole page in one transaction when nothing is wrong', async () => {
    const { pool, client } = fakeDb();
    const log = vi.fn();
    expect(await upsertBatch(pool, [repo()], issues, log)).toEqual({ upserted: 3, skipped: 0 });
    expect(client.sent.map((q) => q.text.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'BEGIN',
      'INSERT INTO repos',
      'WITH incoming AS',
      'INSERT INTO issues',
      'COMMIT',
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it('still fails the run on errors that are not about the row data (e.g. a lost connection)', async () => {
    const { pool, client } = fakeDb();
    client.fail = (text) => (text.includes('INSERT INTO issues') ? pgError('57P01', 'terminating connection') : undefined);
    await expect(upsertBatch(pool, [repo()], issues, () => {})).rejects.toThrow('terminating connection');
    expect(client.released).toBe(true);
  });

  it('de-duplicates issues within a page before writing', async () => {
    const { pool, client } = fakeDb();
    await upsertBatch(pool, [repo(), repo()], [issue({ id: 1 }), issue({ id: 1 })], () => {});
    expect(issueInsert(client.sent).values).toHaveLength(14);
  });
});

describe('upsertBatch: an issue GitHub re-created under a new id', () => {
  // Stored as id 501; GitHub now returns the same repo and number as id 9001.
  const recreated = issue({ id: 9001, number: 1, title: 'Re-created issue' });

  /**
   * A tiny stand-in for the issues table and its UNIQUE (repo_id, number): the stale-id UPDATE
   * moves the row, and the INSERT fails with 23505 if any stored row still holds the same
   * repo and number under another id (exactly the error the crawl used to log every day).
   */
  function withStoredIssue() {
    const db = fakeDb();
    const stored = new Map<number, { repoId: number; number: number }>([[501, { repoId: 100, number: 1 }]]);
    let snapshot = new Map(stored);
    db.client.respond = (text, values) => {
      if (text === 'BEGIN') snapshot = new Map(stored);
      if (text === 'ROLLBACK') {
        stored.clear();
        snapshot.forEach((row, id) => stored.set(id, row));
      }
      if (!text.includes('WITH incoming AS')) return undefined;
      const [repoIds, numbers, ids] = values as number[][];
      const rows: { old_id: string; new_id: string }[] = [];
      ids!.forEach((id, k) => {
        for (const [oldId, row] of stored) {
          if (oldId !== id && row.repoId === repoIds![k] && row.number === numbers![k]) {
            stored.delete(oldId);
            stored.set(id, row);
            rows.push({ old_id: String(oldId), new_id: String(id) });
          }
        }
      });
      return { rows };
    };
    db.client.fail = (text, values) => {
      if (!text.includes('INSERT INTO issues')) return undefined;
      const [id, repoId, number] = values as number[];
      for (const [storedId, row] of stored) {
        if (storedId !== id && row.repoId === repoId && row.number === number) {
          return pgError('23505', 'duplicate key value violates unique constraint "issues_repo_id_number_key"');
        }
      }
      return undefined;
    };
    return { ...db, stored };
  }

  it('replaces the stale row instead of skipping the issue', async () => {
    const { pool, client, stored } = withStoredIssue();
    const log = vi.fn();

    const result = await upsertBatch(pool, [repo()], [recreated], log);

    expect(result).toEqual({ upserted: 1, skipped: 0 });
    expect([...stored.keys()]).toEqual([9001]);
    expect(log).toHaveBeenCalledExactlyOnceWith('Replaced stale issue acme/app#1: id 501 → 9001 (re-created on GitHub)');
    // The stale row is moved before the insert, in the same transaction, matched on (repo_id, number).
    const texts = client.sent.map((q) => q.text.trim().split(/\s+/).slice(0, 3).join(' '));
    expect(texts).toEqual(['BEGIN', 'INSERT INTO repos', 'WITH incoming AS', 'INSERT INTO issues', 'COMMIT']);
    expect(client.sent[2]!.values).toEqual([[100], [1], [9001]]);
    // Saved issues move with it rather than being cascade-deleted.
    expect(client.sent[2]!.text).toMatch(/UPDATE saved_issues s SET issue_id = stale\.new_id/);
    expect(client.sent[2]!.text).not.toMatch(/DELETE/);
  });

  it('also replaces it when the page fell back to row-by-row writes', async () => {
    const { pool, client, stored } = withStoredIssue();
    const bad = issue({ id: 2 });
    const failBad = client.fail;
    client.fail = (text, values) =>
      text.includes('INSERT INTO issues') && values.includes(2) ? pgError('22021', 'invalid byte') : failBad(text, values);
    const log = vi.fn();

    const result = await upsertBatch(pool, [repo()], [recreated, bad], log);

    expect(result).toEqual({ upserted: 1, skipped: 1 });
    expect(stored.has(9001)).toBe(true);
    expect(log).toHaveBeenCalledWith('Replaced stale issue acme/app#1: id 501 → 9001 (re-created on GitHub)');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Skipped issue acme/app#2 (id 2): 22021'));
  });
});

describe('isRowDataError', () => {
  it('treats SQLSTATE classes 22 and 23 as row data errors only', () => {
    expect(isRowDataError(pgError('22021'))).toBe(true);
    expect(isRowDataError(pgError('23505'))).toBe(true);
    expect(isRowDataError(pgError('23502'))).toBe(true);
    expect(isRowDataError(pgError('57P01'))).toBe(false);
    expect(isRowDataError(pgError('42601'))).toBe(false);
    expect(isRowDataError(new Error('no code'))).toBe(false);
    expect(isRowDataError(undefined)).toBe(false);
  });
});
