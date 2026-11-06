import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { makeDeps, sessions } from './test/fakes.js';

describe('app', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(createApp(makeDeps())).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/meta lists filter options and whether login is available', async () => {
    const on = await request(createApp(makeDeps())).get('/api/meta');
    expect(on.body.languages).toContain('TypeScript');
    expect(on.body.labels).toContain('good first issue');
    expect(on.body.auth).toEqual({ github: true });

    const off = await request(
      createApp(makeDeps({ auth: { sessions, oauth: null, clientUrl: 'http://localhost:5173' } })),
    ).get('/api/meta');
    expect(off.body.auth).toEqual({ github: false });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(createApp(makeDeps())).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
