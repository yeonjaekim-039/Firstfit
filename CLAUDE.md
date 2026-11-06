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
```

## Server architecture

- `src/domain/scoring.ts`: **pure** scoring and ranking. No I/O; `now` is passed in. Score is 0–100:
  `match 0.4` (preferred-language order + skill token match against title/labels/repo/language),
  `labels 0.2` (beginner-label weights, or 1.0 for a user-preferred label),
  `difficulty 0.25` (fit vs. user level; harder-than-level is penalized more than easier),
  `freshness 0.15` (exponential decay, 45-day half-life on `updated_at`).
  Assigned issues return `null` and are dropped. Missing profile inputs score a neutral 0.5.
- `src/ingest/`: ingestion pipeline.
  - `github.ts`: REST search client. Spaces requests (2.1s with a token, 6.1s without), waits for `x-ratelimit-reset` / `retry-after`, retries on 403/429/5xx.
  - `crawl.ts`: one query per (label, language). GitHub caps search at **1000 results per query**, so windows over the cap are split recursively by `created:` date.
  - `difficulty.ts`: easy/medium/hard heuristic from labels, comment count, and body length.
  - `mapIssue.ts`: maps a search item to rows. Labels are lowercased and de-duplicated. `language` is the *queried* language, because search results don't include repo language.
  - `upsert.ts`: multi-row `INSERT ... ON CONFLICT` per page in one transaction (rows are de-duplicated first).
- `src/db/stores.ts`: `IssueStore` / `UserStore` / `SavedStore` interfaces plus pg implementations. `createApp(deps)` takes stores, the session codec, and the OAuth client via injection; route tests build deps with `makeDeps()` from `src/test/fakes.ts` (in-memory stores, fake OAuth).
- `src/auth/`: `session.ts` is a stateless HMAC-signed cookie (`gim_session`, 30 days, httpOnly, SameSite=Lax; nothing is stored server-side). `githubOAuth.ts` is the GitHub web flow (no scopes: public profile only).
- `src/routes/auth.ts`: `GET /api/auth/github` sets a `gim_oauth_state` cookie and redirects to GitHub. `GET /api/auth/github/callback` checks state, exchanges the code, upserts the user by `github_id`, sets the session, and redirects to `${CLIENT_URL}/dashboard` (or `/?authError=denied|state|failed|unavailable`). `POST /api/auth/logout`.
- `src/routes/me.ts` (session required, else 401): `GET /api/me` → `{user, savedIssueIds}`, `PUT /api/me/profile`, `GET /api/me/saved` (open saved issues scored with the user's profile, plus a `hiddenClosed` count), `PUT|DELETE /api/me/saved/:issueId` (idempotent; PUT returns 404 if the issue isn't open).
- `GET /api/meta` → `{languages, labels, auth: {github}}`: the client builds its filter options from this, so `src/ingest/queries.ts` stays the single source.
- `src/routes/issues.ts`: `GET /api/issues`. SQL applies the filters (open + unassigned + `language`/`label`/`difficulty`), takes the `MAX_CANDIDATES` (5000) most recently updated rows, ranks them in JS, then paginates.

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
- Components: `ChipInput` (free-text tags), `ToggleChips` (multi-select filters), `DifficultyPicker`, `IssueCard` (links, labels, score breakdown, save), `Pagination`, `Layout`. Plain CSS in `src/index.css` with light/dark tokens; breakpoints at 900px (single column) and 600px (card score moves below).
- Login is a plain link to `/api/auth/github` through the Vite proxy, so the session cookie is first-party on `:5173`. The GitHub OAuth App's callback URL must be `http://localhost:5173/api/auth/github/callback`.
- Tests mock `fetch` with `src/test/mockApi.ts`. Vitest globals are off, so `src/test/setup.ts` registers Testing Library's `cleanup` explicitly.
- oxlint's `only-export-components` rule: keep non-component exports (hooks, helpers) out of `.tsx` component files.

## Database

The schema is in `server/migrations/` (plain SQL, applied in filename order and tracked in `schema_migrations`). Add new migrations as `NNN_description.sql`; never edit an applied one.
Tables: `repos`, `issues` (PK = GitHub issue id, `labels TEXT[]` with a GIN index, `difficulty` enum, `state` ∈ open/closed/delisted), `users` (`github_id` unique, used as the OAuth upsert key), `saved_issues`.

## Conventions and gotchas

- Server imports use the `.js` extension (NodeNext ESM).
- Keep scoring and difficulty logic pure and unit-tested. Change weights in `WEIGHTS` and update tests.
- **Closed issues:** `issues.ingested_at` = last time search returned the issue. After a full-coverage crawl (all target labels, no `--max-issues`), `src/ingest/sweep.ts` re-fetches each open issue with `ingested_at < run start` via the core API and sets `state` to `closed` (closed / 404 / 410 / 451 / transferred), `delisted` (open but no target label left), or refreshes it. `reconcile()` is pure and unit-tested. It's capped by `--max-rechecks` (default 3000); the rest carry over to the next run. `--recheck-only [--stale-before=ISO]` sweeps without crawling. The API only ever serves `state = 'open'`.
- If vitest fails with "Cannot find native binding" (rolldown), reinstall: `rm -rf node_modules package-lock.json && npm install` (npm optional-deps bug).
