export type Difficulty = 'easy' | 'medium' | 'hard'
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

export interface ScoreBreakdown {
  match: number
  labels: number
  difficulty: number
  freshness: number
  repo: number
}

export interface Issue {
  id: number
  number: number
  title: string
  url: string
  labels: string[]
  language: string | null
  difficulty: Difficulty
  assignee: string | null
  commentCount: number
  createdAt: string
  updatedAt: string
  /** stars / pushedAt are null until the repo's metadata has been fetched. */
  repo: { fullName: string; url: string; stars: number | null; pushedAt: string | null }
  score: number
  breakdown: ScoreBreakdown
  /** Multiplier already applied to `score` for very long comment threads (1 = no penalty). */
  crowding: number
  /** Up to two engineering-blog posts that mention this issue's repository. */
  relatedPosts: RelatedPost[]
}

export interface RelatedPost {
  id: number
  company: string
  title: string
  url: string
  publishedAt: string | null
}

export interface BlogPost {
  id: number
  company: string
  title: string
  /** Link to the original article; only metadata and a short excerpt are served. */
  url: string
  publishedAt: string | null
  excerpt: string
  tags: string[]
  /** Lowercased "owner/repo" names the post mentions. */
  repos: string[]
  score: number
  breakdown: { match: number; freshness: number }
  /** Open beginner-friendly issues in repos the post mentions. */
  issues: Issue[]
}

export interface BlogsPage {
  page: number
  pageSize: number
  total: number
  totalPages: number
  companies: string[]
  items: BlogPost[]
}

export interface BlogQuery {
  skills: string[]
  preferredLanguages: string[]
  /** Only ranks the issues shown under posts (difficulty fit), as on Discover. */
  level: Difficulty | null
  company: string[]
  page: number
  pageSize?: number
}

export interface SavedIssue extends Issue {
  savedAt: string
}

export interface IssuesPage {
  page: number
  pageSize: number
  total: number
  rankedCount: number
  totalPages: number
  items: Issue[]
}

export interface IssueQuery {
  skills: string[]
  preferredLanguages: string[]
  level: Difficulty | null
  language: string[]
  label: string[]
  difficulty: Difficulty[]
  page: number
  pageSize?: number
}

export interface Meta {
  languages: string[]
  labels: string[]
  auth: { github: boolean }
}

export interface User {
  id: number
  login: string | null
  name: string | null
  avatarUrl: string | null
  skills: string[]
  preferredLanguages: string[]
  difficulty: Difficulty
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export function issuesUrl(q: IssueQuery): string {
  const p = new URLSearchParams()
  const list = (key: string, values: string[]) => values.length && p.set(key, values.join(','))
  list('skills', q.skills)
  list('preferredLanguages', q.preferredLanguages)
  if (q.level) p.set('level', q.level)
  list('language', q.language)
  list('label', q.label)
  list('difficulty', q.difficulty)
  p.set('page', String(q.page))
  p.set('pageSize', String(q.pageSize ?? 20))
  return `/api/issues?${p}`
}

export function blogsUrl(q: BlogQuery): string {
  const p = new URLSearchParams()
  const list = (key: string, values: string[]) => values.length && p.set(key, values.join(','))
  list('skills', q.skills)
  list('preferredLanguages', q.preferredLanguages)
  if (q.level) p.set('level', q.level)
  list('company', q.company)
  p.set('page', String(q.page))
  p.set('pageSize', String(q.pageSize ?? 20))
  return `/api/blogs?${p}`
}

export const api = {
  meta: () => request<Meta>('/api/meta'),
  issues: (q: IssueQuery, signal?: AbortSignal) => request<IssuesPage>(issuesUrl(q), { signal }),
  blogs: (q: BlogQuery, signal?: AbortSignal) => request<BlogsPage>(blogsUrl(q), { signal }),
  me: () => request<{ user: User; savedIssueIds: number[] }>('/api/me'),
  updateProfile: (profile: Pick<User, 'skills' | 'preferredLanguages' | 'difficulty'>) =>
    request<{ user: User }>('/api/me/profile', { method: 'PUT', body: JSON.stringify(profile) }),
  saved: () => request<{ items: SavedIssue[]; hiddenClosed: number }>('/api/me/saved'),
  save: (issueId: number) => request<void>(`/api/me/saved/${issueId}`, { method: 'PUT' }),
  unsave: (issueId: number) => request<void>(`/api/me/saved/${issueId}`, { method: 'DELETE' }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
}

export const LOGIN_URL = '/api/auth/github'
