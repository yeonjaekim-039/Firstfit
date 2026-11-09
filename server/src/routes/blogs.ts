import { Router } from 'express';
import { z } from 'zod';
import type { BlogStore, IssueStore, UserStore } from '../db/stores.js';
import { rankPosts } from '../domain/blogScoring.js';
import { rankIssues } from '../domain/scoring.js';
import { DIFFICULTIES } from '../domain/types.js';
import { type IssueDto, toIssueDto, toPostDto } from './dto.js';
import { list, resolveProfile } from './params.js';

/** Most posts pulled (newest first) and ranked per request. */
export const MAX_POSTS = 2000;
/** Beginner-friendly issues shown under a post that mentions their repo. */
export const ISSUES_PER_POST = 3;
/** Cap on candidate issues fetched for one page of posts (one batched query, never per post). */
export const MAX_POST_ISSUE_CANDIDATES = 1000;

export const blogsQuerySchema = z.object({
  company: list(z.string()),
  userId: z.coerce.number().int().positive().optional(),
  skills: list(z.string()),
  preferredLanguages: list(z.string()),
  // Only ranks the issues shown under posts (difficulty fit), exactly as on Discover.
  level: z.enum(DIFFICULTIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export function blogsRouter(deps: {
  blogStore: BlogStore;
  issueStore: IssueStore;
  userStore: UserStore;
  now?: () => Date;
}) {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get('/', async (req, res) => {
    const parsed = blogsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: z.flattenError(parsed.error).fieldErrors });
      return;
    }
    const q = parsed.data;
    const profile = await resolveProfile(q, deps.userStore);
    if (!profile) {
      res.status(404).json({ error: `User ${q.userId} not found` });
      return;
    }

    const at = now();
    const [{ rows, total }, companies] = await Promise.all([
      deps.blogStore.findPosts({ companies: q.company }, MAX_POSTS),
      deps.blogStore.companies(),
    ]);
    const ranked = rankPosts(rows, profile, at);
    const start = (q.page - 1) * q.pageSize;
    const pageItems = ranked.slice(start, start + q.pageSize);

    // Issues come from our own database (filled by the daily crawl), never from the GitHub API at
    // request time: one batched query for every repo on the page, using the same candidate filter
    // (open, unassigned, repo not archived, beginner-label crawl) and ranking as /api/issues.
    // They're optional extras, so a failure is logged and the posts still render.
    const mentioned = [...new Set(pageItems.flatMap((s) => s.post.repos))];
    const issuesByRepo = new Map<string, IssueDto[]>();
    if (mentioned.length) {
      try {
        const { rows: issueRows } = await deps.issueStore.findCandidates({ repos: mentioned }, MAX_POST_ISSUE_CANDIDATES);
        for (const scored of rankIssues(issueRows, profile, at)) {
          const repo = scored.issue.repoFullName.toLowerCase();
          const bucket = issuesByRepo.get(repo) ?? issuesByRepo.set(repo, []).get(repo)!;
          bucket.push(toIssueDto(scored));
        }
      } catch (err) {
        console.error('Issues for blog posts unavailable:', err);
      }
    }
    const issuesFor = (repos: string[]) =>
      repos
        .flatMap((r) => issuesByRepo.get(r) ?? [])
        .sort((a, b) => b.score - a.score)
        .slice(0, ISSUES_PER_POST);

    res.json({
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.ceil(ranked.length / q.pageSize),
      profile: { skills: profile.skills, preferredLanguages: profile.preferredLanguages, level: profile.difficulty ?? null },
      companies,
      items: pageItems.map((s) => toPostDto(s, issuesFor(s.post.repos))),
    });
  });

  return router;
}
