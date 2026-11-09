/**
 * Every other write path goes through the same pool, so the same cleaning applies. These
 * tests feed NUL into each text value those paths write and check what would reach Postgres.
 */
import { describe, expect, it } from 'vitest';
import { applyReconciliation } from '../ingest/sweep.js';
import { fakeDb, sentStrings } from '../test/fakeDb.js';
import { createUserStore } from './stores.js';

const NUL = '\u0000';
const noNul = (client: ReturnType<typeof fakeDb>['client']) =>
  expect(sentStrings(client.sent).filter((s) => s.includes(NUL))).toEqual([]);

describe('closed-issue sweep refresh', () => {
  it('cleans title, labels, assignee and difficulty', async () => {
    const { pool, client } = fakeDb();
    await applyReconciliation(pool, 1, {
      action: 'refresh',
      title: `T${NUL}itle`,
      labels: [`bug${NUL}`, 'good first issue'],
      assignee: `oct${NUL}ocat`,
      commentCount: 1,
      bodyLength: 2,
      difficulty: `easy${NUL}` as 'easy',
      updatedAt: `2026-11-08T00:00:00Z${NUL}`,
    });
    noNul(client);
    expect(client.sent[0]!.values.slice(1, 4)).toEqual(['Title', ['bug', 'good first issue'], 'octocat']);
  });
});

describe('user store', () => {
  const userRow = { id: 1, github_login: 'x', display_name: 'x', avatar_url: null, skills: [], preferred_languages: [], difficulty_level: 'easy' };

  it('cleans the GitHub profile written on login', async () => {
    const { pool, client } = fakeDb();
    client.respond = () => ({ rows: [{ id: 1 }] });
    await createUserStore(pool).upsertGithubUser({
      id: 5,
      login: `oct${NUL}ocat`,
      name: `The ${NUL}Octocat`,
      avatarUrl: `https://a.test/x.png${NUL}`,
    });
    noNul(client);
  });

  it('cleans profile skills and languages (user input)', async () => {
    const { pool, client } = fakeDb();
    client.respond = () => ({ rows: [userRow] });
    await createUserStore(pool).updateProfile(1, {
      skills: [`react${NUL}`, `c${NUL}ss`],
      preferredLanguages: [`Type${NUL}Script`],
      difficulty: 'easy',
    });
    noNul(client);
    expect(client.sent[0]!.values.slice(1, 3)).toEqual([['react', 'css'], ['TypeScript']]);
  });
});
