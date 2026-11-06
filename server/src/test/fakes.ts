import type { IssueFilters, IssueRecord, IssueStore, UserStore } from '../db/stores.js';
import type { UserProfile } from '../domain/scoring.js';

export const NOW = new Date('2026-11-01T00:00:00Z');

export function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  const id = overrides.id ?? 1;
  return {
    id,
    number: id,
    title: `Issue ${id}`,
    url: `https://github.com/acme/app/issues/${id}`,
    labels: ['good first issue'],
    language: 'TypeScript',
    difficulty: 'easy',
    assignee: null,
    commentCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    repoFullName: 'acme/app',
    repoUrl: 'https://github.com/acme/app',
    ...overrides,
  };
}

export function fakeIssueStore(rows: IssueRecord[]) {
  const calls: { filters: IssueFilters; limit: number }[] = [];
  const store: IssueStore = {
    async findCandidates(filters, limit) {
      calls.push({ filters, limit });
      return { rows, total: rows.length };
    },
  };
  return { store, calls };
}

export function fakeUserStore(users: Record<number, UserProfile> = {}): UserStore {
  return { getProfile: async (id) => users[id] ?? null };
}
