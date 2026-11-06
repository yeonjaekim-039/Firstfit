import express, { type ErrorRequestHandler } from 'express';
import type { IssueStore, UserStore } from './db/stores.js';
import { issuesRouter } from './routes/issues.js';

export interface AppDeps {
  issueStore: IssueStore;
  userStore: UserStore;
  now?: () => Date;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/issues', issuesRouter(deps));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);

  return app;
}
