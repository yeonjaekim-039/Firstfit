/**
 * Extracts GitHub repositories ("owner/repo", lowercased) mentioned in a post's HTML or text.
 * Pure: no I/O.
 */

/** Most repos a single post may contribute; link-heavy roundup posts would otherwise dominate. */
export const MAX_REPOS_PER_POST = 20;

/**
 * First path segments on github.com that are site pages, not users or orgs, so
 * github.com/<segment>/<x> is never a repository (github.com/features/copilot, /orgs/acme/people…).
 */
export const NON_OWNER_SEGMENTS = new Set([
  'about', 'account', 'advisories', 'apps', 'blog', 'business', 'case-studies', 'codespaces', 'collections',
  'contact', 'customer-stories', 'dashboard', 'edu', 'education', 'enterprise', 'events', 'explore', 'features',
  'git-guides', 'github-copilot', 'home', 'issues', 'join', 'login', 'logout', 'marketplace', 'mobile', 'new',
  'newsroom', 'notifications', 'orgs', 'organizations', 'partners', 'premium-support', 'pricing', 'pulls',
  'readme', 'resources', 'search', 'security', 'sessions', 'settings', 'signup', 'site', 'solutions', 'sponsors',
  'stars', 'team', 'topics', 'trending', 'users', 'watching',
]);

// GitHub logins: alphanumerics and single hyphens, up to 39 chars. Repo names: [A-Za-z0-9._-].
const GITHUB_URL = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})/gi;

export function extractRepos(html: string, max = MAX_REPOS_PER_POST): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(GITHUB_URL)) {
    const owner = match[1]!.toLowerCase();
    let repo = match[2]!.toLowerCase().replace(/\.git$/, '');
    // Trailing punctuation from prose ("see github.com/a/b.") isn't part of the name.
    repo = repo.replace(/[.]+$/, '');
    if (NON_OWNER_SEGMENTS.has(owner)) continue;
    if (!repo || repo === '.' || repo === '..') continue;
    found.add(`${owner}/${repo}`);
    if (found.size >= max) break;
  }
  return [...found];
}
