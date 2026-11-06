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
}

export interface ScoredIssue<T extends ScorableIssue = ScorableIssue> {
  issue: T;
  score: number; // 0..100
  breakdown: ScoreBreakdown; // each component 0..1
}

export const WEIGHTS: Readonly<ScoreBreakdown> = {
  match: 0.4,
  labels: 0.2,
  difficulty: 0.25,
  freshness: 0.15,
};

/** Freshness halves every this many days since the issue was last updated. */
export const FRESHNESS_HALF_LIFE_DAYS = 45;

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
  const wanted = [...new Set(skills.map((s) => s.toLowerCase().trim()).filter(Boolean))];
  if (wanted.length === 0) return null;

  const text = [issue.title, issue.repoFullName, issue.language ?? '', ...issue.labels].join(' ');
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
  };
  const weighted = (Object.keys(WEIGHTS) as (keyof ScoreBreakdown)[]).reduce(
    (sum, key) => sum + WEIGHTS[key] * breakdown[key],
    0,
  );
  return { issue, score: Math.round(weighted * 1000) / 10, breakdown };
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
