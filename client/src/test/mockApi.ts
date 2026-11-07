import { vi } from 'vitest'
import type { Issue, User } from '../api'

export function makeIssue(overrides: Partial<Issue> = {}): Issue {
  const id = overrides.id ?? 1
  return {
    id,
    number: id,
    title: `Fix bug ${id}`,
    url: `https://github.com/acme/app/issues/${id}`,
    labels: ['good first issue'],
    language: 'TypeScript',
    difficulty: 'easy',
    assignee: null,
    commentCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    repo: { fullName: 'acme/app', url: 'https://github.com/acme/app', stars: 12_345, pushedAt: new Date().toISOString() },
    score: 87.4,
    breakdown: { match: 0.74, labels: 1, difficulty: 1, freshness: 0.86, repo: 0.9 },
    crowding: 1,
    ...overrides,
  }
}

export const testUser: User = {
  id: 1,
  login: 'octocat',
  name: 'The Octocat',
  avatarUrl: null,
  skills: ['react'],
  preferredLanguages: ['TypeScript'],
  difficulty: 'easy',
}

type Handler = (url: URL, init?: RequestInit) => { status?: number; body?: unknown }

/** Installs a fetch mock. Keys are "METHOD /path"; the first match by prefix wins. */
export function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    const key = Object.keys(routes).find((k) => {
      const [m, path] = k.split(' ')
      return m === method && url.pathname.startsWith(path!)
    })
    if (!key) return new Response(JSON.stringify({ error: 'unmocked' }), { status: 500 })
    const { status = 200, body } = routes[key]!(url, init)
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

export const META = {
  languages: ['TypeScript', 'Python', 'Go'],
  labels: ['good first issue', 'help wanted'],
  auth: { github: true },
}

export const page = (items: Issue[]) => ({
  page: 1,
  pageSize: 20,
  total: items.length,
  rankedCount: items.length,
  totalPages: 1,
  items,
})
