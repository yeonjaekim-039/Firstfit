import type { Difficulty } from '../domain/types.js';

export interface DifficultyInput {
  labels: string[];
  commentCount: number;
  bodyLength: number;
}

// Label substrings that signal difficulty. Matched against lowercased label names,
// so "difficulty: easy", "good first issue", "Level: Hard" etc. all count.
const EXPLICIT_EASY = ['first-timers-only', 'good first issue', 'beginner', 'easy', 'starter', 'trivial', 'typo'];
const EXPLICIT_MEDIUM = ['medium', 'intermediate', 'moderate'];
const EXPLICIT_HARD = ['hard', 'difficult', 'complex', 'advanced', 'expert'];
const SOFT_EASY = ['documentation', 'docs'];

const hasAny = (labels: string[], needles: string[]) =>
  labels.some((label) => needles.some((needle) => label.includes(needle)));

/**
 * Heuristic difficulty score: negative leans easy, positive leans hard.
 * Labels dominate; comment count and body length nudge the result
 * (long discussions and long specs usually mean a harder task).
 */
export function difficultyScore({ labels, commentCount, bodyLength }: DifficultyInput): number {
  const lower = labels.map((l) => l.toLowerCase());
  let score = 0;

  if (hasAny(lower, EXPLICIT_HARD)) score += 3;
  else if (hasAny(lower, EXPLICIT_MEDIUM)) score += 1.5;
  if (lower.includes('first-timers-only')) score -= 3;
  else if (hasAny(lower, EXPLICIT_EASY)) score -= 2;
  if (hasAny(lower, SOFT_EASY)) score -= 0.5;
  if (lower.includes('help wanted')) score += 0.5;

  if (commentCount > 10) score += 1.5;
  else if (commentCount > 4) score += 0.5;

  if (bodyLength > 3000) score += 1.5;
  else if (bodyLength > 1200) score += 0.5;
  else if (bodyLength < 300) score -= 0.5;

  return score;
}

export function computeDifficulty(input: DifficultyInput): Difficulty {
  const score = difficultyScore(input);
  if (score <= -1) return 'easy';
  if (score < 1.5) return 'medium';
  return 'hard';
}
