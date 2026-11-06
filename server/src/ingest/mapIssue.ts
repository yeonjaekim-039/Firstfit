import type { Difficulty } from '../domain/types.js';
import { computeDifficulty } from './difficulty.js';
import type { GitHubSearchIssue } from './github.js';

export interface RepoRow {
  fullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  language: string;
}

export interface IssueRow {
  id: number;
  repoFullName: string;
  number: number;
  title: string;
  url: string;
  bodyLength: number;
  labels: string[];
  language: string;
  commentCount: number;
  state: string;
  assignee: string | null;
  difficulty: Difficulty;
  createdAt: string;
  updatedAt: string;
}

export function parseRepoUrl(repositoryUrl: string): { owner: string; name: string } {
  const match = /\/repos\/([^/]+)\/([^/]+)\/?$/.exec(repositoryUrl);
  if (!match) throw new Error(`Unexpected repository_url: ${repositoryUrl}`);
  return { owner: match[1]!, name: match[2]! };
}

export function mapIssue(item: GitHubSearchIssue, language: string): { repo: RepoRow; issue: IssueRow } {
  const { owner, name } = parseRepoUrl(item.repository_url);
  const fullName = `${owner}/${name}`;
  const labels = [
    ...new Set(item.labels.map((l) => (typeof l === 'string' ? l : l.name).toLowerCase().trim())),
  ].filter(Boolean);
  const bodyLength = item.body?.length ?? 0;

  return {
    repo: { fullName, owner, name, htmlUrl: `https://github.com/${fullName}`, language },
    issue: {
      id: item.id,
      repoFullName: fullName,
      number: item.number,
      title: item.title,
      url: item.html_url,
      bodyLength,
      labels,
      language,
      commentCount: item.comments,
      state: item.state,
      assignee: item.assignee?.login ?? null,
      difficulty: computeDifficulty({ labels, commentCount: item.comments, bodyLength }),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    },
  };
}
