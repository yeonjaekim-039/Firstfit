import express, { type ErrorRequestHandler } from 'express';
import { parseCookies, SESSION_COOKIE } from './auth/session.js';
import type { IssueStore, SavedStore, UserStore } from './db/stores.js';
import { LABELS, LANGUAGES } from './ingest/queries.js';
import { type AuthDeps, authRouter } from './routes/auth.js';
import { issuesRouter } from './routes/issues.js';
import { meRouter } from './routes/me.js';

export interface AppDeps {
  issueStore: IssueStore;
  userStore: UserStore;
  savedStore: SavedStore;
  auth: AuthDeps;
  now?: () => Date;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  // Resolve the session cookie once; routes read res.locals.userId (number | null).
  app.use((req, res, next) => {
    res.locals.userId = deps.auth.sessions.verify(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/meta', (_req, res) => {
    res.json({ languages: LANGUAGES, labels: LABELS, auth: { github: deps.auth.oauth !== null } });
  });

  app.use('/api/issues', issuesRouter(deps));
  app.use('/api/auth', authRouter({ ...deps.auth, userStore: deps.userStore }));
  app.use('/api/me', meRouter(deps));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Malformed JSON bodies are client errors, not server errors.
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);

  return app;
}
