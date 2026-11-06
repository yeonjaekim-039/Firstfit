# GitHub Issue Matcher

Finds beginner-friendly open-source GitHub issues and ranks them by a user's skills, preferred
languages, and difficulty level.

## Layout

- `server/`: Node + Express 5 + TypeScript API (ESM, `NodeNext`). ESLint + Vitest.
- `client/`: Vite + React + TypeScript. Linted with oxlint (Vite template default), tested with Vitest + Testing Library (jsdom). Dev server proxies `/api` to `localhost:3001`.
- `docker-compose.yml`: Postgres 16 on **host port 5433** (5432 is taken by another local project, so don't change it back).
- `.env` (repo root, git-ignored): read by docker-compose and by `server/src/config.ts`. See `.env.example`. Needs `DATABASE_URL` and `GITHUB_TOKEN`.
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
- `src/db/stores.ts`: `IssueStore` / `UserStore` interfaces plus pg implementations. `createApp(deps)` takes stores via injection; route tests use fakes in `src/test/fakes.ts`.
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

## Database

The schema is in `server/migrations/` (plain SQL, applied in filename order and tracked in `schema_migrations`). Add new migrations as `NNN_description.sql`; never edit an applied one.
Tables: `repos`, `issues` (PK = GitHub issue id, `labels TEXT[]` with a GIN index, `difficulty` enum), `users`, `saved_issues`.

## Conventions and gotchas

- Server imports use the `.js` extension (NodeNext ESM).
- Keep scoring and difficulty logic pure and unit-tested. Change weights in `WEIGHTS` and update tests.
- Ingestion only marks issues open. Issues closed on GitHub stay `state='open'` until a re-ingest overwrites them (there is no closed-issue sweep yet).
- If vitest fails with "Cannot find native binding" (rolldown), reinstall: `rm -rf node_modules package-lock.json && npm install` (npm optional-deps bug).
