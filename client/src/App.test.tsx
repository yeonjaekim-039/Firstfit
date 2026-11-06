import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { readQuery } from './pages/discoverQuery'
import { makeIssue, META, mockApi, page, testUser } from './test/mockApi'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

const signedOut = {
  'GET /api/meta': () => ({ body: META }),
  'GET /api/me': () => ({ status: 401, body: { error: 'Not signed in' } }),
}

const signedIn = (savedIssueIds: number[] = []) => ({
  'GET /api/meta': () => ({ body: META }),
  'GET /api/me/saved': () => ({ body: { items: [makeIssue({ id: 5, title: 'Saved one' })], hiddenClosed: 2 } }),
  'GET /api/me': () => ({ body: { user: testUser, savedIssueIds } }),
})

describe('Discover page', () => {
  it('shows ranked results and a GitHub sign-in button when signed out', async () => {
    mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: page([makeIssue({ id: 1, title: 'First' })]) }) })
    renderAt('/')
    expect(await screen.findByRole('link', { name: 'First' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /sign in with github/i })[0]).toHaveAttribute('href', '/api/auth/github')
    expect(screen.getByText('1 open issue')).toBeInTheDocument()
  })

  it('sends skills, languages, level and filters from the URL to the API', async () => {
    const fetch = mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: page([]) }) })
    renderAt('/?skills=react,css&langs=TypeScript&level=medium&language=Go&label=help%20wanted&difficulty=easy&page=2')
    await screen.findByText(/no open issues match/i)
    const call = fetch.mock.calls.map(([u]) => new URL(String(u), 'http://x')).find((u) => u.pathname === '/api/issues')!
    expect(Object.fromEntries(call.searchParams)).toMatchObject({
      skills: 'react,css',
      preferredLanguages: 'TypeScript',
      level: 'medium',
      language: 'Go',
      label: 'help wanted',
      difficulty: 'easy',
      page: '2',
    })
  })

  it('refetches when a language filter is toggled', async () => {
    const fetch = mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: page([makeIssue()]) }) })
    renderAt('/')
    await screen.findByRole('link', { name: 'Fix bug 1' })
    const languageGroup = screen.getByRole('group', { name: 'Language' })
    await userEvent.click(within(languageGroup).getByRole('button', { name: 'Python' }))
    await waitFor(() => {
      const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/issues'))
      expect(urls.at(-1)).toContain('language=Python')
    })
  })

  it('seeds the search from the saved profile and lets a signed-in user save an issue', async () => {
    const fetch = mockApi({
      ...signedIn(),
      'GET /api/issues': () => ({ body: page([makeIssue({ id: 9, title: 'Nine' })]) }),
      'PUT /api/me/saved/9': () => ({ status: 204 }),
    })
    renderAt('/')
    await waitFor(() => {
      const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/issues'))
      expect(urls.at(-1)).toContain('skills=react')
    })
    await screen.findByRole('link', { name: 'Nine' })
    await userEvent.click(screen.getByRole('button', { name: '☆ Save' }))
    expect(await screen.findByRole('button', { name: '★ Saved' })).toBeInTheDocument()
    expect(fetch.mock.calls.some(([u, init]) => u === '/api/me/saved/9' && init?.method === 'PUT')).toBe(true)
  })

  it('shows a readable message for OAuth errors', async () => {
    mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: page([]) }) })
    renderAt('/?authError=denied')
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub sign-in was cancelled.')
  })
})

describe('Dashboard', () => {
  it('asks signed-out users to sign in', async () => {
    mockApi(signedOut)
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: 'My Dashboard' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /sign in with github/i }).length).toBeGreaterThan(0)
  })

  it('lists saved issues, notes hidden closed ones, and saves the profile', async () => {
    const fetch = mockApi({
      ...signedIn([5]),
      'PUT /api/me/profile': (_u, init) => ({ body: { user: { ...testUser, ...JSON.parse(String(init!.body)) } } }),
    })
    renderAt('/dashboard')
    expect(await screen.findByRole('link', { name: 'Saved one' })).toBeInTheDocument()
    expect(screen.getByText(/2 saved issues were closed on GitHub/)).toBeInTheDocument()

    const save = screen.getByRole('button', { name: 'Save profile' })
    expect(save).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Hard' }))
    await userEvent.click(save)
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument()
    const put = fetch.mock.calls.find(([u]) => u === '/api/me/profile')!
    expect(JSON.parse(String(put[1]!.body))).toEqual({ skills: ['react'], preferredLanguages: ['TypeScript'], difficulty: 'hard' })
  })
})

describe('readQuery', () => {
  it('parses and sanitises URL params', () => {
    const q = readQuery(new URLSearchParams('skills=a,,b&level=bogus&difficulty=easy,nope&page=-3'))
    expect(q).toMatchObject({ skills: ['a', 'b'], level: null, difficulty: ['easy'], page: 1 })
  })
})
