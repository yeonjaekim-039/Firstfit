/**
 * Simple keyword topic tagging for blog posts (the app has no embeddings to reuse).
 * Pure: no I/O.
 *
 * A topic is tagged when one of its patterns appears in the title or the feed's own
 * categories, or at least BODY_MIN_HITS times in the start of the body. Requiring repeats in
 * the body keeps a single passing mention ("…unlike Java…") from tagging the post.
 * Language tags use the same lowercased names as the issue crawler's languages, so a
 * user's preferred languages can be matched against them directly.
 */

export const BODY_MIN_HITS = 2;
/** Only the start of the body is scanned: enough to see what a post is about. */
export const BODY_SCAN_CHARS = 8000;

export const TOPICS: Readonly<Record<string, RegExp[]>> = {
  // Languages (names match ingest/queries.ts LANGUAGES, lowercased)
  javascript: [/\bjavascript\b/i, /\bnode\.?js\b/i],
  typescript: [/\btypescript\b/i],
  python: [/\bpython\b/i, /\bpytorch\b/i, /\bdjango\b/i],
  java: [/\bjava\b/i, /\bjvm\b/i, /\bspring boot\b/i],
  // "Go" is an ordinary English word, so require "golang" or Go in a language-shaped phrase (case-sensitive).
  go: [
    /\bgolang\b/i,
    /\b(?:in|with|using|written in|for) Go\b/,
    /\bGo (?:code|service|services|program|programs|library|libraries|module|modules|runtime|binary|developers?)\b/,
  ],
  rust: [/\brust\b/i],
  'c++': [/(?:^|[^a-z0-9])c\+\+/i],
  'c#': [/(?:^|[^a-z0-9])c#/i, /\.net\b/i],
  ruby: [/\bruby\b/i, /\brails\b/i],
  php: [/\bphp\b/i],
  // Topics
  // "React" case-sensitive so the verb ("react to alerts") doesn't count; "browser" alone was
  // too broad (security and networking posts mention browsers constantly).
  frontend: [/\bfront-?end\b/i, /\bReact\b/, /\bcss\b/i],
  mobile: [/\bios\b/i, /\bandroid\b/i, /\bkotlin\b/i, /\bSwift(?:UI)?\b/],
  'ai-ml': [/\bAI\b/, /\bLLMs?\b/i, /\bmachine learning\b/i, /\bgenerative\b/i, /\binference\b/i, /\bagentic\b/i],
  security: [/\bsecurity\b/i, /\bvulnerabilit(?:y|ies)\b/i, /\bcryptograph\w*\b/i, /\bencryption\b/i, /\bpost-quantum\b/i],
  'data-engineering': [/\bdata (?:engineering|pipelines?|platform|warehouse)\b/i, /\bspark\b/i, /\bkafka\b/i, /\betl\b/i],
  databases: [/\bdatabases?\b/i, /\bpostgres(?:ql)?\b/i, /\bmysql\b/i, /\bsql\b/i, /\bcassandra\b/i, /\bredis\b/i],
  infrastructure: [/\bkubernetes\b/i, /\bk8s\b/i, /\bdocker\b/i, /\bserverless\b/i, /\binfrastructure\b/i],
  networking: [/\bdns\b/i, /\btcp\b/i, /\bquic\b/i, /\bbgp\b/i, /\bnetworking\b/i, /\bcdn\b/i],
  performance: [/\bperformance\b/i, /\blatency\b/i, /\bthroughput\b/i],
  observability: [/\bobservability\b/i, /\bmonitoring\b/i, /\btracing\b/i, /\balerting\b/i],
  'distributed-systems': [/\bdistributed systems?\b/i, /\bconsensus\b/i, /\breplication\b/i, /\bmicroservices?\b/i],
  'testing-ci': [/\btesting\b/i, /\bunit tests?\b/i, /\bci\/cd\b/i, /\bcontinuous integration\b/i],
  'open-source': [/\bopen[- ]source\b/i],
  git: [/\bgit\b/i],
  payments: [/\bpayments?\b/i, /\bbilling\b/i, /\bfraud\b/i],
  accessibility: [/\baccessibility\b/i, /\ba11y\b/i],
};

const countHits = (pattern: RegExp, text: string): number => {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  return [...text.matchAll(new RegExp(pattern.source, flags))].length;
};

export interface TagInput {
  title: string;
  /** The feed's own <category> values for the item. */
  categories?: string[];
  /** Plain-text body (or summary); only the first BODY_SCAN_CHARS are scanned. */
  body?: string;
}

export function tagPost({ title, categories = [], body = '' }: TagInput): string[] {
  const headline = [title, ...categories].join(' \n ');
  const start = body.slice(0, BODY_SCAN_CHARS);
  return Object.entries(TOPICS)
    .filter(([, patterns]) => {
      if (patterns.some((p) => p.test(headline))) return true;
      return patterns.reduce((n, p) => n + countHits(p, start), 0) >= BODY_MIN_HITS;
    })
    .map(([tag]) => tag);
}
