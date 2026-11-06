import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { IssueRecord, IssueStore } from '../db/stores.js';
import type { UserProfile } from '../domain/scoring.js';
import { fakeIssueStore, fakeUserStore, makeIssue, NOW } from '../test/fakes.js';
import { MAX_CANDIDATES } from './issues.js';

function setup(rows: IssueRecord[] = [], users: Record<number, UserProfile> = {}) {
  const { store, calls } = fakeIssueStore(rows);
  const app = createApp({ issueStore: store, userStore: fakeUserStore(users), now: () => NOW });
  return { app, calls };
}

describe('GET /api/issues', () => {
  it('passes comma-separated and repeated filters to the store', async () => {
    const { app, calls } = setup();
    const res = await request(app)
      .get('/api/issues')
      .query('language=Go,Rust&label=good first issue&label=help wanted&difficulty=easy,medium');
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      {
        filters: {
          languages: ['Go', 'Rust'],
          labels: ['good first issue', 'help wanted'],
          difficulties: ['easy', 'medium'],
        },
        limit: MAX_CANDIDATES,
      },
    ]);
  });

  it('passes undefined filters when none are given', async () => {
    const { app, calls } = setup();
    await request(app).get('/api/issues');
    expect(calls[0]!.filters).toEqual({ languages: undefined, labels: undefined, difficulties: undefined });
  });

  it('ranks by skills, preferred languages and level', async () => {
    const { app } = setup([
      makeIssue({ id: 1, language: 'Go', title: 'Refactor CLI flags' }),
      makeIssue({ id: 2, language: 'Python', title: 'Fix Django admin typo' }),
      makeIssue({ id: 3, language: 'Python', title: 'Rewrite scheduler', difficulty: 'hard' }),
    ]);
    const res = await request(app)
      .get('/api/issues')
      .query({ skills: 'django', preferredLanguages: 'Python,Go', level: 'easy' });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([2, 1, 3]);
    expect(res.body.items[0]).toMatchObject({
      id: 2,
      repo: { fullName: 'acme/app', url: 'https://github.com/acme/app' },
      breakdown: { match: 1, labels: 1, difficulty: 1, freshness: 1 },
      score: 100,
    });
  });

  it('paginates the ranked list', async () => {
    const rows = Array.from({ length: 45 }, (_, i) =>
      makeIssue({ id: i + 1, updatedAt: new Date(NOW.getTime() - i * 86_400_000) }),
    );
    const { app } = setup(rows);
    const res = await request(app).get('/api/issues').query({ page: 3, pageSize: 20 });
    expect(res.body).toMatchObject({ page: 3, pageSize: 20, total: 45, rankedCount: 45, totalPages: 3 });
    expect(res.body.items).toHaveLength(5);
    // Identical except freshness, so ranking order == recency order.
    expect(res.body.items[0].id).toBe(41);
  });

  it('returns an empty page past the end', async () => {
    const { app } = setup([makeIssue()]);
    const res = await request(app).get('/api/issues').query({ page: 5 });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('defaults to page 1 with 20 items', async () => {
    const { app } = setup(Array.from({ length: 30 }, (_, i) => makeIssue({ id: i + 1 })));
    const res = await request(app).get('/api/issues');
    expect(res.body.page).toBe(1);
    expect(res.body.items).toHaveLength(20);
  });

  it('excludes assigned issues even if the store returns them', async () => {
    const { app } = setup([makeIssue({ id: 1, assignee: 'octocat' }), makeIssue({ id: 2 })]);
    const res = await request(app).get('/api/issues');
    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([2]);
  });

  it.each([
    ['difficulty=impossible'],
    ['level=expert'],
    ['pageSize=101'],
    ['page=0'],
    ['page=abc'],
    ['userId=-1'],
  ])('rejects invalid query %s with 400', async (qs) => {
    const { app } = setup();
    const res = await request(app).get(`/api/issues?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('loads the stored profile for userId', async () => {
    const { app } = setup(
      [makeIssue({ id: 1, language: 'Rust' }), makeIssue({ id: 2, language: 'TypeScript' })],
      { 7: { skills: [], preferredLanguages: ['Rust'], difficulty: 'easy' } },
    );
    const res = await request(app).get('/api/issues').query({ userId: 7 });
    expect(res.body.profile).toMatchObject({ preferredLanguages: ['Rust'], difficulty: 'easy' });
    expect(res.body.items[0].id).toBe(1);
  });

  it('lets query params override the stored profile', async () => {
    const { app } = setup([], { 7: { skills: ['react'], preferredLanguages: ['Rust'], difficulty: 'easy' } });
    const res = await request(app).get('/api/issues').query({ userId: 7, preferredLanguages: 'Go', level: 'hard' });
    expect(res.body.profile).toMatchObject({ skills: ['react'], preferredLanguages: ['Go'], difficulty: 'hard' });
  });

  it('returns 404 for an unknown userId', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/issues').query({ userId: 99 });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the store fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: IssueStore = { findCandidates: async () => Promise.reject(new Error('db down')) };
    const app = createApp({ issueStore: failing, userStore: fakeUserStore() });
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
