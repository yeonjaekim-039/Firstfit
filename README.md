# github-issue-matcher

## Local database

Postgres runs in Docker and is exposed on host port **5433** (not 5432, which is used by another project).

```sh
cp .env.example .env
docker compose up -d
```

Connection string:

```
postgresql://postgres:postgres@localhost:5433/github_issue_matcher
```
