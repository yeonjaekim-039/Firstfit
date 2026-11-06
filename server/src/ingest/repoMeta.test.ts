import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { GraphQLResult } from './github.js';
import { buildRepoQuery, enrichRepos, type GraphQLClient, parseRepoResults, type RepoRef } from './repoMeta.js';

const refs: RepoRef[] = [
  { id: 1, owner: 'acme', name: 'widgets' },
  { id: 2, owner: 'evil"owner', name: 'x){ viewer { login } }' },
  { id: 3, owner: 'gone', name: 'repo' },
];

type Nodes = Record<string, { stargazerCount: number; pushedAt: string | null; isArchived: boolean } | null>;

describe('buildRepoQuery', () => {
  it('aliases one repository lookup per repo and passes names as variables', () => {
    const { query, variables } = buildRepoQuery(refs);
    expect(query).toContain('r0: repository(owner: $o0, name: $n0) { stargazerCount pushedAt isArchived }');
    expect(query).toContain('r2: repository(owner: $o2, name: $n2)');
    expect(query).toMatch(/^query\(\$o0: String!, \$n0: String!, \$o1: String!/);
    expect(variables).toEqual({
      o0: 'acme',
      n0: 'widgets',
      o1: 'evil"owner',
      n1: 'x){ viewer { login } }',
      o2: 'gone',
      n2: 'repo',
    });
    // User-controlled names never reach the query text.
    expect(query).not.toContain('evil');
    expect(query).not.toContain('viewer');
  });
});

describe('parseRepoResults', () => {
  it('maps found repos, marks NOT_FOUND repos as archived, and skips other failures', () => {
    const result: GraphQLResult<Nodes> = {
      data: {
        r0: { stargazerCount: 1234, pushedAt: '2026-10-01T00:00:00Z', isArchived: false },
        r1: null,
        r2: null,
      },
      errors: [
        { type: 'FORBIDDEN', path: ['r1'], message: 'Resource protected by organization SAML enforcement' },
        { type: 'NOT_FOUND', path: ['r2'], message: "Could not resolve to a Repository with the name 'gone/repo'." },
      ],
    };
    expect(parseRepoResults(refs, result)).toEqual([
      { id: 1, stars: 1234, pushedAt: '2026-10-01T00:00:00Z', archived: false },
      { id: 3, stars: null, pushedAt: null, archived: true },
    ]);
  });

  it('records archived repos as archived', () => {
    const result: GraphQLResult<Nodes> = {
      data: { r0: { stargazerCount: 9, pushedAt: null, isArchived: true } },
      errors: [],
    };
    expect(parseRepoResults(refs.slice(0, 1), result)).toEqual([{ id: 1, stars: 9, pushedAt: null, archived: true }]);
  });

  it('returns nothing (so everything is retried) when the whole response failed', () => {
    expect(parseRepoResults(refs, { data: null, errors: [{ message: 'Something went wrong' }] })).toEqual([]);
  });
});

describe('enrichRepos', () => {
  function stubPool(pending: RepoRef[]) {
    const updates: unknown[][] = [];
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.trimStart().startsWith('SELECT')) return { rows: pending };
      updates.push(params);
      return { rows: [], rowCount: (params[0] as number[]).length };
    });
    return { pool: { query } as unknown as pg.Pool, updates, query };
  }

  it('batches repos, writes results in one UPDATE per batch, and reports counts', async () => {
    const pending = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, owner: 'o', name: `r${i}` }));
    const { pool, updates } = stubPool(pending);
    const calls: Record<string, unknown>[] = [];
    // Fake GitHub: repo "r1" is archived, "r3" doesn't exist (NOT_FOUND), the rest have 10 stars.
    const client: GraphQLClient = {
      async graphql<T>(_q: string, variables: Record<string, unknown>) {
        calls.push(variables);
        const data: Nodes = {};
        const errors: GraphQLResult<Nodes>['errors'] = [];
        for (let i = 0; `n${i}` in variables; i++) {
          const name = variables[`n${i}`] as string;
          if (name === 'r3') {
            data[`r${i}`] = null;
            errors.push({ type: 'NOT_FOUND', path: [`r${i}`], message: 'Could not resolve' });
          } else {
            data[`r${i}`] = { stargazerCount: 10, pushedAt: null, isArchived: name === 'r1' };
          }
        }
        return { data: data as T, errors };
      },
    };

    const result = await enrichRepos({ pool, client, maxAgeDays: 7, batchSize: 2 });

    expect(calls).toHaveLength(3); // 2 + 2 + 1
    expect(updates).toHaveLength(3);
    expect(updates[0]).toEqual([[1, 2], [10, 10], [null, null], [false, true]]);
    expect(updates[1]).toEqual([[3, 4], [10, null], [null, null], [false, true]]);
    expect(result).toEqual({ fetched: 5, archived: 2, skipped: 0 });
  });

  it('passes the max age to the SELECT and does nothing when everything is fresh', async () => {
    const { pool, query } = stubPool([]);
    const client: GraphQLClient = { graphql: vi.fn() };
    expect(await enrichRepos({ pool, client, maxAgeDays: 30 })).toEqual({ fetched: 0, archived: 0, skipped: 0 });
    expect(query.mock.calls[0]![1]).toEqual([30]);
    expect(client.graphql).not.toHaveBeenCalled();
  });

  it('skips the UPDATE for a batch where nothing resolved', async () => {
    const { pool, updates } = stubPool([{ id: 1, owner: 'o', name: 'r' }]);
    const client: GraphQLClient = {
      graphql: async <T>() => ({ data: null as T | null, errors: [{ message: 'timeout' }] }),
    };
    expect(await enrichRepos({ pool, client, maxAgeDays: 7 })).toEqual({ fetched: 0, archived: 0, skipped: 1 });
    expect(updates).toHaveLength(0);
  });
});
