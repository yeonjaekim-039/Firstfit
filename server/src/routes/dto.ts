import type { IssueRecord } from '../db/stores.js';
import type { ScoredIssue } from '../domain/scoring.js';

/** JSON shape of an issue card, shared by /api/issues and /api/me/saved. */
export function toIssueDto({ issue, score, breakdown, crowding }: ScoredIssue<IssueRecord>) {
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
    repo: {
      fullName: issue.repoFullName,
      url: issue.repoUrl,
      stars: issue.repoStars ?? null,
      pushedAt: issue.repoPushedAt ?? null,
    },
    score,
    breakdown,
    /** Multiplier already applied to `score` for busy threads (1 = none). */
    crowding,
  };
}
