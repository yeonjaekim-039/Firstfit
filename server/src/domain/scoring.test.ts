import { describe, expect, it } from 'vitest';
import {
  difficultyFit,
  FRESHNESS_HALF_LIFE_DAYS,
  freshnessScore,
  labelScore,
  matchScore,
  rankIssues,
  REPO_ACTIVITY_HALF_LIFE_DAYS,
  repoQualityScore,
  type ScorableIssue,
  scoreIssue,
  type UserProfile,
  WEIGHTS,
} from './scoring.js';

const NOW = new Date('2026-11-01T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const issue = (overrides: Partial<ScorableIssue> = {}): ScorableIssue => ({
  id: 1,
  title: 'Add dark mode toggle to settings page',
  labels: ['good first issue'],
  language: 'TypeScript',
  repoFullName: 'acme/web-app',
  difficulty: 'easy',
  assignee: null,
  updatedAt: NOW,
  ...overrides,
});

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  skills: [],
  preferredLanguages: [],
  difficulty: null,
  ...overrides,
});

describe('WEIGHTS', () => {
  it('sum to 1 so scores land in 0..100', () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('matchScore', () => {
  it('is neutral (0.5) with no skills and no languages', () => {
    expect(matchScore(issue(), profile())).toBe(0.5);
  });

  it('gives full credit for the first preferred language', () => {
    expect(matchScore(issue(), profile({ preferredLanguages: ['TypeScript', 'Go'] }))).toBe(1);
  });

  it('decays by preference order, floored at 0.6', () => {
    const langs = ['A', 'B', 'TypeScript'];
    expect(matchScore(issue(), profile({ preferredLanguages: langs }))).toBeCloseTo(0.8);
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'TypeScript'];
    expect(matchScore(issue(), profile({ preferredLanguages: many }))).toBeCloseTo(0.6);
  });

  it('matches languages case-insensitively', () => {
    expect(matchScore(issue(), profile({ preferredLanguages: ['typescript'] }))).toBe(1);
  });

  it('scores 0 for a non-preferred language or a missing language', () => {
    expect(matchScore(issue(), profile({ preferredLanguages: ['Rust'] }))).toBe(0);
    expect(matchScore(issue({ language: null }), profile({ preferredLanguages: ['Rust'] }))).toBe(0);
  });

  it('matches skills against title, labels, repo name and language', () => {
    expect(matchScore(issue({ title: 'Fix React hook warning' }), profile({ skills: ['react'] }))).toBe(1);
    expect(matchScore(issue({ labels: ['css'] }), profile({ skills: ['CSS'] }))).toBe(1);
    expect(matchScore(issue({ repoFullName: 'acme/django-admin' }), profile({ skills: ['django'] }))).toBe(1);
    expect(matchScore(issue(), profile({ skills: ['typescript'] }))).toBe(1);
  });

  it('requires whole-token matches for single-word skills', () => {
    const i = issue({ title: 'Going forward, update the Google login flow', language: 'Python' });
    expect(matchScore(i, profile({ skills: ['go'] }))).toBe(0);
  });

  it('keeps symbol-bearing tokens like c++, c# and node.js intact', () => {
    expect(matchScore(issue({ title: 'Port parser to C++' }), profile({ skills: ['c++'] }))).toBe(1);
    expect(matchScore(issue({ title: 'Port parser to C++' }), profile({ skills: ['c'] }))).toBe(0);
    expect(matchScore(issue({ title: 'Upgrade Node.js to v22.' }), profile({ skills: ['node.js'] }))).toBe(1);
  });

  it('matches multi-word skills as phrases', () => {
    const i = issue({ title: 'Improve machine learning docs' });
    expect(matchScore(i, profile({ skills: ['machine learning'] }))).toBe(1);
    expect(matchScore(issue({ title: 'Learning about machines' }), profile({ skills: ['machine learning'] }))).toBe(0);
  });

  it('gives partial skill credit, saturating at three matched skills', () => {
    const i = issue({ title: 'Add React form with CSS validation', labels: [] });
    expect(matchScore(i, profile({ skills: ['react', 'vue', 'svelte', 'angular'] }))).toBeCloseTo(1 / 3);
    expect(matchScore(i, profile({ skills: ['react', 'css', 'html'] }))).toBeCloseTo(2 / 3);
    expect(matchScore(i, profile({ skills: ['react', 'css'] }))).toBe(1);
  });

  it('ignores blank and duplicate skills', () => {
    const i = issue({ title: 'React bug' });
    expect(matchScore(i, profile({ skills: ['react', 'React', ' ', ''] }))).toBe(1);
    expect(matchScore(i, profile({ skills: ['  '] }))).toBe(0.5);
  });

  it('blends language (60%) and skills (40%) when both are given', () => {
    const p = profile({ preferredLanguages: ['TypeScript'], skills: ['rust'] });
    expect(matchScore(issue(), p)).toBeCloseTo(0.6);
    const p2 = profile({ preferredLanguages: ['Go'], skills: ['typescript'] });
    expect(matchScore(issue(), p2)).toBeCloseTo(0.4);
  });
});

describe('labelScore', () => {
  it('ranks beginner labels', () => {
    expect(labelScore(['first-timers-only'])).toBe(1);
    expect(labelScore(['good first issue'])).toBe(1);
    expect(labelScore(['beginner'])).toBe(0.9);
    expect(labelScore(['easy'])).toBe(0.85);
    expect(labelScore(['help wanted'])).toBe(0.6);
  });

  it('normalizes case and separators', () => {
    expect(labelScore(['Good-First-Issue'])).toBe(1);
    expect(labelScore(['help_wanted'])).toBe(0.6);
  });

  it('takes the best label when several apply', () => {
    expect(labelScore(['help wanted', 'bug', 'beginner'])).toBe(0.9);
  });

  it('gives a low floor when no beginner label is present', () => {
    expect(labelScore(['bug'])).toBe(0.2);
    expect(labelScore([])).toBe(0.2);
  });

  it('gives full credit for a user-preferred label', () => {
    expect(labelScore(['help wanted', 'documentation'], ['Documentation'])).toBe(1);
  });
});

describe('difficultyFit', () => {
  it('is neutral when the user has no level', () => {
    expect(difficultyFit('hard', null)).toBe(0.5);
    expect(difficultyFit('easy', undefined)).toBe(0.5);
  });

  it('is 1 for an exact match', () => {
    expect(difficultyFit('easy', 'easy')).toBe(1);
    expect(difficultyFit('medium', 'medium')).toBe(1);
    expect(difficultyFit('hard', 'hard')).toBe(1);
  });

  it('penalizes harder-than-level more than easier-than-level', () => {
    expect(difficultyFit('medium', 'easy')).toBe(0.3);
    expect(difficultyFit('easy', 'medium')).toBe(0.6);
    expect(difficultyFit('hard', 'easy')).toBe(0);
    expect(difficultyFit('easy', 'hard')).toBe(0.2);
  });
});

describe('freshnessScore', () => {
  it('is 1 for an issue updated now', () => {
    expect(freshnessScore(NOW, NOW)).toBe(1);
  });

  it('halves every half-life', () => {
    expect(freshnessScore(daysAgo(FRESHNESS_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.5);
    expect(freshnessScore(daysAgo(FRESHNESS_HALF_LIFE_DAYS * 2), NOW)).toBeCloseTo(0.25);
  });

  it('accepts ISO strings and clamps future timestamps to 1', () => {
    expect(freshnessScore(daysAgo(FRESHNESS_HALF_LIFE_DAYS).toISOString(), NOW)).toBeCloseTo(0.5);
    expect(freshnessScore(daysAgo(-3), NOW)).toBe(1);
  });

  it('is monotonically decreasing with age', () => {
    const scores = [0, 1, 10, 100, 1000].map((d) => freshnessScore(daysAgo(d), NOW));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]!);
  });
});

describe('repoQualityScore', () => {
  it('is neutral (0.5) when nothing is known', () => {
    expect(repoQualityScore(null, null, NOW)).toBe(0.5);
    expect(repoQualityScore(undefined, undefined, NOW)).toBe(0.5);
  });

  it('log-scales stars and saturates at 10k', () => {
    const starsOnly = (stars: number) => (repoQualityScore(stars, NOW, NOW) - 0.4) / 0.6;
    expect(starsOnly(0)).toBeCloseTo(0);
    expect(starsOnly(99)).toBeCloseTo(0.5);
    expect(starsOnly(9_999)).toBeCloseTo(1);
    expect(starsOnly(1_000_000)).toBe(1);
  });

  it('rewards recent pushes with a 90-day half-life', () => {
    const activityOnly = (days: number) => (repoQualityScore(9_999, daysAgo(days), NOW) - 0.6) / 0.4;
    expect(activityOnly(0)).toBeCloseTo(1);
    expect(activityOnly(REPO_ACTIVITY_HALF_LIFE_DAYS)).toBeCloseTo(0.5);
    expect(activityOnly(REPO_ACTIVITY_HALF_LIFE_DAYS * 4)).toBeCloseTo(1 / 16);
  });

  it('is monotonic in stars and in recency', () => {
    expect(repoQualityScore(1000, NOW, NOW)).toBeGreaterThan(repoQualityScore(10, NOW, NOW));
    expect(repoQualityScore(100, daysAgo(5), NOW)).toBeGreaterThan(repoQualityScore(100, daysAgo(500), NOW));
  });

  it('treats each missing signal as neutral independently', () => {
    expect(repoQualityScore(9_999, null, NOW)).toBeCloseTo(0.6 + 0.4 * 0.5);
    expect(repoQualityScore(null, NOW, NOW)).toBeCloseTo(0.6 * 0.5 + 0.4);
  });

  it('clamps negative stars and future push dates', () => {
    expect(repoQualityScore(-5, daysAgo(-10), NOW)).toBeCloseTo(0.4);
  });
});

describe('scoreIssue', () => {
  it('gives a small boost (at most 5 points) to popular, active repos', () => {
    const p = profile({ preferredLanguages: ['TypeScript'], difficulty: 'easy' });
    const best = scoreIssue(issue({ repoStars: 20_000, repoPushedAt: NOW }), p, NOW)!.score;
    const worst = scoreIssue(issue({ repoStars: 0, repoPushedAt: daysAgo(3000) }), p, NOW)!.score;
    const unknown = scoreIssue(issue(), p, NOW)!.score;
    expect(best).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(worst);
    expect(best - worst).toBeLessThanOrEqual(WEIGHTS.repo * 100 + 1e-9);
  });

  it('never lets repo quality outrank a clearly better match', () => {
    const p = profile({ preferredLanguages: ['TypeScript'], difficulty: 'easy' });
    const ranked = rankIssues(
      [
        issue({ id: 1, language: 'Go', repoStars: 200_000, repoPushedAt: NOW }),
        issue({ id: 2, repoStars: 0, repoPushedAt: daysAgo(2000) }),
      ],
      p,
      NOW,
    );
    expect(ranked[0]!.issue.id).toBe(2);
  });

  it('breaks otherwise-equal ties in favour of the stronger repo', () => {
    const ranked = rankIssues(
      [issue({ id: 1, repoStars: 3 }), issue({ id: 2, repoStars: 30_000 })],
      profile(),
      NOW,
    );
    expect(ranked.map((r) => r.issue.id)).toEqual([2, 1]);
  });

  it('returns null for assigned issues', () => {
    expect(scoreIssue(issue({ assignee: 'octocat' }), profile(), NOW)).toBeNull();
  });

  it('scores a perfect match as 100', () => {
    const result = scoreIssue(
      issue({ title: 'React: add dark mode', repoStars: 50_000, repoPushedAt: NOW }),
      profile({ skills: ['react'], preferredLanguages: ['TypeScript'], difficulty: 'easy' }),
      NOW,
    )!;
    expect(result.score).toBe(100);
    expect(result.breakdown).toEqual({ match: 1, labels: 1, difficulty: 1, freshness: 1, repo: 1 });
  });

  it('combines components using WEIGHTS', () => {
    const result = scoreIssue(
      issue({ labels: ['help wanted'], difficulty: 'medium', updatedAt: daysAgo(FRESHNESS_HALF_LIFE_DAYS) }),
      profile({ preferredLanguages: ['Go'], difficulty: 'easy' }),
      NOW,
    )!;
    // No repo metadata -> neutral 0.5 for the repo component.
    const expected =
      WEIGHTS.match * 0 +
      WEIGHTS.labels * 0.6 +
      WEIGHTS.difficulty * 0.3 +
      WEIGHTS.freshness * 0.5 +
      WEIGHTS.repo * 0.5;
    expect(result.score).toBeCloseTo(expected * 100, 1);
  });

  it('stays within 0..100 and rounds to one decimal', () => {
    const result = scoreIssue(
      issue({ labels: [], difficulty: 'hard', updatedAt: daysAgo(5000) }),
      profile({ preferredLanguages: ['Go'], difficulty: 'easy' }),
      NOW,
    )!;
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score * 10)).toBe(true);
  });

  it('does not mutate its inputs', () => {
    const i = issue();
    const p = profile({ skills: ['React'], preferredLanguages: ['TypeScript'] });
    const snapshot = JSON.stringify([i, p]);
    scoreIssue(i, p, NOW);
    expect(JSON.stringify([i, p])).toBe(snapshot);
  });
});

