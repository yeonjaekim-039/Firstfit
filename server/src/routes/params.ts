import { z } from 'zod';
import type { UserStore } from '../db/stores.js';
import type { Difficulty } from '../domain/types.js';
import type { UserProfile } from '../domain/scoring.js';

/** Accepts `?x=a,b`, `?x=a&x=b`, or a mix; trims and drops blanks. */
export const list = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : [v].flat().flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean),
    )
    .pipe(z.array(item).optional());

export interface ProfileParams {
  userId?: number;
  skills?: string[];
  preferredLanguages?: string[];
  level?: Difficulty;
  preferredLabels?: string[];
}

/**
 * The ranking profile for a request: explicit params win over the stored profile of `userId`.
 * Returns null when `userId` is given but doesn't exist.
 */
export async function resolveProfile(q: ProfileParams, userStore: UserStore): Promise<UserProfile | null> {
  let stored: UserProfile | null = null;
  if (q.userId !== undefined) {
    stored = await userStore.getProfile(q.userId);
    if (!stored) return null;
  }
  return {
    skills: q.skills ?? stored?.skills ?? [],
    preferredLanguages: q.preferredLanguages ?? stored?.preferredLanguages ?? [],
    difficulty: q.level ?? stored?.difficulty ?? null,
    preferredLabels: q.preferredLabels ?? [],
  };
}
