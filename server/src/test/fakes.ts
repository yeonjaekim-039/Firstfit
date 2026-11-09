import type { GitHubOAuth } from '../auth/githubOAuth.js';
import { createSessionCodec, SESSION_COOKIE } from '../auth/session.js';
import type { AppDeps } from '../app.js';
import type {
  BlogPostRecord,
  BlogStore,
  IssueFilters,
  IssueRecord,
  IssueStore,
  SavedStore,
  UserRecord,
  UserStore,
} from '../db/stores.js';
import type { UserProfile } from '../domain/scoring.js';

export const NOW = new Date('2026-11-01T00:00:00Z');
export const TEST_SECRET = 'test-secret';
export const sessions = createSessionCodec(TEST_SECRET);
export const sessionCookie = (userId: number) => `${SESSION_COOKIE}=${sessions.sign(userId)}`;

export function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  const id = overrides.id ?? 1;
  return {
    id,
    number: id,
    title: `Issue ${id}`,
    url: `https://github.com/acme/app/issues/${id}`,
    labels: ['good first issue'],
    language: 'TypeScript',
    difficulty: 'easy',
    assignee: null,
    commentCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    repoFullName: 'acme/app',
    repoUrl: 'https://github.com/acme/app',
    repoStars: null,
    repoPushedAt: null,
    ...overrides,
  };
}

export function fakeIssueStore(rows: IssueRecord[]) {
  const calls: { filters: IssueFilters; limit: number }[] = [];
  const store: IssueStore = {
    async findCandidates(filters, limit) {
      calls.push({ filters, limit });
      return { rows, total: rows.length };
    },
  };
  return { store, calls };
}

export function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 1,
    login: 'octocat',
    name: 'The Octocat',
    avatarUrl: null,
    skills: [],
    preferredLanguages: [],
    difficulty: 'easy',
    ...overrides,
  };
}

/** In-memory user store. Pass profiles (legacy) or full user records. */
export function fakeUserStore(users: Record<number, UserProfile | UserRecord> = {}): UserStore & {
  users: Map<number, UserRecord>;
} {
  const map = new Map<number, UserRecord>(
    Object.entries(users).map(([id, u]) => [
      Number(id),
      makeUser({ ...u, id: Number(id), difficulty: u.difficulty ?? 'easy' }),
    ]),
  );
  let nextId = Math.max(0, ...map.keys()) + 1;
  return {
    users: map,
    async getUser(id) {
      return map.get(id) ?? null;
    },
    async getProfile(id) {
      const u = map.get(id);
      return u ? { skills: u.skills, preferredLanguages: u.preferredLanguages, difficulty: u.difficulty } : null;
    },
    async upsertGithubUser(p) {
      const existing = [...map.values()].find((u) => u.login === p.login);
      const id = existing?.id ?? nextId++;
      map.set(id, makeUser({ ...existing, id, login: p.login, name: p.name, avatarUrl: p.avatarUrl }));
      return id;
    },
    async updateProfile(id, update) {
      const u = map.get(id);
      if (!u) return null;
      const next = { ...u, ...update };
      map.set(id, next);
      return next;
    },
  };
}

/** In-memory saved store over a fixed set of open issues; `closedIds` simulates issues closed since saving. */
export function fakeSavedStore(openIssues: IssueRecord[] = [], closedIds: number[] = []) {
  const saved = new Map<number, Map<number, Date>>();
  const forUser = (u: number) => saved.get(u) ?? saved.set(u, new Map()).get(u)!;
  const open = new Map(openIssues.map((i) => [i.id, i]));
  let tick = 0;
  const store: SavedStore = {
    async list(userId) {
      const entries = [...forUser(userId)].sort((a, b) => b[1].getTime() - a[1].getTime());
      return {
        rows: entries.filter(([id]) => open.has(id)).map(([id, savedAt]) => ({ ...open.get(id)!, savedAt })),
        hiddenClosed: entries.filter(([id]) => closedIds.includes(id)).length,
      };
    },
    async ids(userId) {
      return [...forUser(userId).keys()].filter((id) => open.has(id));
    },
    async save(userId, issueId) {
      if (forUser(userId).has(issueId)) return true;
      if (!open.has(issueId)) return false;
      forUser(userId).set(issueId, new Date(NOW.getTime() + tick++ * 1000));
      return true;
    },
    async remove(userId, issueId) {
      forUser(userId).delete(issueId);
    },
  };
  return { store, saved: forUser };
}

export function fakeOAuth(overrides: Partial<GitHubOAuth> = {}): GitHubOAuth {
  return {
    authorizeUrl: (state, redirectUri) =>
      `https://github.test/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async (code) => `token-for-${code}`,
    fetchProfile: async () => ({ id: 583231, login: 'octocat', name: 'The Octocat', avatarUrl: 'https://a/x.png' }),
    ...overrides,
  };
}

export function makePost(overrides: Partial<BlogPostRecord> = {}): BlogPostRecord {
  const id = overrides.id ?? 1;
  return {
    id,
    company: 'Acme',
    title: `Post ${id}`,
    url: `https://eng.acme.test/posts/${id}`,
    publishedAt: NOW,
    excerpt: 'A short excerpt.',
    tags: [],
    repos: [],
    ...overrides,
  };
}

/** In-memory blog store; honours the company filter and repo overlap like the pg version. */
export function fakeBlogStore(posts: BlogPostRecord[] = [], options: { failRelated?: boolean } = {}) {
  const byNewest = [...posts].sort(
    (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || b.id - a.id,
  );
  const store: BlogStore = {
    async findPosts(filters, limit) {
      const wanted = filters.companies?.map((c) => c.toLowerCase());
      const rows = byNewest.filter((p) => !wanted?.length || wanted.includes(p.company.toLowerCase()));
      return { rows: rows.slice(0, limit), total: rows.length };
    },
    async companies() {
      return [...new Set(posts.map((p) => p.company))].sort();
    },
    async relatedByRepos(repos, limit) {
      if (options.failRelated) throw new Error('blog store down');
      const wanted = new Set(repos.map((r) => r.toLowerCase()));
      return byNewest.filter((p) => p.repos.some((r) => wanted.has(r))).slice(0, limit);
    },
  };
  return store;
}

export function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    issueStore: fakeIssueStore([]).store,
    userStore: fakeUserStore(),
    savedStore: fakeSavedStore().store,
    blogStore: fakeBlogStore(),
    auth: { sessions, oauth: fakeOAuth(), clientUrl: 'http://localhost:5173' },
    now: () => NOW,
    ...overrides,
  };
}
