import { DIFFICULTIES, type BlogQuery, type Difficulty } from '../api'

const list = (p: URLSearchParams, key: string) => p.get(key)?.split(',').filter(Boolean) ?? []
const isDifficulty = (v: string | null): v is Difficulty => DIFFICULTIES.includes(v as Difficulty)

/**
 * Tech Blogs state lives in the URL like Discover's, and uses the same `skills` / `langs` / `level` keys,
 * so the profile carries over between the two pages.
 */
export function readBlogQuery(p: URLSearchParams): BlogQuery {
  const level = p.get('level')
  return {
    skills: list(p, 'skills'),
    preferredLanguages: list(p, 'langs'),
    level: isDifficulty(level) ? level : null,
    company: list(p, 'company'),
    page: Math.max(1, Number(p.get('page')) || 1),
  }
}

export function writeBlogQuery(q: BlogQuery): URLSearchParams {
  const p = new URLSearchParams()
  const set = (key: string, values: string[]) => values.length && p.set(key, values.join(','))
  set('skills', q.skills)
  set('langs', q.preferredLanguages)
  if (q.level) p.set('level', q.level)
  set('company', q.company)
  if (q.page > 1) p.set('page', String(q.page))
  return p
}
