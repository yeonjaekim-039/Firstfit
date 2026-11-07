import { describe, expect, it } from 'vitest';
import type { GitHubSearchIssue } from './github.js';
import { mapIssue, parseRepoUrl } from './mapIssue.js';

const item: GitHubSearchIssue = {
  id: 42,
  number: 7,
  title: 'Fix typo in README',
  html_url: 'https://github.com/acme/widgets/issues/7',
  repository_url: 'https://api.github.com/repos/acme/widgets',
  body: 'There is a typo.',
  labels: [{ name: 'Good First Issue' }, { name: 'docs' }, { name: 'good first issue' }],
  comments: 1,
  state: 'open',
  assignee: null,
  created_at: '2024-05-01T00:00:00Z',
  updated_at: '2024-05-02T00:00:00Z',
};

describe('mapIssue', () => {
  it('maps a search item into repo and issue rows', () => {
    const { repo, issue } = mapIssue(item, 'TypeScript');
    expect(repo).toEqual({
      fullName: 'acme/widgets',
      owner: 'acme',
      name: 'widgets',
      htmlUrl: 'https://github.com/acme/widgets',
      language: 'TypeScript',
    });
    expect(issue).toMatchObject({
      id: 42,
      repoFullName: 'acme/widgets',
      labels: ['good first issue', 'docs'],
      language: 'TypeScript',
      bodyLength: 16,
      commentCount: 1,
      assignee: null,
      difficulty: 'easy',
    });
  });

  it('strips NUL characters, which Postgres TEXT rejects, from the title and labels', () => {
    const { issue } = mapIssue(
      { ...item, title: 'Crash on \u0000 in input', labels: [{ name: 'bug\u0000' }, { name: 'Good First Issue' }, 'bug'] },
      'Ruby',
    );
    expect(issue.title).toBe('Crash on  in input');
    expect(issue.labels).toEqual(['bug', 'good first issue']);
    expect(JSON.stringify(issue)).not.toContain('\\u0000');
  });

  it('records the assignee login and tolerates a null body', () => {
    const { issue } = mapIssue({ ...item, body: null, assignee: { login: 'octocat' } }, 'Go');
    expect(issue.assignee).toBe('octocat');
    expect(issue.bodyLength).toBe(0);
  });
});

describe('parseRepoUrl', () => {
  it('rejects unexpected urls', () => {
    expect(() => parseRepoUrl('https://example.com/nope')).toThrow();
  });
});
