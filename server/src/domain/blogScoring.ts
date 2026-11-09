/**
 * Pure ranking for company engineering-blog posts, using the same profile as issue matching
 * (skills and preferred languages). Difficulty level doesn't apply to articles.
 * No I/O; `now` is passed in.
 */
import { skillMatch, type UserProfile } from './scoring.js';

export interface ScorablePost {
  id: number;
  title: string;
  excerpt: string;
  company: string;
  tags: string[];
  publishedAt: Date | string | null;
}

export interface PostBreakdown {
  match: number;
  freshness: number;
}

export interface ScoredPost<T extends ScorablePost = ScorablePost> {
  post: T;
  score: number; // 0..100
  breakdown: PostBreakdown;
}

export const POST_WEIGHTS: Readonly<PostBreakdown> = { match: 0.75, freshness: 0.25 };
/** Articles stay useful longer than issues stay open, so they decay more slowly. */
export const POST_FRESHNESS_HALF_LIFE_DAYS = 120;

const NEUTRAL = 0.5;
const DAY_MS = 86_400_000;

/** 1.0 when a post is tagged with the user's first-choice language, −0.1 per later choice (floor 0.6), else 0. */
function languageMatch(tags: string[], preferred: string[]): number | null {
  if (preferred.length === 0) return null;
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const idx = preferred.findIndex((p) => tagSet.has(p.toLowerCase()));
  return idx === -1 ? 0 : Math.max(1 - 0.1 * idx, 0.6);
}

/** Same blend as issue matching: 60% language, 40% skills; whichever is missing is dropped; neither → 0.5. */
export function postMatchScore(post: ScorablePost, profile: UserProfile): number {
  const lang = languageMatch(post.tags, profile.preferredLanguages);
  const skill = skillMatch([post.title, post.excerpt, post.company, ...post.tags].join(' '), profile.skills);
  if (lang !== null && skill !== null) return 0.6 * lang + 0.4 * skill;
  return lang ?? skill ?? NEUTRAL;
}

export function postFreshness(publishedAt: Date | string | null, now: Date): number {
  if (publishedAt == null) return NEUTRAL;
  const ageDays = Math.max(0, (now.getTime() - new Date(publishedAt).getTime()) / DAY_MS);
  return 0.5 ** (ageDays / POST_FRESHNESS_HALF_LIFE_DAYS);
}

export function scorePost<T extends ScorablePost>(post: T, profile: UserProfile, now: Date): ScoredPost<T> {
  const breakdown = { match: postMatchScore(post, profile), freshness: postFreshness(post.publishedAt, now) };
  const weighted = POST_WEIGHTS.match * breakdown.match + POST_WEIGHTS.freshness * breakdown.freshness;
  return { post, score: Math.round(weighted * 1000) / 10, breakdown };
}

/** Best score first, then newest, then id. */
export function rankPosts<T extends ScorablePost>(posts: T[], profile: UserProfile, now: Date): ScoredPost<T>[] {
  const time = (p: ScorablePost) => (p.publishedAt ? new Date(p.publishedAt).getTime() : 0);
  return posts
    .map((p) => scorePost(p, profile, now))
    .sort((a, b) => b.score - a.score || time(b.post) - time(a.post) || a.post.id - b.post.id);
}
