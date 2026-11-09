import type { BlogPostRecord, IssueRecord } from '../db/stores.js';
import type { ScoredPost } from '../domain/blogScoring.js';
import type { ScoredIssue } from '../domain/scoring.js';

/** Compact link to a blog post, shown on issue cards. */
export function toRelatedPostDto(p: BlogPostRecord) {
  return { id: p.id, company: p.company, title: p.title, url: p.url, publishedAt: p.publishedAt };
}
export type RelatedPostDto = ReturnType<typeof toRelatedPostDto>;

/** JSON shape of an issue card, shared by /api/issues, /api/me/saved and /api/blogs. */
export function toIssueDto({ issue, score, breakdown, crowding }: ScoredIssue<IssueRecord>, relatedPosts: RelatedPostDto[] = []) {
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
    /** Up to two blog posts that mention this issue's repository. */
    relatedPosts,
  };
}
export type IssueDto = ReturnType<typeof toIssueDto>;

/** JSON shape of a blog post card. The full article is never served; `url` links to the original. */
export function toPostDto({ post, score, breakdown }: ScoredPost<BlogPostRecord>, issues: IssueDto[]) {
  return {
    id: post.id,
    company: post.company,
    title: post.title,
    url: post.url,
    publishedAt: post.publishedAt,
    excerpt: post.excerpt,
    tags: post.tags,
    repos: post.repos,
    score,
    breakdown,
    /** Open beginner-friendly issues in repos the post mentions, best match first. */
    issues,
  };
}
