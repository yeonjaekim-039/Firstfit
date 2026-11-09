import type { BlogStore } from '../db/stores.js';
import { type RelatedPostDto, toRelatedPostDto } from './dto.js';

export const RELATED_POSTS_PER_ISSUE = 2;
/** Upper bound on posts fetched for one page of issues. */
const RELATED_POSTS_FETCH_LIMIT = 200;

/**
 * Blog posts related to each repo, keyed by lowercased "owner/repo". A post counts as related
 * only when it actually mentions that repository (a real link, not topic similarity).
 * Blogs are secondary content: a failure here is logged and yields no related posts, so it
 * never breaks the issue listing.
 */
export async function relatedPostsByRepo(
  blogStore: BlogStore,
  repoNames: string[],
  perRepo = RELATED_POSTS_PER_ISSUE,
): Promise<Map<string, RelatedPostDto[]>> {
  const repos = [...new Set(repoNames.map((r) => r.toLowerCase()))];
  const byRepo = new Map<string, RelatedPostDto[]>();
  if (repos.length === 0) return byRepo;
  try {
    const posts = await blogStore.relatedByRepos(repos, RELATED_POSTS_FETCH_LIMIT);
    for (const repo of repos) {
      const matches = posts.filter((p) => p.repos.includes(repo)).slice(0, perRepo);
      if (matches.length) byRepo.set(repo, matches.map(toRelatedPostDto));
    }
  } catch (err) {
    console.error('Related blog posts unavailable:', err);
  }
  return byRepo;
}
