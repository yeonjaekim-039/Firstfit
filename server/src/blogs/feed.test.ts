import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalUrl,
  dedupePosts,
  EXCERPT_MAX_CHARS,
  fetchFeedXml,
  makeExcerpt,
  parseFeed,
  type ParsedPost,
  USER_AGENT,
} from './feed.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parseFeed', () => {
  it('parses a Medium-style RSS feed (article in content:encoded, no description)', async () => {
    const posts = await parseFeed(fixture('medium.rss.xml'));
    // The tracking-param duplicate collapses into the first item; the link-less item is skipped.
    expect(posts).toHaveLength(1);
    const [post] = posts;
    expect(post).toMatchObject({
      url: 'https://techblog.example.com/scaling-python-pipelines-6b0811a1c015',
      title: 'Scaling our Python data pipelines with Kafka',
      publishedAt: new Date('2026-10-26T17:04:57Z'),
      repos: ['example-oss/stream-kit', 'apache/kafka', 'confluentinc/confluent-kafka-python'],
    });
    expect(post!.tags).toEqual(expect.arrayContaining(['python', 'data-engineering']));
    // The byline paragraph and the section heading are dropped; the excerpt starts with prose.
    expect(post!.excerpt).toMatch(/^Our streaming platform moves billions of events/);
    expect(post!.excerpt).not.toContain('Jane Doe');
  });

  it('parses a WordPress-style RSS feed: decodes entities, strips HTML and the "appeared first on" footer', async () => {
    const posts = await parseFeed(fixture('wordpress.rss.xml'));
    expect(posts.map((p) => p.url)).toEqual([
      'https://blog.example.org/engineering/architecture/inside-new-git-storage/',
      'https://blog.example.org/post-quantum-privacy/',
    ]);
    const [git, pq] = posts;
    expect(git!.title).toBe('Inside our new Git storage — built for agents & humans');
    expect(git!.excerpt).toMatch(/^Our new Git storage architecture lets thousands of agents push/);
    expect(git!.excerpt).not.toMatch(/appeared first on|<|&mdash;|&#8217;/);
    expect(git!.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
    expect(git!.excerpt.endsWith('…')).toBe(true);
    // Categories with attributes (<category domain="post_tag">) still count.
    expect(git!.tags).toEqual(expect.arrayContaining(['git', 'infrastructure', 'distributed-systems']));
    expect(git!.repos).toEqual(['git/git', 'example/spokes-lite']);
    // Bare URLs in text are found too.
    expect(pq!.repos).toEqual(['example/pq-privacy-pass']);
    expect(pq!.tags).toContain('security');
  });

  it('parses a description-only RSS feed and tolerates a bad date', async () => {
    const [first, second] = await parseFeed(fixture('description-only.rss.xml'));
    expect(first).toMatchObject({
      title: 'Analyze your payments data directly with your agent',
      publishedAt: new Date('2026-11-05T00:00:00Z'),
      excerpt: 'You can now use natural language to build a report on your payments, billing and fraud trends, straight from your data.',
      repos: [],
    });
    expect(first!.tags).toContain('payments');
    expect(second).toMatchObject({ url: 'https://payments.example.com/blog/no-date', publishedAt: null });
  });

  it('parses an Atom feed, preferring <summary> for the excerpt and scanning <content> for repos', async () => {
    const posts = await parseFeed(fixture('atom.xml'));
    expect(posts).toHaveLength(1); // the entry without a link is skipped
    expect(posts[0]).toMatchObject({
      url: 'https://atom.example.net/posts/rust-cli?lang=en',
      title: 'Rewriting our CLI in Rust & TypeScript',
      publishedAt: new Date('2026-11-01T09:30:00Z'),
      excerpt: 'We moved our command-line tool from Python to Rust for speed, and kept a TypeScript SDK for plugins.',
      repos: ['atom-example/fast-cli'],
    });
    expect(posts[0]!.tags).toEqual(expect.arrayContaining(['rust', 'typescript']));
  });

  it('never emits a non-http(s) link: javascript:, data:, vbscript: and relative links are dropped', async () => {
    // medium.rss.xml also contains hostile items (javascript: in <link> and <guid>, a tab-split
    // "java\tscript:", data:, vbscript:, and a relative path); none may become a post.
    const posts = await parseFeed(fixture('medium.rss.xml'));
    expect(posts.map((p) => p.title)).toEqual(['Scaling our Python data pipelines with Kafka']);
    for (const p of posts) expect(p.url).toMatch(/^https:\/\//);
  });

  it('rejects input that is not a feed', async () => {
    await expect(parseFeed(fixture('not-a-feed.html'))).rejects.toThrow();
    await expect(parseFeed('this is not xml')).rejects.toThrow();
  });
});

describe('canonicalUrl', () => {
  it('drops tracking parameters, fragments and "www.", and forces https', () => {
    expect(canonicalUrl('http://www.Example.com/post?utm_source=x&utm_medium=y&source=rss----1#top')).toBe(
      'https://example.com/post',
    );
    expect(canonicalUrl('https://medium.com/p/abc?source=rss----2615bd06b42e---4')).toBe('https://medium.com/p/abc');
  });

  it('keeps meaningful parameters, sorted, and the path as published', () => {
    expect(canonicalUrl('https://a.test/x/?page=2&lang=en&ref=hn')).toBe('https://a.test/x/?lang=en&page=2');
  });

  it('maps tracking variants of one article to the same key', () => {
    const variants = [
      'https://blog.test/a-post',
      'https://www.blog.test/a-post?utm_campaign=launch',
      'http://blog.test/a-post#comments',
      'https://BLOG.test/a-post?fbclid=123&gclid=456',
    ];
    expect(new Set(variants.map(canonicalUrl)).size).toBe(1);
  });

  it('returns null for missing, relative or non-http links', () => {
    expect(canonicalUrl(undefined)).toBeNull();
    expect(canonicalUrl('')).toBeNull();
    expect(canonicalUrl('/relative/path')).toBeNull();
    expect(canonicalUrl('//evil.test/x')).toBeNull();
    expect(canonicalUrl('mailto:a@b.test')).toBeNull();
    expect(canonicalUrl('ftp://files.test/x')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'javascript://https://example.com/%0aalert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
  ])('rejects the script/data URL %j', (raw) => {
    expect(canonicalUrl(raw)).toBeNull();
  });

  it('only ever returns https URLs', () => {
    expect(canonicalUrl('http://blog.test/a')).toBe('https://blog.test/a');
    expect(canonicalUrl('HTTPS://Blog.Test/A')).toBe('https://blog.test/A');
  });
});

describe('dedupePosts', () => {
  const post = (url: string, title: string): ParsedPost => ({
    url, title, publishedAt: null, excerpt: '', tags: [], repos: [],
  });

  it('keeps the first post for each canonical URL, in order', () => {
    expect(dedupePosts([post('u1', 'a'), post('u2', 'b'), post('u1', 'c')]).map((p) => p.title)).toEqual(['a', 'b']);
  });
});

describe('makeExcerpt', () => {
  it('returns sanitized plain text with scripts, images and code removed', () => {
    const html = '<script>evil()</script><p>Hello <b>world</b> &amp; friends<img src="x" onerror="evil()"></p><pre>rm -rf</pre>';
    expect(makeExcerpt(html)).toBe('Hello world & friends');
  });

  it('caps the length at a word boundary with an ellipsis', () => {
    const excerpt = makeExcerpt(`<p>${'word '.repeat(200)}</p>`);
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS);
    expect(excerpt).toMatch(/word…$/);
  });
});

describe('fetchFeedXml', () => {
  const ok = (body: string, headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(body, { status: 200, headers }));

  it('sends the app User-Agent and a timeout signal', async () => {
    const fetchFn = ok('<rss/>');
    await fetchFeedXml('https://feed.test/rss', fetchFn, 1234);
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on HTTP errors', async () => {
    const fetchFn = vi.fn(async () => new Response('Not Found', { status: 404 }));
    await expect(fetchFeedXml('https://feed.test/rss', fetchFn)).rejects.toThrow('HTTP 404');
  });

  it('throws when a 200 response is an HTML page rather than a feed', async () => {
    await expect(fetchFeedXml('https://feed.test/rss', ok(fixture('not-a-feed.html')))).rejects.toThrow(
      'not a feed',
    );
  });

  it('throws on an oversized feed', async () => {
    await expect(
      fetchFeedXml('https://feed.test/rss', ok('<rss/>', { 'content-length': String(50 * 1024 * 1024) })),
    ).rejects.toThrow('too large');
  });
});
