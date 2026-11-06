import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { fakeIssueStore, fakeUserStore } from './test/fakes.js';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = createApp({ issueStore: fakeIssueStore([]).store, userStore: fakeUserStore() });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
