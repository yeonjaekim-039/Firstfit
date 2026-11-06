import { describe, expect, it } from 'vitest';
import { computeDifficulty } from './difficulty.js';

const base = { labels: [] as string[], commentCount: 0, bodyLength: 500 };

describe('computeDifficulty', () => {
  it('treats good first issue with a short body and few comments as easy', () => {
    expect(computeDifficulty({ ...base, labels: ['good first issue'], bodyLength: 200 })).toBe('easy');
  });

  it('treats first-timers-only as easy even with a long body', () => {
    expect(computeDifficulty({ labels: ['first-timers-only'], commentCount: 3, bodyLength: 2000 })).toBe('easy');
  });

  it('matches difficulty labels case-insensitively and by substring', () => {
    expect(computeDifficulty({ ...base, labels: ['Difficulty: Hard'] })).toBe('hard');
    expect(computeDifficulty({ ...base, labels: ['level/Easy'] })).toBe('easy');
  });

  it('treats help wanted with no other signals as medium', () => {
    expect(computeDifficulty({ ...base, labels: ['help wanted'] })).toBe('medium');
  });

  it('bumps a beginner label to medium when the discussion is long and the body is long', () => {
    expect(
      computeDifficulty({ labels: ['good first issue'], commentCount: 12, bodyLength: 3500 }),
    ).toBe('medium');
  });

  it('marks long, heavily discussed help wanted issues as hard', () => {
    expect(computeDifficulty({ labels: ['help wanted'], commentCount: 15, bodyLength: 4000 })).toBe('hard');
  });

  it('lets an explicit hard label win over a beginner label', () => {
    expect(computeDifficulty({ ...base, labels: ['good first issue', 'complex'] })).toBe('medium');
    expect(computeDifficulty({ ...base, labels: ['help wanted', 'advanced'] })).toBe('hard');
  });

  it('defaults to medium with no labels and average signals', () => {
    expect(computeDifficulty(base)).toBe('medium');
  });

  it('nudges docs issues toward easy', () => {
    expect(computeDifficulty({ ...base, labels: ['documentation'], bodyLength: 100 })).toBe('easy');
  });
});
