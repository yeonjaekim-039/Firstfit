import { describe, expect, it } from 'vitest';
import type { GitHubIssue } from './github.js';
import { LABELS } from './queries.js';
import { reconcile, type StaleIssue } from './sweep.js';

const stored: StaleIssue = { id: 1, owner: 'acme', repo: 'widgets', number: 7 };

const fetched = (overrides: Partial<GitHubIssue> = {}): GitHubIssue => ({
  id: 1,
  number: 7,
  title: 'Fix typo',
  html_url: 'https://github.com/acme/widgets/issues/7',
  repository_url: 'https://api.github.com/repos/acme/widgets',
  body: 'short',
  labels: [{ name: 'good first issue' }],
  comments: 2,
  state: 'open',
  assignee: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

describe('reconcile', () => {
  it('closes issues that are gone (404/410/451)', () => {
    expect(reconcile(stored, null, LABELS)).toEqual({ action: 'close', reason: 'gone' });
  });

  it('closes issues that GitHub reports closed', () => {
    expect(reconcile(stored, fetched({ state: 'closed' }), LABELS)).toEqual({ action: 'close', reason: 'closed' });
  });

  it('closes issues transferred to another repo', () => {
    const moved = fetched({ repository_url: 'https://api.github.com/repos/other/place', number: 99 });
    expect(reconcile(stored, moved, LABELS)).toEqual({ action: 'close', reason: 'transferred' });
  });

  it('treats repo renames that differ only by case as the same repo', () => {
    const renamed = fetched({ repository_url: 'https://api.github.com/repos/Acme/Widgets' });
    expect(reconcile(stored, renamed, LABELS).action).toBe('refresh');
  });

  it('delists open issues that no longer carry any target label', () => {
    expect(reconcile(stored, fetched({ labels: [{ name: 'bug' }] }), LABELS)).toEqual({ action: 'delist' });
  });

  it('refreshes open issues that still qualify, picking up a new assignee and labels', () => {
    const r = reconcile(
      stored,
      fetched({ assignee: { login: 'octocat' }, labels: [{ name: 'Help Wanted' }, 'docs'], comments: 12 }),
      LABELS,
    );
    expect(r).toMatchObject({
      action: 'refresh',
      assignee: 'octocat',
      labels: ['help wanted', 'docs'],
      commentCount: 12,
      updatedAt: '2026-10-01T00:00:00Z',
    });
  });

  it('strips NUL characters from refreshed titles and labels', () => {
    const r = reconcile(stored, fetched({ title: 'a\u0000b', labels: [{ name: 'good first issue\u0000' }] }), LABELS);
    expect(r).toMatchObject({ action: 'refresh', title: 'ab', labels: ['good first issue'] });
  });
});
