# GitHub Issue Matcher

Finds beginner-friendly open-source GitHub issues and ranks them by a user's skills, preferred
languages, and difficulty level.

## Layout

- `server/`: Node + Express 5 + TypeScript API (ESM, `NodeNext`). ESLint + Vitest.
- `client/`: Vite + React + TypeScript. Linted with oxlint (Vite template default), tested with Vitest + Testing Library (jsdom). Dev server proxies `/api` to `localhost:3001`.
- `docker-compose.yml`: Postgres 16 on **host port 5433** (5432 is taken by another local project, so don't change it back).
- `.env` (repo root, git-ignored): read by docker-compose and by `server/src/config.ts`. See `.env.example`. Needs `DATABASE_URL` and `GITHUB_TOKEN`; `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`SESSION_SECRET`/`CLIENT_URL` enable login (without them the app works signed-out only).
- `.github/workflows/ci.yml`: on every push/PR, runs `npm ci`, `lint`, `typecheck`, `test` for `server` and `client` (matrix). CI has no Postgres; tests must not need a DB.

## Commands

Run these from `server/` or `client/`:

```sh
npm run dev         # server: tsx watch on :3001 | client: vite
npm run lint
npm run typecheck
npm test            # vitest run
npm run migrate     # server: apply server/migrations/*.sql
npm run ingest      # server: pull issues from GitHub into Postgres
npm run ingest -- --languages=Go,Rust --labels="good first issue" --max-issues=500
npm run ingest -- --recheck-only     # only re-check open issues not seen in 24h
npm run ingest -- --repo-meta-only   # only fetch missing/stale repo metadata (stars, last push, archived)
```

`npm run ingest` runs in three phases: crawl, then repo metadata (`--no-repo-meta` to skip; refetches after `--repo-max-age-days`, default 7), then the closed-issue sweep.

## Server architecture

- `src/domain/scoring.ts`: **pure** scoring and ranking. No I/O; `now` is passed in. Score is 0–100:
  `match 0.38` (preferred-language order + skill token match against title/labels/repo/language),
  `labels 0.19` (beginner-label weights, or 1.0 for a user-preferred label),
  `difficulty 0.24` (fit vs. user level; harder-than-level is penalized more than easier),
  `freshness 0.14` (exponential decay, 45-day half-life on `updated_at`),
  `repo 0.05` (small quality boost: 60% stars, log-scaled and saturating at 10k; 40% last push, 90-day half-life).
  The weighted sum is then multiplied by `crowdingMultiplier(commentCount)`: 1 up to 15 comments, log-scaled down to 0.7 at 60+ (returned as `crowding` in the API; the card shows a note when < 1).
  Assigned issues return `null` and are dropped. Missing profile inputs, and repos without fetched metadata, score a neutral 0.5.
- `src/ingest/`: ingestion pipeline.
  - `github.ts`: REST search client. Spaces requests (2.1s with a token, 6.1s without), waits for `x-ratelimit-reset` / `retry-after`, retries on 403/429/5xx.
  - `crawl.ts`: one query per (label, language). GitHub caps search at **1000 results per query**, so windows over the cap are split recursively by `created:` date.
  - `difficulty.ts`: easy/medium/hard heuristic from labels, comment count, and body length.
  - `mapIssue.ts`: maps a search item to rows. Labels are lowercased and de-duplicated. `language` is the *queried* language, because search results don't include repo language.
  - `upsert.ts`: multi-row `INSERT ... ON CONFLICT` per page in one transaction (rows are de-duplicated first).
  - `repoMeta.ts`: caches `stars`, `pushed_at`, `archived` on `repos` via **GraphQL** (`GitHubClient.graphql`; needs a token), 50 aliased `repository(...)` lookups per request (~1 point each), so tens of thousands of repos take minutes instead of hours over REST. NOT_FOUND repos are stored as `archived = true`; other per-repo errors leave `metadata_fetched_at` null so they retry. `buildRepoQuery` / `parseRepoResults` are pure and unit-tested.
  - **Archived repos are skipped everywhere:** the crawl doesn't upsert issues from known-archived repos, and search candidates, saved issues and the sweep all filter `NOT r.archived` (saved issues in archived repos count toward `hiddenClosed`).
- `src/db/stores.ts`: `IssueStore` / `UserStore` / `SavedStore` interfaces plus pg implementations. `createApp(deps)` takes stores, the session codec, and the OAuth client via injection; route tests build deps with `makeDeps()` from `src/test/fakes.ts` (in-memory stores, fake OAuth).
- `src/auth/`: `session.ts` is a stateless HMAC-signed cookie (`gim_session`, 30 days, httpOnly, SameSite=Lax; nothing is stored server-side). `githubOAuth.ts` is the GitHub web flow (no scopes: public profile only).
- `src/routes/auth.ts`: `GET /api/auth/github` sets a `gim_oauth_state` cookie and redirects to GitHub. `GET /api/auth/github/callback` checks state, exchanges the code, upserts the user by `github_id`, sets the session, and redirects to `${CLIENT_URL}/dashboard` (or `/?authError=denied|state|failed|unavailable`). `POST /api/auth/logout`.
- `src/routes/me.ts` (session required, else 401): `GET /api/me` → `{user, savedIssueIds}`, `PUT /api/me/profile`, `GET /api/me/saved` (open saved issues scored with the user's profile, plus a `hiddenClosed` count), `PUT|DELETE /api/me/saved/:issueId` (idempotent; PUT returns 404 if the issue isn't open).
- `GET /api/meta` → `{languages, labels, auth: {github}}`: the client builds its filter options from this, so `src/ingest/queries.ts` stays the single source.
- `src/routes/issues.ts`: `GET /api/issues`. SQL applies the filters (open + unassigned + `language`/`label`/`difficulty`), takes the `MAX_CANDIDATES` (5000) most recently updated rows, ranks them in JS, applies `diversifyByRepo` (`src/domain/diversity.ts`: at most `MAX_PER_REPO_PER_PAGE` = 2 per repo per page; extras move to later pages, never dropped; computed over the whole list for the requested `pageSize` so page boundaries are stable), then paginates.

### `GET /api/issues` query params

List params accept `a,b` or repeated keys.

| Param | Meaning |
|---|---|
| `language`, `label`, `difficulty` | Filters (match any). `difficulty` ∈ easy/medium/hard |
| `skills`, `preferredLanguages` (ordered), `level`, `preferredLabels` | Ranking profile |
| `userId` | Load the profile from `users`; explicit params override it |
| `page` (default 1), `pageSize` (default 20, max 100) | Pagination |

The response contains `total` (rows matching the filters), `rankedCount` (rows actually ranked, ≤ 5000), `totalPages`, the effective `profile`, and `items[]` with `score` and `breakdown`.

## Client architecture

- `src/api.ts`: types and fetch wrappers for every endpoint. `src/session.tsx` is a `SessionProvider` (meta, current user, saved ids, optimistic `toggleSave`); read it with `useSession()` from `src/sessionContext.ts`.
- Routes (react-router v8): `/` = `pages/DiscoverPage.tsx`, `/dashboard` = `pages/DashboardPage.tsx`.
- Discover state lives in the **URL** (`skills`, `langs`, `level`, `language`, `label`, `difficulty`, `page`; see `pages/discoverQuery.ts`), so searches are shareable and back/forward works. Signed-in users with no profile params in the URL get the form seeded from their saved profile.
- Components: `ChipInput` (free-text tags), `ToggleChips` (multi-select filters), `DifficultyPicker`, `IssueCard` (links, repo stars via `formatCount`, labels, 5-part score breakdown, save), `Pagination`, `Layout`. Plain CSS in `src/index.css` with light/dark tokens; breakpoints at 900px (single column; the Discover sidebar collapses behind a "Profile & filters" toggle via `.sidebar.is-open`) and 600px (card score moves below).
- Login is a plain link to `/api/auth/github` through the Vite proxy, so the session cookie is first-party on `:5173`. The GitHub OAuth App's callback URL must be `http://localhost:5173/api/auth/github/callback`.
- Tests mock `fetch` with `src/test/mockApi.ts`. Vitest globals are off, so `src/test/setup.ts` registers Testing Library's `cleanup` explicitly.
- oxlint's `only-export-components` rule: keep non-component exports (hooks, helpers) out of `.tsx` component files.

## Database

The schema is in `server/migrations/` (plain SQL, applied in filename order and tracked in `schema_migrations`). Add new migrations as `NNN_description.sql`; never edit an applied one.
Tables: `repos`, `issues` (PK = GitHub issue id, `labels TEXT[]` with a GIN index, `difficulty` enum, `state` ∈ open/closed/delisted), `repos` metadata (`stars`, `pushed_at`, `archived`, `metadata_fetched_at`), `users` (`github_id` unique, used as the OAuth upsert key), `saved_issues`.

## Production

- **Live:** https://issuematcher.duckdns.org on a Hetzner VPS (`root@46.62.238.195`), at `/opt/issuematcher`. The host also runs **SpartanRoute** (`/root/spartanroute`; containers `spartanroute-*`, volume `spartanroute_pgdata`, ports `127.0.0.1:5432` and `:8080`). Never touch it. Prune only with `--filter label=app=issuematcher`.
- **Images:** `ghcr.io/yeonjaekim-039/issuematcher-server` (`server/Dockerfile`; runs migrations, then the API) and `ghcr.io/yeonjaekim-039/issuematcher-web` (`deploy/web.Dockerfile`; Caddy plus the built client, config in `deploy/Caddyfile`). Both are built in CI on push to `main` and tagged with the commit SHA and `latest`.
- **Compose:** `deploy/docker-compose.prod.yml`, project `issuematcher`. Postgres sits only on an `internal: true` network with no published port; only `web` binds 80/443. Secrets live in `/opt/issuematcher/.env` on the server only (template: `deploy/.env.production.example`). `image.env` holds the deployed `IMAGE_TAG`.
- **Deploy:** the CI `deploy` job (needs `vars.DEPLOY_ENABLED == 'true'` and the secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS`) runs `ssh root@host "deploy <sha>"`. The deploy key in `/root/.ssh/authorized_keys` is `restrict,command="/usr/local/sbin/issuematcher-deploy-gate"`: that gate (`deploy/deploy-gate.sh`, installed by hand, never overwritten by CI) accepts only `deploy <40-hex sha>`, downloads `deploy/*` from the public repo at that commit into `/opt/issuematcher`, and execs `deploy.sh <sha>`: pull, `up -d`, wait for health, roll back to the previous tag on failure. No scp/shell/forwarding with that key; refusals are logged (`journalctl -t issuematcher-deploy`). If you change `deploy-gate.sh`, reinstall it by hand.
- **Daily ingest:** `deploy/issuematcher-ingest.{service,timer}` in `/etc/systemd/system` (09:00 UTC, `flock` against overlap) runs `docker compose run --rm server node dist/ingest/run.js`. Deploys fetch new unit files into `/opt/issuematcher` but don't install them; copy them and `systemctl daemon-reload` by hand.
- **Ops:** `cd /opt/issuematcher && docker compose --env-file .env --env-file image.env -f docker-compose.prod.yml logs -f server`; `journalctl -u issuematcher-ingest`.

## Conventions and gotchas

- Server imports use the `.js` extension (NodeNext ESM).
- Keep scoring and difficulty logic pure and unit-tested. Change weights in `WEIGHTS` and update tests.
- **Closed issues:** `issues.ingested_at` = last time search returned the issue. After a full-coverage crawl (all target labels, no `--max-issues`), `src/ingest/sweep.ts` re-fetches each open issue with `ingested_at < run start` via the core API and sets `state` to `closed` (closed / 404 / 410 / 451 / transferred), `delisted` (open but no target label left), or refreshes it. `reconcile()` is pure and unit-tested. It's capped by `--max-rechecks` (default 3000); the rest carry over to the next run. `--recheck-only [--stale-before=ISO]` sweeps without crawling. The API only ever serves `state = 'open'`.
- **Database writes are cleaned in one place:** `db/pool.ts` builds the pool with `CleaningClient` (`db/clean.ts`), which strips NUL (U+0000, which Postgres text rejects with 22021) from every query parameter, including strings in arrays. Don't add per-field cleaning; every query through `pool` is covered. `upsertBatch` writes a page in one transaction and, on a row data/constraint error (SQLSTATE 22xxx/23xxx), retries row by row, logging and skipping only the bad issue (`repo#number`); other errors still fail the run. Tests use `test/fakeDb.ts` (no Postgres).
- If vitest fails with "Cannot find native binding" (rolldown), reinstall: `rm -rf node_modules package-lock.json && npm install` (npm optional-deps bug).
