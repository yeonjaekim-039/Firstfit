import { DIFFICULTIES, type Difficulty, type IssueQuery } from '../api'

const list = (p: URLSearchParams, key: string) => p.get(key)?.split(',').filter(Boolean) ?? []
const isDifficulty = (v: string | null): v is Difficulty => DIFFICULTIES.includes(v as Difficulty)

/** The Discover URL is the source of truth, so searches are shareable and back/forward works. */
export function readQuery(p: URLSearchParams): IssueQuery {
  const level = p.get('level')
  return {
    skills: list(p, 'skills'),
    preferredLanguages: list(p, 'langs'),
    level: isDifficulty(level) ? level : null,
    language: list(p, 'language'),
    label: list(p, 'label'),
    difficulty: list(p, 'difficulty').filter(isDifficulty),
    page: Math.max(1, Number(p.get('page')) || 1),
  }
}

export function writeQuery(q: IssueQuery): URLSearchParams {
  const p = new URLSearchParams()
  const set = (key: string, values: string[]) => values.length && p.set(key, values.join(','))
  set('skills', q.skills)
  set('langs', q.preferredLanguages)
  if (q.level) p.set('level', q.level)
  set('language', q.language)
  set('label', q.label)
  set('difficulty', q.difficulty)
  if (q.page > 1) p.set('page', String(q.page))
  return p
}
