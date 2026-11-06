import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { SavedStore, UserStore } from '../db/stores.js';
import { scoreIssue } from '../domain/scoring.js';
import { DIFFICULTIES } from '../domain/types.js';
import { toIssueDto } from './dto.js';

const tag = z.string().trim().min(1).max(40);
export const profileSchema = z.object({
  skills: z.array(tag).max(30).transform((xs) => [...new Set(xs)]),
  preferredLanguages: z.array(tag).max(10).transform((xs) => [...new Set(xs)]),
  difficulty: z.enum(DIFFICULTIES),
});

const issueIdParam = z.coerce.number().int().positive();

/** Rejects requests without a valid session. The session middleware in app.ts sets res.locals.userId. */
export const requireUser: RequestHandler = (_req, res, next) => {
  if (typeof res.locals.userId !== 'number') {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  next();
};

export function meRouter(deps: { userStore: UserStore; savedStore: SavedStore; now?: () => Date }) {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  router.use(requireUser);

  router.get('/', async (_req, res) => {
    const userId = res.locals.userId as number;
    const user = await deps.userStore.getUser(userId);
    if (!user) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    res.json({ user, savedIssueIds: await deps.savedStore.ids(userId) });
  });

  router.put('/profile', async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid profile', details: z.flattenError(parsed.error).fieldErrors });
      return;
    }
    const user = await deps.userStore.updateProfile(res.locals.userId as number, parsed.data);
    if (!user) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    res.json({ user });
  });

  router.get('/saved', async (_req, res) => {
    const userId = res.locals.userId as number;
    const [profile, { rows, hiddenClosed }] = await Promise.all([
      deps.userStore.getProfile(userId),
      deps.savedStore.list(userId),
    ]);
    const at = now();
    const items = rows.map((issue) => {
      // Saved issues are shown even if someone has since been assigned, so score them as unassigned.
      const scored = scoreIssue({ ...issue, assignee: null }, profile ?? { skills: [], preferredLanguages: [] }, at)!;
      return { ...toIssueDto(issue, scored.score, scored.breakdown), savedAt: issue.savedAt };
    });
    res.json({ items, hiddenClosed });
  });

  router.put('/saved/:issueId', async (req, res) => {
    const id = issueIdParam.safeParse(req.params.issueId);
    if (!id.success) {
      res.status(400).json({ error: 'Invalid issue id' });
      return;
    }
    const ok = await deps.savedStore.save(res.locals.userId as number, id.data);
    if (!ok) {
      res.status(404).json({ error: 'Issue not found or no longer open' });
      return;
    }
    res.status(204).end();
  });

  router.delete('/saved/:issueId', async (req, res) => {
    const id = issueIdParam.safeParse(req.params.issueId);
    if (!id.success) {
      res.status(400).json({ error: 'Invalid issue id' });
      return;
    }
    await deps.savedStore.remove(res.locals.userId as number, id.data);
    res.status(204).end();
  });

  return router;
}
