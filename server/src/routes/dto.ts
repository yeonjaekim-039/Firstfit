import type { IssueRecord } from '../db/stores.js';
import type { ScoreBreakdown } from '../domain/scoring.js';

/** JSON shape of an issue card, shared by /api/issues and /api/me/saved. */
export function toIssueDto(issue: IssueRecord, score: number, breakdown: ScoreBreakdown) {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    labels: issue.labels,
    language: issue.language,
    difficulty: issue.difficulty,
    assignee: issue.assignee,
    commentCount: issue.commentCount,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    repo: { fullName: issue.repoFullName, url: issue.repoUrl },
    score,
    breakdown,
  };
}
