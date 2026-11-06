import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { createIssueStore, createUserStore } from './db/stores.js';

const app = createApp({ issueStore: createIssueStore(pool), userStore: createUserStore(pool) });

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
