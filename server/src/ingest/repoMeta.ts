import type pg from 'pg';
import type { GraphQLResult } from './github.js';

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
}

export interface RepoMeta {
  id: number;
  stars: number | null;
  pushedAt: string | null;
  /** True for archived repos, and for repos GitHub no longer resolves (deleted, private, blocked). */
  archived: boolean;
}

interface RepoNode {
  stargazerCount: number;
  pushedAt: string | null;
  isArchived: boolean;
}

/** Repos per GraphQL request. Each aliased `repository` lookup costs ~1 point of 5000/hr. */
export const REPO_BATCH_SIZE = 50;

/** Builds one aliased GraphQL query (r0, r1, …) for a batch of repos. Owner and name go in variables, so they need no escaping. */
export function buildRepoQuery(repos: RepoRef[]): { query: string; variables: Record<string, string> } {
  const variables: Record<string, string> = {};
  const params: string[] = [];
  const fields: string[] = [];
  repos.forEach((r, i) => {
    variables[`o${i}`] = r.owner;
    variables[`n${i}`] = r.name;
    params.push(`$o${i}: String!`, `$n${i}: String!`);
    fields.push(`r${i}: repository(owner: $o${i}, name: $n${i}) { stargazerCount pushedAt isArchived }`);
  });
  return { query: `query(${params.join(', ')}) {\n  ${fields.join('\n  ')}\n}`, variables };
}

/**
 * Maps a batch response back to repos. A null alias with a NOT_FOUND error means the repo is gone,
 * and is recorded as archived so its issues are hidden. A null alias with any other error
 * (timeout, forbidden, …) is left out so it's retried on the next run.
 */
export function parseRepoResults(repos: RepoRef[], result: GraphQLResult<Record<string, RepoNode | null>>): RepoMeta[] {
  const notFound = new Set(
    result.errors.filter((e) => e.type === 'NOT_FOUND' && typeof e.path?.[0] === 'string').map((e) => e.path![0]),
  );
  const out: RepoMeta[] = [];
  repos.forEach((repo, i) => {
    const node = result.data?.[`r${i}`];
    if (node) {
      out.push({ id: repo.id, stars: node.stargazerCount, pushedAt: node.pushedAt, archived: node.isArchived });
    } else if (notFound.has(`r${i}`)) {
      out.push({ id: repo.id, stars: null, pushedAt: null, archived: true });
    }
  });
  return out;
}

export interface GraphQLClient {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<GraphQLResult<T>>;
}

export interface EnrichOptions {
  pool: pg.Pool;
  client: GraphQLClient;
  /** Re-fetch metadata older than this. */
  maxAgeDays: number;
  batchSize?: number;
  log?: (msg: string) => void;
}

export interface EnrichResult {
  fetched: number;
  archived: number;
  skipped: number;
}

/** Fetches stars, last push and archived status once per repo (and again after maxAgeDays), caching them in `repos`. */
export async function enrichRepos(opts: EnrichOptions): Promise<EnrichResult> {
  const log = opts.log ?? (() => {});
  const batchSize = opts.batchSize ?? REPO_BATCH_SIZE;
  const { rows } = await opts.pool.query<RepoRef>(
    `SELECT id, owner, name FROM repos
      WHERE metadata_fetched_at IS NULL OR metadata_fetched_at < now() - make_interval(days => $1)
      ORDER BY metadata_fetched_at ASC NULLS FIRST, id`,
    [opts.maxAgeDays],
  );
  const result: EnrichResult = { fetched: 0, archived: 0, skipped: 0 };
  if (rows.length === 0) return result;
  log(`Fetching metadata for ${rows.length} repos in batches of ${batchSize}`);

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { query, variables } = buildRepoQuery(batch);
    const metas = parseRepoResults(batch, await opts.client.graphql<Record<string, RepoNode | null>>(query, variables));

    if (metas.length > 0) {
      await opts.pool.query(
        `UPDATE repos r
            SET stars = v.stars, pushed_at = v.pushed_at, archived = v.archived,
                metadata_fetched_at = now(), updated_at = now()
           FROM unnest($1::int[], $2::int[], $3::timestamptz[], $4::bool[]) AS v(id, stars, pushed_at, archived)
          WHERE r.id = v.id`,
        [metas.map((m) => m.id), metas.map((m) => m.stars), metas.map((m) => m.pushedAt), metas.map((m) => m.archived)],
      );
    }
    result.fetched += metas.length;
    result.archived += metas.filter((m) => m.archived).length;
    result.skipped += batch.length - metas.length;
    if ((i / batchSize) % 20 === 19) log(`  repo metadata: ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }
  return result;
}
