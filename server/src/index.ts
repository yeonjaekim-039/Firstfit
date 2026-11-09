import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { createGitHubOAuth } from './auth/githubOAuth.js';
import { createSessionCodec } from './auth/session.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { createBlogStore, createIssueStore, createSavedStore, createUserStore } from './db/stores.js';

let sessionSecret = config.sessionSecret;
if (!sessionSecret) {
  sessionSecret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET is not set; using a random one, so sessions reset when the server restarts.');
}

const oauth =
  config.githubClientId && config.githubClientSecret
    ? createGitHubOAuth(config.githubClientId, config.githubClientSecret)
    : null;
if (!oauth) console.warn('GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not set; GitHub login is disabled.');

const app = createApp({
  issueStore: createIssueStore(pool),
  userStore: createUserStore(pool),
  savedStore: createSavedStore(pool),
  blogStore: createBlogStore(pool),
  auth: { sessions: createSessionCodec(sessionSecret), oauth, clientUrl: config.clientUrl },
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
