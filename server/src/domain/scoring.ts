import type { Difficulty } from './types.js';

export interface ScorableIssue {
  id: number;
  title: string;
  labels: string[];
  language: string | null;
  repoFullName: string;
  difficulty: Difficulty;
  assignee: string | null;
  updatedAt: Date | string;
  /** Repo metadata; null/undefined until fetched during ingest. */
  repoStars?: number | null;
  repoPushedAt?: Date | string | null;
  /** Number of comments; long threads are penalised (see crowdingMultiplier). */
  commentCount?: number | null;
}

export interface UserProfile {
  skills: string[];
  /** Ordered by preference: the first entry scores highest. */
  preferredLanguages: string[];
  difficulty?: Difficulty | null;
  /** Extra labels the user specifically wants (e.g. "documentation"). */
  preferredLabels?: string[];
}

export interface ScoreBreakdown {
  match: number;
  labels: number;
  difficulty: number;
  freshness: number;
  /** Repo quality: stars and recent pushes. Deliberately small weight; a tie-breaker, not a driver. */
  repo: number;
}

export interface ScoredIssue<T extends ScorableIssue = ScorableIssue> {
  issue: T;
  score: number; // 0..100
  breakdown: ScoreBreakdown; // each component 0..1
  /** Multiplier applied to the weighted score for busy threads: 1 = no penalty, down to CROWDING_FLOOR. */
  crowding: number;
}

export const WEIGHTS: Readonly<ScoreBreakdown> = {
  match: 0.38,
  labels: 0.19,
  difficulty: 0.24,
  freshness: 0.14,
  repo: 0.05,
};

/** Stars saturate at 10^4: log10(stars + 1) / 4, capped at 1 (100 stars = 0.5). */
export const REPO_STARS_SATURATION_LOG10 = 4;
/** Repo activity halves every this many days since the last push. */
export const REPO_ACTIVITY_HALF_LIFE_DAYS = 90;

/** Freshness halves every this many days since the issue was last updated. */
export const FRESHNESS_HALF_LIFE_DAYS = 45;

/**
 * Busy threads usually mean an issue is contested, already being worked on, or stuck in
 * debate: a poor first contribution. Up to CROWDING_FREE_COMMENTS there is no penalty
 * (the 99th percentile of open issues is ~20 comments); beyond that the score is scaled
 * down on a log scale, reaching CROWDING_FLOOR at CROWDING_FLOOR_COMMENTS and staying there.
 */
export const CROWDING_FREE_COMMENTS = 15;
export const CROWDING_FLOOR_COMMENTS = 60;
export const CROWDING_FLOOR = 0.7;

const NEUTRAL = 0.5;
const DAY_MS = 86_400_000;

const BEGINNER_LABEL_WEIGHTS: Record<string, number> = {
  'first-timers-only': 1,
  'first timers only': 1,
  'good first issue': 1,
  beginner: 0.9,
  'beginner friendly': 0.9,
  easy: 0.85,
  starter: 0.85,
  'help wanted': 0.6,
};
const NO_BEGINNER_LABEL = 0.2;

const DIFFICULTY_RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };
/** Keyed by (issue rank - user rank). Harder-than-you is penalised more than easier-than-you. */
const DIFFICULTY_FIT: Record<number, number> = { [-2]: 0.2, [-1]: 0.6, 0: 1, 1: 0.3, 2: 0 };

