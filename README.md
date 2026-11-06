# github-issue-matcher

Finds beginner-friendly open-source issues and ranks them by your skills, preferred languages,
and difficulty level.

## Setup

```sh
cp .env.example .env          # then set GITHUB_TOKEN
docker compose up -d          # Postgres on host port 5433
cd server && npm install && npm run migrate && npm run ingest
npm run dev                   # API on http://localhost:3001
cd ../client && npm install && npm run dev
```

Postgres is exposed on host port **5433** (not 5432, which is used by another project):

```
postgresql://postgres:postgres@localhost:5433/github_issue_matcher
```

## API

```
GET /api/issues?skills=react,css&preferredLanguages=TypeScript,JavaScript&level=easy&difficulty=easy&page=1&pageSize=20
```

See [CLAUDE.md](CLAUDE.md) for every parameter and for the architecture.
