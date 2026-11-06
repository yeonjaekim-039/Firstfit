import path from 'node:path';
import dotenv from 'dotenv';

// .env lives at the repo root (shared with docker-compose).
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/github_issue_matcher',
  githubToken: process.env.GITHUB_TOKEN,
};