const normalizeLabel = (label: string) => label.toLowerCase().replace(/[-_:/]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Tokenizes while keeping language-ish tokens such as "c++", "c#" and "node.js" intact. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

function languageScore(language: string | null, preferred: string[]): number | null {
  if (preferred.length === 0) return null;
  if (!language) return 0;
  const idx = preferred.findIndex((p) => p.toLowerCase() === language.toLowerCase());
  if (idx === -1) return 0;
  return Math.max(1 - 0.1 * idx, 0.6);
}

function skillScore(issue: ScorableIssue, skills: string[]): number | null {
  return skillMatch([issue.title, issue.repoFullName, issue.language ?? '', ...issue.labels].join(' '), skills);
}

/**
 * Share of the user's skills (up to 3) found in `text` as whole tokens or phrases, 0..1;
 * null when the user listed no skills. Shared by issue and blog-post ranking.
 */
export function skillMatch(text: string, skills: string[]): number | null {
  const wanted = [...new Set(skills.map((s) => s.toLowerCase().trim()).filter(Boolean))];
  if (wanted.length === 0) return null;

  const tokens = new Set(tokenize(text));
  const phrase = ` ${tokenize(text).join(' ')} `;

  const matched = wanted.filter((skill) => {
    const skillTokens = tokenize(skill);
    if (skillTokens.length === 0) return false;
    // Single-token skills must match a whole token, so "go" doesn't match "going".
    if (skillTokens.length === 1) return tokens.has(skillTokens[0]!);
    return phrase.includes(` ${skillTokens.join(' ')} `);
  }).length;

  return Math.min(matched / Math.min(wanted.length, 3), 1);
}

export function matchScore(issue: ScorableIssue, profile: UserProfile): number {
  const lang = languageScore(issue.language, profile.preferredLanguages);
  const skill = skillScore(issue, profile.skills);
  if (lang !== null && skill !== null) return 0.6 * lang + 0.4 * skill;
  return lang ?? skill ?? NEUTRAL;
}

export function labelScore(labels: string[], preferredLabels: string[] = []): number {
  const normalized = labels.map(normalizeLabel);
  const preferred = new Set(preferredLabels.map(normalizeLabel));
  if (normalized.some((l) => preferred.has(l))) return 1;
  const best = Math.max(0, ...normalized.map((l) => BEGINNER_LABEL_WEIGHTS[l] ?? 0));
  return best > 0 ? best : NO_BEGINNER_LABEL;
}

export function difficultyFit(issue: Difficulty, user: Difficulty | null | undefined): number {
  if (!user) return NEUTRAL;
  return DIFFICULTY_FIT[DIFFICULTY_RANK[issue] - DIFFICULTY_RANK[user]]!;
}

export function freshnessScore(updatedAt: Date | string, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - new Date(updatedAt).getTime()) / DAY_MS);
  return 0.5 ** (ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

/**
 * Repo quality in 0..1: 60% stars (log-scaled), 40% recency of the last push.
 * Each missing signal scores neutral (0.5), so unfetched repos are neither boosted nor buried.
 */
export function repoQualityScore(
  stars: number | null | undefined,
  pushedAt: Date | string | null | undefined,
  now: Date,
): number {
  const starPart =
    stars == null ? NEUTRAL : Math.min(Math.log10(Math.max(stars, 0) + 1) / REPO_STARS_SATURATION_LOG10, 1);
  const activityPart =
    pushedAt == null
      ? NEUTRAL
      : 0.5 ** (Math.max(0, (now.getTime() - new Date(pushedAt).getTime()) / DAY_MS) / REPO_ACTIVITY_HALF_LIFE_DAYS);
  return 0.6 * starPart + 0.4 * activityPart;
}

/** Score multiplier for comment count: 1 up to 15 comments, log-scaled down to 0.7 at 60+. */
export function crowdingMultiplier(commentCount: number | null | undefined): number {
  if (commentCount == null || commentCount <= CROWDING_FREE_COMMENTS) return 1;
  const t = Math.min(
    Math.log(commentCount / CROWDING_FREE_COMMENTS) / Math.log(CROWDING_FLOOR_COMMENTS / CROWDING_FREE_COMMENTS),
    1,
  );
  return 1 - (1 - CROWDING_FLOOR) * t;
}

/** Scores one issue for a user. Returns null for issues that should not be recommended (assigned). */
export function scoreIssue<T extends ScorableIssue>(
  issue: T,
  profile: UserProfile,
  now: Date,
): ScoredIssue<T> | null {
  if (issue.assignee) return null;

  const breakdown: ScoreBreakdown = {
    match: matchScore(issue, profile),
    labels: labelScore(issue.labels, profile.preferredLabels),
    difficulty: difficultyFit(issue.difficulty, profile.difficulty),
    freshness: freshnessScore(issue.updatedAt, now),
    repo: repoQualityScore(issue.repoStars, issue.repoPushedAt, now),
  };
  const weighted = (Object.keys(WEIGHTS) as (keyof ScoreBreakdown)[]).reduce(
    (sum, key) => sum + WEIGHTS[key] * breakdown[key],
    0,
  );
  const crowding = crowdingMultiplier(issue.commentCount);
  return { issue, score: Math.round(weighted * crowding * 1000) / 10, breakdown, crowding };
}

/** Scores, filters and sorts issues: best score first, then most recently updated, then id. */
export function rankIssues<T extends ScorableIssue>(
  issues: T[],
  profile: UserProfile,
  now: Date,
): ScoredIssue<T>[] {
  return issues
    .map((issue) => scoreIssue(issue, profile, now))
    .filter((s): s is ScoredIssue<T> => s !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(b.issue.updatedAt).getTime() - new Date(a.issue.updatedAt).getTime() ||
        a.issue.id - b.issue.id,
    );
}
