import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from '../auth/session.js';
import { fakeOAuth, fakeUserStore, makeDeps, sessions } from '../test/fakes.js';

const CLIENT = 'http://localhost:5173';

function cookieValue(setCookie: string[] | string | undefined, name: string): string | undefined {
  const all = [setCookie ?? []].flat();
  const line = all.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0]!.slice(name.length + 1);
}

describe('GET /api/auth/github', () => {
  it('redirects to GitHub with a state that is also set as an httpOnly cookie', async () => {
    const res = await request(createApp(makeDeps())).get('/api/auth/github');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    const state = location.searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(location.searchParams.get('redirect_uri')).toBe(`${CLIENT}/api/auth/github/callback`);
    expect(cookieValue(res.headers['set-cookie'], OAUTH_STATE_COOKIE)).toBe(state);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);
  });

  it('returns 503 when OAuth is not configured', async () => {
    const app = createApp(makeDeps({ auth: { sessions, oauth: null, clientUrl: CLIENT } }));
    expect((await request(app).get('/api/auth/github')).status).toBe(503);
  });
});

describe('GET /api/auth/github/callback', () => {
  it('creates the user, sets a session cookie, and redirects to the dashboard', async () => {
    const userStore = fakeUserStore();
    const app = createApp(makeDeps({ userStore }));
    const res = await request(app)
      .get('/api/auth/github/callback?code=abc&state=s1')
      .set('Cookie', `${OAUTH_STATE_COOKIE}=s1`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT}/dashboard`);
    const token = cookieValue(res.headers['set-cookie'], SESSION_COOKIE);
    const userId = sessions.verify(token);
    expect(userId).not.toBeNull();
    expect(userStore.users.get(userId!)).toMatchObject({ login: 'octocat', name: 'The Octocat' });
  });

  it('rejects a state mismatch or missing state cookie', async () => {
    const app = createApp(makeDeps());
    const mismatch = await request(app)
      .get('/api/auth/github/callback?code=abc&state=s1')
      .set('Cookie', `${OAUTH_STATE_COOKIE}=s2`);
    expect(mismatch.headers.location).toBe(`${CLIENT}/?authError=state`);
    const missing = await request(app).get('/api/auth/github/callback?code=abc&state=s1');
    expect(missing.headers.location).toBe(`${CLIENT}/?authError=state`);
    expect(cookieValue(missing.headers['set-cookie'], SESSION_COOKIE)).toBeUndefined();
  });

  it('handles the user denying access', async () => {
    const res = await request(createApp(makeDeps()))
      .get('/api/auth/github/callback?error=access_denied&state=s1')
      .set('Cookie', `${OAUTH_STATE_COOKIE}=s1`);
    expect(res.headers.location).toBe(`${CLIENT}/?authError=denied`);
  });

  it('redirects with an error when GitHub calls fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const oauth = fakeOAuth({ exchangeCode: async () => Promise.reject(new Error('bad_verification_code')) });
    const res = await request(createApp(makeDeps({ auth: { sessions, oauth, clientUrl: CLIENT } })))
      .get('/api/auth/github/callback?code=abc&state=s1')
      .set('Cookie', `${OAUTH_STATE_COOKIE}=s1`);
    expect(res.headers.location).toBe(`${CLIENT}/?authError=failed`);
    expect(cookieValue(res.headers['set-cookie'], SESSION_COOKIE)).toBeUndefined();
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const res = await request(createApp(makeDeps())).post('/api/auth/logout');
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });
});
