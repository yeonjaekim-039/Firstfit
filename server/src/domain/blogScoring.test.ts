import { describe, expect, it } from 'vitest';
import { POST_FRESHNESS_HALF_LIFE_DAYS, postFreshness, postMatchScore, rankPosts, type ScorablePost } from './blogScoring.js';
import type { UserProfile } from './scoring.js';

const NOW = new Date('2026-11-08T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const post = (overrides: Partial<ScorablePost> = {}): ScorablePost => ({
  id: 1,
  title: 'A post',
  excerpt: '',
  company: 'Acme',
  tags: [],
  publishedAt: NOW,
  ...overrides,
});
const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({ skills: [], preferredLanguages: [], ...overrides });

describe('postMatchScore', () => {
  it('is neutral with an empty profile', () => {
    expect(postMatchScore(post(), profile())).toBe(0.5);
  });

  it('matches skills against the title, excerpt and tags as whole tokens', () => {
    const p = profile({ skills: ['kafka', 'react'] });
    expect(postMatchScore(post({ title: 'Scaling Kafka consumers' }), p)).toBe(0.5);
    expect(postMatchScore(post({ title: 'Kafka', excerpt: 'with a React dashboard' }), p)).toBe(1);
    expect(postMatchScore(post({ tags: ['frontend'] }), profile({ skills: ['frontend'] }))).toBe(1);
    expect(postMatchScore(post({ title: 'Reactive streams' }), profile({ skills: ['react'] }))).toBe(0);
  });

  it('uses preferred-language order against language tags, like issue matching', () => {
    const p = profile({ preferredLanguages: ['Rust', 'Go'] });
    expect(postMatchScore(post({ tags: ['rust'] }), p)).toBe(1);
    expect(postMatchScore(post({ tags: ['go'] }), p)).toBeCloseTo(0.9);
    expect(postMatchScore(post({ tags: ['python'] }), p)).toBe(0);
  });
});

describe('postFreshness', () => {
  it(`halves every ${POST_FRESHNESS_HALF_LIFE_DAYS} days and is neutral without a date`, () => {
    expect(postFreshness(NOW, NOW)).toBe(1);
    expect(postFreshness(daysAgo(POST_FRESHNESS_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.5);
    expect(postFreshness(null, NOW)).toBe(0.5);
  });
});

describe('rankPosts', () => {
  it('ranks matching posts first, then by recency', () => {
    const ranked = rankPosts(
      [
        post({ id: 1, title: 'Billing at scale', publishedAt: NOW }),
        post({ id: 2, title: 'Our Python data pipelines', tags: ['python'], publishedAt: daysAgo(60) }),
        post({ id: 3, title: 'Another billing story', publishedAt: daysAgo(10) }),
      ],
      profile({ skills: ['python'], preferredLanguages: ['Python'] }),
      NOW,
    );
    expect(ranked.map((r) => r.post.id)).toEqual([2, 1, 3]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it('falls back to newest first with an empty profile', () => {
    const ranked = rankPosts([post({ id: 1, publishedAt: daysAgo(30) }), post({ id: 2, publishedAt: NOW })], profile(), NOW);
    expect(ranked.map((r) => r.post.id)).toEqual([2, 1]);
  });
});
