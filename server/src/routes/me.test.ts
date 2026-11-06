import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { fakeSavedStore, fakeUserStore, makeDeps, makeIssue, makeUser, sessionCookie } from '../test/fakes.js';

function setup() {
  const issues = [
    makeIssue({ id: 10, language: 'Rust', title: 'Rust CLI typo' }),
    makeIssue({ id: 11, language: 'TypeScript' }),
    makeIssue({ id: 12, assignee: 'someone' }),
  ];
  const userStore = fakeUserStore({ 1: makeUser({ id: 1, preferredLanguages: ['Rust'] }) });
  const saved = fakeSavedStore(issues, [99]);
  const app = createApp(makeDeps({ userStore, savedStore: saved.store }));
  return { app, userStore, saved, auth: sessionCookie(1) };
}

describe('/api/me', () => {
  it.each([
    ['get', '/api/me'],
    ['put', '/api/me/profile'],
    ['get', '/api/me/saved'],
    ['put', '/api/me/saved/10'],
    ['delete', '/api/me/saved/10'],
  ] as const)('%s %s requires a session', async (method, path) => {
    const { app } = setup();
    expect((await request(app)[method](path)).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/me').set('Cookie', 'gim_session=e30.forged');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the session user no longer exists', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/me').set('Cookie', sessionCookie(404))).status).toBe(401);
  });

  it('returns the user and saved ids', async () => {
    const { app, saved, auth } = setup();
    await saved.store.save(1, 10);
    const res = await request(app).get('/api/me').set('Cookie', auth);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 1, login: 'octocat', preferredLanguages: ['Rust'] });
    expect(res.body.savedIssueIds).toEqual([10]);
  });

  it('updates the profile, trimming and de-duplicating', async () => {
    const { app, auth, userStore } = setup();
    const res = await request(app)
      .put('/api/me/profile')
      .set('Cookie', auth)
      .send({ skills: [' react ', 'react', 'css'], preferredLanguages: ['TypeScript'], difficulty: 'medium' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ skills: ['react', 'css'], difficulty: 'medium' });
    expect(userStore.users.get(1)!.preferredLanguages).toEqual(['TypeScript']);
  });

  it.each([
    [{ skills: [], preferredLanguages: [], difficulty: 'expert' }],
    [{ skills: 'react', preferredLanguages: [], difficulty: 'easy' }],
    [{ skills: [''], preferredLanguages: [], difficulty: 'easy' }],
    [{ skills: Array.from({ length: 31 }, (_, i) => `s${i}`), preferredLanguages: [], difficulty: 'easy' }],
  ])('rejects invalid profile %#', async (body) => {
    const { app, auth } = setup();
    const res = await request(app).put('/api/me/profile').set('Cookie', auth).send(body);
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const { app, auth } = setup();
    const res = await request(app)
      .put('/api/me/profile')
      .set('Cookie', auth)
      .set('Content-Type', 'application/json')
      .send('{"skills":');
    expect(res.status).toBe(400);
  });

  it('saves, lists (newest first, scored with the profile) and removes issues', async () => {
    const { app, auth } = setup();
    expect((await request(app).put('/api/me/saved/11').set('Cookie', auth)).status).toBe(204);
    expect((await request(app).put('/api/me/saved/10').set('Cookie', auth)).status).toBe(204);
    // idempotent
    expect((await request(app).put('/api/me/saved/10').set('Cookie', auth)).status).toBe(204);

    const list = await request(app).get('/api/me/saved').set('Cookie', auth);
    expect(list.body.items.map((i: { id: number }) => i.id)).toEqual([10, 11]);
    expect(list.body.items[0]).toMatchObject({ repo: { fullName: 'acme/app' }, breakdown: { match: 1 } });
    expect(list.body.items[0].savedAt).toBeDefined();

    expect((await request(app).delete('/api/me/saved/10').set('Cookie', auth)).status).toBe(204);
    const after = await request(app).get('/api/me/saved').set('Cookie', auth);
    expect(after.body.items.map((i: { id: number }) => i.id)).toEqual([11]);
  });

  it('still lists saved issues that were assigned later, with the assignee', async () => {
    const { app, auth } = setup();
    await request(app).put('/api/me/saved/12').set('Cookie', auth);
    const list = await request(app).get('/api/me/saved').set('Cookie', auth);
    expect(list.body.items[0]).toMatchObject({ id: 12, assignee: 'someone' });
    expect(typeof list.body.items[0].score).toBe('number');
  });

  it('reports how many saved issues were hidden because they closed', async () => {
    const { app, auth, saved } = setup();
    saved.saved(1).set(99, new Date());
    const list = await request(app).get('/api/me/saved').set('Cookie', auth);
    expect(list.body.hiddenClosed).toBe(1);
    expect(list.body.items).toEqual([]);
  });

  it('returns 404 when saving an unknown or closed issue, 400 for a bad id', async () => {
    const { app, auth } = setup();
    expect((await request(app).put('/api/me/saved/999').set('Cookie', auth)).status).toBe(404);
    expect((await request(app).put('/api/me/saved/abc').set('Cookie', auth)).status).toBe(400);
  });
});
