export const LABELS = ['good first issue', 'help wanted', 'beginner', 'easy', 'first-timers-only'];

export const LANGUAGES = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'Go',
  'Rust',
  'C#',
  'C++',
  'Ruby',
  'PHP',
];

/** GitHub search returns at most 1000 results per query, regardless of pagination. */
export const SEARCH_RESULT_CAP = 1000;

export interface DateWindow {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
}

const DAY_MS = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function buildQuery(label: string, language: string, window: DateWindow): string {
  return [
    'is:issue',
    'is:open',
    'archived:false',
    `label:"${label}"`,
    `language:"${language}"`,
    `created:${window.from}..${window.to}`,
  ].join(' ');
}

export function windowDays(w: DateWindow): number {
  return Math.round((toDate(w.to) - toDate(w.from)) / DAY_MS) + 1;
}

/** Splits a window into two non-overlapping halves. Returns null for single-day windows. */
export function splitWindow(w: DateWindow): [DateWindow, DateWindow] | null {
  const days = windowDays(w);
  if (days <= 1) return null;
  const midMs = toDate(w.from) + (Math.floor(days / 2) - 1) * DAY_MS;
  return [
    { from: w.from, to: fmt(midMs) },
    { from: fmt(midMs + DAY_MS), to: w.to },
  ];
}

export function fullWindow(now = new Date()): DateWindow {
  return { from: '2008-01-01', to: fmt(now.getTime()) };
}