describe('rankIssues', () => {
  const p = profile({ preferredLanguages: ['Python', 'Go'], skills: ['django'], difficulty: 'easy' });

  it('drops assigned issues and sorts best first', () => {
    const ranked = rankIssues(
      [
        issue({ id: 1, language: 'Go' }),
        issue({ id: 2, language: 'Python', title: 'Django admin typo' }),
        issue({ id: 3, language: 'Python', assignee: 'someone' }),
        issue({ id: 4, language: 'Rust' }),
      ],
      p,
      NOW,
    );
    expect(ranked.map((r) => r.issue.id)).toEqual([2, 1, 4]);
  });

  it('prefers easier-than-level over harder-than-level for the same match', () => {
    const ranked = rankIssues(
      [issue({ id: 1, difficulty: 'hard' }), issue({ id: 2, difficulty: 'medium' })],
      profile({ difficulty: 'medium' }),
      NOW,
    );
    // medium is exact (1.0) vs hard (+1 => 0.3)
    expect(ranked[0]!.issue.id).toBe(2);
  });

  it('breaks ties by most recently updated, then by id', () => {
    const t = daysAgo(1);
    const ranked = rankIssues(
      [
        issue({ id: 9, updatedAt: t }),
        issue({ id: 3, updatedAt: t }),
        issue({ id: 5, updatedAt: t }),
      ],
      profile(),
      NOW,
    );
    expect(ranked.map((r) => r.issue.id)).toEqual([3, 5, 9]);
  });

  it('preserves the original issue object (extra fields included)', () => {
    const extended = { ...issue(), url: 'https://example.com' };
    const [first] = rankIssues([extended], profile(), NOW);
    expect(first!.issue).toBe(extended);
  });

  it('returns an empty list for empty input', () => {
    expect(rankIssues([], p, NOW)).toEqual([]);
  });
});
