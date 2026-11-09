import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { fakeBlogStore, fakeIssueStore, fakeUserStore, makeDeps, makeIssue, makePost, NOW } from '../test/fakes.js';

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const POSTS = [
  makePost({ id: 1, company: 'Cloudflare', title: 'Rust at the edge', tags: ['rust'], repos: ['cloudflare/workerd'], publishedAt: daysAgo(20) }),
  makePost({ id: 2, company: 'Netflix', title: 'Billing pipelines', publishedAt: NOW }),
  makePost({ id: 3, company: 'GitHub', title: 'Merge queues in Rust', tags: ['rust', 'git'], publishedAt: daysAgo(5) }),
];

const setup = (issues = [] as ReturnType<typeof makeIssue>[]) => {
  const issueStore = fakeIssueStore(issues);
  const app = createApp(
    makeDeps({ blogStore: fakeBlogStore(POSTS), issueStore: issueStore.store, userStore: fakeUserStore({ 7: { skills: ['rust'], preferredLanguages: [] } }) }),
  );
  return { app, issueCalls: issueStore.calls };
};

describe('GET /api/blogs', () => {
  it('ranks posts by the profile and serves metadata only, linking to the original', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/blogs').query({ skills: 'rust' });
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { id: number }) => p.id)).toEqual([3, 1, 2]);
    expect(res.body.items[0]).toMatchObject({
      company: 'GitHub',
      title: 'Merge queues in Rust',
      url: 'https://eng.acme.test/posts/3',
      excerpt: 'A short excerpt.',
      tags: ['rust', 'git'],
      breakdown: { match: 1 },
    });
    expect(Object.keys(res.body.items[0])).not.toContain('content');
    expect(res.body.companies).toEqual(['Cloudflare', 'GitHub', 'Netflix']);
    expect(res.body.total).toBe(3);
  });

  it('filters by company (case-insensitive, list syntax)', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/blogs').query({ company: 'netflix,CLOUDFLARE' });
    expect(res.body.items.map((p: { company: string }) => p.company).sort()).toEqual(['Cloudflare', 'Netflix']);
    expect(res.body.total).toBe(2);
    // The filter list always offers every company, not just the filtered ones.
    expect(res.body.companies).toHaveLength(3);
  });

  it("loads the stored profile for userId and 404s for an unknown user", async () => {
    const { app } = setup();
    expect((await request(app).get('/api/blogs').query({ userId: 7 })).body.items[0].id).toBe(3);
    expect((await request(app).get('/api/blogs').query({ userId: 99 })).status).toBe(404);
  });

  it('attaches open beginner issues from repos a post mentions, best match first, at most 3', async () => {
    const issues = [1, 2, 3, 4].map((id) =>
      makeIssue({ id, repoFullName: 'cloudflare/workerd', title: id === 4 ? 'Rust: fix the build' : `Issue ${id}` }),
    );
    const { app, issueCalls } = setup([...issues, makeIssue({ id: 9, repoFullName: 'other/repo' })]);
    const res = await request(app).get('/api/blogs').query({ skills: 'rust' });

    expect(issueCalls[0]!.filters).toEqual({ repos: ['cloudflare/workerd'] });
    const rustPost = res.body.items.find((p: { id: number }) => p.id === 1);
    expect(rustPost.issues).toHaveLength(3);
    expect(rustPost.issues[0]).toMatchObject({ id: 4, repo: { fullName: 'cloudflare/workerd' } });
    // Posts without repos get no issues, and issues from unmentioned repos are never attached.
    expect(res.body.items.find((p: { id: number }) => p.id === 2).issues).toEqual([]);
  });

  it('fetches issues for every post on the page in one batched query, never one per post or repo', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makePost({ id: i + 1, repos: [`org/repo-${i}`, `org/repo-${i + 1}`] }),
    );
    const issueStore = fakeIssueStore([]);
    const app = createApp(makeDeps({ blogStore: fakeBlogStore(many), issueStore: issueStore.store }));
    await request(app).get('/api/blogs');
    expect(issueStore.calls).toHaveLength(1);
    expect(issueStore.calls[0]!.filters.repos).toHaveLength(21); // de-duplicated across posts
  });

  it('still renders posts (with no issues) when the issue lookup fails', async () => {
    const failing = {
      async findCandidates(): Promise<never> {
        throw new Error('database timeout');
      },
    };
    const app = createApp(makeDeps({ blogStore: fakeBlogStore(POSTS), issueStore: failing }));
    const res = await request(app).get('/api/blogs');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    for (const post of res.body.items) expect(post.issues).toEqual([]);
  });

  it('ranks the issues under a post by the user level, like the main matcher', async () => {
    const issues = [
      makeIssue({ id: 1, repoFullName: 'cloudflare/workerd', difficulty: 'hard' }),
      makeIssue({ id: 2, repoFullName: 'cloudflare/workerd', difficulty: 'easy' }),
    ];
    const { app } = setup(issues);
    const ids = async (level: string) =>
      (await request(app).get('/api/blogs').query({ level })).body.items
        .find((p: { id: number }) => p.id === 1)
        .issues.map((i: { id: number }) => i.id);
    expect(await ids('easy')).toEqual([2, 1]);
    expect(await ids('hard')).toEqual([1, 2]);
  });

  it('does not query issues when no post on the page mentions a repo', async () => {
    const { app, issueCalls } = setup();
    await request(app).get('/api/blogs').query({ company: 'Netflix' });
    expect(issueCalls).toHaveLength(0);
  });

  it('rejects an oversized page size', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/blogs').query({ pageSize: 500 })).status).toBe(400);
  });
});

describe('related posts on issue cards', () => {
  const posts = [
    makePost({ id: 1, title: 'Newest workerd post', repos: ['cloudflare/workerd'], publishedAt: NOW }),
    makePost({ id: 2, title: 'Older workerd post', repos: ['cloudflare/workerd', 'x/y'], publishedAt: daysAgo(3) }),
    makePost({ id: 3, title: 'Oldest workerd post', repos: ['cloudflare/workerd'], publishedAt: daysAgo(9) }),
    makePost({ id: 4, title: 'Unrelated', repos: ['someone/else'] }),
  ];

  it('adds up to two posts that mention the issue repo, matched case-insensitively', async () => {
    const app = createApp(
      makeDeps({
        blogStore: fakeBlogStore(posts),
        issueStore: fakeIssueStore([
          makeIssue({ id: 1, repoFullName: 'Cloudflare/Workerd' }),
          makeIssue({ id: 2, repoFullName: 'acme/app' }),
        ]).store,
      }),
    );
    const res = await request(app).get('/api/issues');
    const byId = Object.fromEntries(res.body.items.map((i: { id: number }) => [i.id, i]));
    expect(byId[1].relatedPosts.map((p: { title: string }) => p.title)).toEqual(['Newest workerd post', 'Older workerd post']);
    expect(byId[1].relatedPosts[0]).toEqual({
      id: 1,
      company: 'Acme',
      title: 'Newest workerd post',
      url: 'https://eng.acme.test/posts/1',
      publishedAt: NOW.toISOString(),
    });
    // No post mentions acme/app, so nothing is shown: no topic-based guessing.
    expect(byId[2].relatedPosts).toEqual([]);
  });

  it('still serves issues when the blog store fails', async () => {
    const app = createApp(
      makeDeps({
        blogStore: fakeBlogStore(posts, { failRelated: true }),
        issueStore: fakeIssueStore([makeIssue({ id: 1, repoFullName: 'cloudflare/workerd' })]).store,
      }),
    );
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(200);
    expect(res.body.items[0].relatedPosts).toEqual([]);
  });
});
