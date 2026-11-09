import { Router } from 'express';
import { z } from 'zod';
import type { BlogStore, IssueStore, UserStore } from '../db/stores.js';
import { diversifyByRepo } from '../domain/diversity.js';
import { rankIssues } from '../domain/scoring.js';
import { DIFFICULTIES } from '../domain/types.js';
import { toIssueDto } from './dto.js';
import { list, resolveProfile } from './params.js';
import { relatedPostsByRepo } from './related.js';

/** How many filtered issues (most recently updated first) are pulled from the DB and ranked. */
export const MAX_CANDIDATES = 5000;

const difficulty = z.enum(DIFFICULTIES);

export const issuesQuerySchema = z.object({
  // Filters
  language: list(z.string()),
  label: list(z.string()),
  difficulty: list(difficulty),
  // Ranking profile (overrides the stored profile when userId is given)
  userId: z.coerce.number().int().positive().optional(),
  skills: list(z.string()),
  preferredLanguages: list(z.string()),
  level: difficulty.optional(),
  preferredLabels: list(z.string()),
  // Pagination
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function issuesRouter(deps: {
  issueStore: IssueStore;
  userStore: UserStore;
  blogStore: BlogStore;
  now?: () => Date;
}) {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get('/', async (req, res) => {
    const parsed = issuesQuerySchema.safeParse(req.query);
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

    const { rows, total } = await deps.issueStore.findCandidates(
      { languages: q.language, labels: q.label, difficulties: q.difficulty },
      MAX_CANDIDATES,
    );
    // Diversify over the whole ranked list (not just this page) so page boundaries stay stable.
    const ranked = diversifyByRepo(rankIssues(rows, profile, now()), (s) => s.issue.repoFullName, q.pageSize);
    const start = (q.page - 1) * q.pageSize;
    const pageItems = ranked.slice(start, start + q.pageSize);
    const related = await relatedPostsByRepo(
      deps.blogStore,
      pageItems.map((s) => s.issue.repoFullName),
    );

    res.json({
      page: q.page,
      pageSize: q.pageSize,
      total,
      rankedCount: ranked.length,
      totalPages: Math.ceil(ranked.length / q.pageSize),
      profile,
      items: pageItems.map((s) => toIssueDto(s, related.get(s.issue.repoFullName.toLowerCase()) ?? [])),
    });
  });

  return router;
}
