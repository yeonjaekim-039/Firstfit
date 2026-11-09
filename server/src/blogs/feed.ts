/**
 * Blog feeds: fetch one RSS/Atom feed and turn its items into post metadata.
 * Only metadata is kept (title, canonical link, date, a short plain-text excerpt, tags,
 * mentioned repos). The full article in the feed is read to find repos and topics and is
 * then discarded; article pages are never fetched or scraped.
 */
import { convert } from 'html-to-text';
import Parser from 'rss-parser';
import { extractRepos } from './repos.js';
import { tagPost } from './tags.js';

export const USER_AGENT = 'GitHubIssueMatcher/1.0 (+https://issuematcher.duckdns.org)';
export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_FEED_BYTES = 10 * 1024 * 1024;
export const EXCERPT_MAX_CHARS = 300;

export interface ParsedPost {
  /** Canonical URL: the dedupe key. */
  url: string;
  title: string;
  publishedAt: Date | null;
  excerpt: string;
  tags: string[];
  repos: string[];
}

// ---------------------------------------------------------------------------------------------
// Canonical URLs

/** Query parameters that only track where a click came from; dropping them never changes the page. */
const TRACKING_PARAMS = /^(?:utm_[a-z_]+|source|ref|ref_src|gi|fbclid|gclid|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok)$/i;

/**
 * Normalizes a post link so the same article always maps to the same key: https, lowercase
 * host without "www.", no fragment, no tracking parameters, remaining parameters sorted.
 * The path is kept as published. Returns null for anything that isn't an http(s) URL.
 */
export function canonicalUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  const kept = [...url.searchParams].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(kept).toString();
  return url.toString();
}

// ---------------------------------------------------------------------------------------------
// Plain text and excerpts

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * HTML → plain text: tags, scripts, images, code blocks and link targets removed, entities
 * decoded, whitespace collapsed. `skipHeadings` drops section headings, which would otherwise
 * run into the following sentence in a one-line excerpt.
 */
export function toPlainText(html: string, { skipHeadings = false } = {}): string {
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      ...HEADINGS.map((selector) =>
        skipHeadings ? { selector, format: 'skip' } : { selector, options: { uppercase: false } },
      ),
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'figure', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'pre', format: 'skip' },
      { selector: 'table', format: 'skip' },
    ],
  });
  return text.replace(/\s+/g, ' ').trim();
}

/** Boilerplate some platforms append to summaries. */
const BOILERPLATE = [
  /\s*The post .{1,300}? appeared first on .{1,200}?\.?\s*$/i, // WordPress
  /\s*Continue reading on .{1,200}$/i, // Medium
];

/** A leading "<p>By Jane Doe, Joe Bloggs</p>" byline paragraph (Medium-style posts open with one). */
const LEADING_BYLINE = /^\s*<p[^>]*>\s*By\s[\s\S]*?<\/p>/i;

/** A plain-text excerpt of at most `max` characters, cut at a word boundary. */
export function makeExcerpt(html: string, max = EXCERPT_MAX_CHARS): string {
  const byline = LEADING_BYLINE.exec(html);
  if (byline && toPlainText(byline[0]).length < 250) html = html.slice(byline[0].length);
  let text = toPlainText(html, { skipHeadings: true });
  for (const pattern of BOILERPLATE) text = text.replace(pattern, '').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

// ---------------------------------------------------------------------------------------------
// Parsing

type Item = Omit<Parser.Item, 'categories'> & {
  'content:encoded'?: string;
  // RSS <category domain="…">x</category> arrives as { _: 'x', $: {…} }.
  categories?: (string | { _?: string })[];
};
const parser: Parser<Record<string, unknown>, Item> = new Parser();

const categoryText = (c: string | { _?: string }) => (typeof c === 'string' ? c : (c._ ?? ''));

/** Parses RSS 2.0 or Atom XML into posts. Items without a usable link or title are skipped. */
export async function parseFeed(xml: string): Promise<ParsedPost[]> {
  const feed = await parser.parseString(xml);
  const posts: ParsedPost[] = [];
  for (const item of feed.items) {
    const url = canonicalUrl(item.link) ?? (item.guid?.startsWith('http') ? canonicalUrl(item.guid) : null);
    const title = item.title ? toPlainText(item.title) : '';
    if (!url || !title) continue;

    // rss-parser: RSS <description> → content, <content:encoded> → 'content:encoded';
    // Atom <summary> → summary, <content> → content.
    const encoded = item['content:encoded'];
    const fullHtml = encoded ?? item.content ?? item.summary ?? '';
    const summaryHtml = item.summary ?? (encoded ? item.content : undefined) ?? '';
    // Prefer the publisher's own summary; fall back to the start of the article.
    const excerptSource = summaryHtml.trim() ? summaryHtml : fullHtml;
    const categories = (item.categories ?? []).map(categoryText).filter(Boolean);
    const date = item.isoDate ? new Date(item.isoDate) : null;

    posts.push({
      url,
      title,
      publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
      excerpt: makeExcerpt(excerptSource),
      tags: tagPost({ title, categories, body: toPlainText(fullHtml) }),
      repos: extractRepos(fullHtml + ' ' + summaryHtml),
    });
  }
  return dedupePosts(posts);
}

/** One post per canonical URL (first wins), so a feed listing an article twice upserts it once. */
export function dedupePosts(posts: ParsedPost[]): ParsedPost[] {
  const seen = new Set<string>();
  return posts.filter((p) => !seen.has(p.url) && seen.add(p.url));
}

// ---------------------------------------------------------------------------------------------
// Fetching

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Fetches a feed's XML with a timeout and a generic app User-Agent. Throws on HTTP errors and HTML pages. */
export async function fetchFeedXml(url: string, fetchFn: FetchFn = fetch, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const res = await fetchFn(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_FEED_BYTES) throw new Error(`feed too large (${length} bytes)`);
  const body = await res.text();
  if (body.length > MAX_FEED_BYTES) throw new Error(`feed too large (${body.length} chars)`);
  if (/^\s*(?:<!doctype html|<html)/i.test(body)) throw new Error('not a feed (got an HTML page)');
  return body;
}
