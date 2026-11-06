import { describe, expect, it } from 'vitest';
import { buildQuery, splitWindow, windowDays } from './queries.js';

describe('buildQuery', () => {
  it('quotes labels and languages with spaces or symbols', () => {
    expect(buildQuery('good first issue', 'C#', { from: '2024-01-01', to: '2024-12-31' })).toBe(
      'is:issue is:open archived:false label:"good first issue" language:"C#" created:2024-01-01..2024-12-31',
    );
  });
});

describe('splitWindow', () => {
  it('splits into contiguous, non-overlapping halves that cover the window', () => {
    const w = { from: '2024-01-01', to: '2024-01-10' };
    const [a, b] = splitWindow(w)!;
    expect(a).toEqual({ from: '2024-01-01', to: '2024-01-05' });
    expect(b).toEqual({ from: '2024-01-06', to: '2024-01-10' });
    expect(windowDays(a) + windowDays(b)).toBe(windowDays(w));
  });

  it('handles two-day and odd-length windows', () => {
    expect(splitWindow({ from: '2024-02-28', to: '2024-02-29' })).toEqual([
      { from: '2024-02-28', to: '2024-02-28' },
      { from: '2024-02-29', to: '2024-02-29' },
    ]);
    const [a, b] = splitWindow({ from: '2024-01-01', to: '2024-01-03' })!;
    expect(windowDays(a) + windowDays(b)).toBe(3);
  });

  it('returns null for a single day', () => {
    expect(splitWindow({ from: '2024-01-01', to: '2024-01-01' })).toBeNull();
  });
});
