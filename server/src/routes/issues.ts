import { Router } from 'express';
import { z } from 'zod';
import type { IssueStore, UserStore } from '../db/stores.js';
import { rankIssues, type UserProfile } from '../domain/scoring.js';
import { DIFFICULTIES } from '../domain/types.js';
import { toIssueDto } from './dto.js';

/** How many filtered issues (most recently updated first) are pulled from the DB and ranked. */
export const MAX_CANDIDATES = 5000;

/** Accepts `?x=a,b`, `?x=a&x=b`, or a mix; trims and drops blanks. */
const list = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : [v].flat().flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean),
    )
    .pipe(z.array(item).optional());

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

export function issuesRouter(deps: { issueStore: IssueStore; userStore: UserStore; now?: () => Date }) {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get('/', async (req, res) => {
    const parsed = issuesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: z.flattenError(parsed.error).fieldErrors });
      return;
    }
    const q = parsed.data;

    let stored: UserProfile | null = null;
    if (q.userId !== undefined) {
      stored = await deps.userStore.getProfile(q.userId);
      if (!stored) {
        res.status(404).json({ error: `User ${q.userId} not found` });
        return;
      }
    }
    const profile: UserProfile = {
      skills: q.skills ?? stored?.skills ?? [],
      preferredLanguages: q.preferredLanguages ?? stored?.preferredLanguages ?? [],
      difficulty: q.level ?? stored?.difficulty ?? null,
      preferredLabels: q.preferredLabels ?? [],
    };

    const { rows, total } = await deps.issueStore.findCandidates(
      { languages: q.language, labels: q.label, difficulties: q.difficulty },
      MAX_CANDIDATES,
    );
    const ranked = rankIssues(rows, profile, now());
    const start = (q.page - 1) * q.pageSize;

    res.json({
      page: q.page,
      pageSize: q.pageSize,
      total,
      rankedCount: ranked.length,
      totalPages: Math.ceil(ranked.length / q.pageSize),
      profile,
      items: ranked
        .slice(start, start + q.pageSize)
        .map(({ issue, score, breakdown }) => toIssueDto(issue, score, breakdown)),
    });
  });

  return router;
}
