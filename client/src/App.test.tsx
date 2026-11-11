import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { readQuery } from './pages/discoverQuery'
import { blogsPage, makeIssue, makePost, META, mockApi, page, testUser } from './test/mockApi'

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
    expect(screen.getByText('1 open issue ranked for you.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('1 issue you could ship this week.')
  })

  it('greets by first name, counts the results and shows what the ranking uses', async () => {
    mockApi({
      ...signedIn(),
      'GET /api/issues': () => ({
        body: { ...page([makeIssue({ id: 1 }), makeIssue({ id: 2 })]), total: 290_881, rankedCount: 5000 },
      }),
    })
    renderAt('/?skills=react,docs&langs=TypeScript,Java&level=medium')
    await screen.findByRole('link', { name: 'Fix bug 1' })
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('2 issues you could ship this week, The.')
    expect(screen.getByText('Ranked from 5,000 recent issues across 290,881 open ones.')).toBeInTheDocument()
    const card = within(screen.getByRole('region', { name: 'Matching on' }))
    for (const chip of ['react', 'docs', '1 · TypeScript', '2 · Java', 'Level: Medium']) {
      expect(card.getByText(chip)).toBeInTheDocument()
    }
  })

  it('edits the profile in a drawer and can save it', async () => {
    const fetch = mockApi({
      ...signedIn(),
      'GET /api/issues': () => ({ body: page([makeIssue()]) }),
      'PUT /api/me/profile': (_u, init) => ({ body: { user: { ...testUser, ...JSON.parse(String(init!.body)) } } }),
    })
    renderAt('/?skills=react&langs=TypeScript&level=easy')
    await screen.findByRole('link', { name: 'Fix bug 1' })
    expect(screen.queryByLabelText('Skills')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    const drawer = within(await screen.findByRole('dialog', { name: 'Edit profile' }))
    await userEvent.type(drawer.getByLabelText('Skills'), 'css{Enter}')
    await waitFor(() => {
      const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/issues'))
      expect(urls.at(-1)).toContain('skills=react%2Ccss')
    })

    await userEvent.click(drawer.getByRole('button', { name: 'Save as my profile' }))
    expect(await drawer.findByText('Saved as your profile.')).toBeInTheDocument()
    const put = fetch.mock.calls.find(([u]) => u === '/api/me/profile')!
    expect(JSON.parse(String(put[1]!.body))).toEqual({ skills: ['react', 'css'], preferredLanguages: ['TypeScript'], difficulty: 'easy' })

    await userEvent.click(drawer.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(fetch.mock.calls.some(([u, init]) => u === '/api/me/saved/9' && init?.method === 'PUT')).toBe(true)
  })

  it('keeps extra languages behind a toggle in the filter bar', async () => {
    const fetch = mockApi({
      'GET /api/meta': () => ({ body: { ...META, languages: ['TypeScript', 'Python', 'Go', 'Rust', 'Java'] } }),
      'GET /api/me': () => ({ status: 401, body: { error: 'Not signed in' } }),
      'GET /api/issues': () => ({ body: page([makeIssue()]) }),
    })
    renderAt('/')
    const languages = within(await screen.findByRole('group', { name: 'Language' }))
    const more = await languages.findByRole('button', { name: 'More languages' })
    expect(languages.queryByRole('button', { name: 'Rust' })).not.toBeInTheDocument()

    await userEvent.click(more)
    expect(languages.getByRole('button', { name: 'Fewer languages' })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(languages.getByRole('button', { name: 'Rust' }))
    await waitFor(() => {
      const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/issues'))
      expect(urls.at(-1)).toContain('language=Rust')
    })

    // Deselecting the extra language leaves the row expanded, so the chip being clicked stays put.
    await userEvent.click(languages.getByRole('button', { name: 'Rust' }))
    expect(languages.getByRole('button', { name: 'Rust' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a selected extra language from a shared URL and clears all filters', async () => {
    const fetch = mockApi({
      'GET /api/meta': () => ({ body: { ...META, languages: ['TypeScript', 'Python', 'Go', 'Rust'] } }),
      'GET /api/me': () => ({ status: 401, body: { error: 'Not signed in' } }),
      'GET /api/issues': () => ({ body: page([makeIssue()]) }),
    })
    renderAt('/?language=Rust&label=help%20wanted&difficulty=easy')
    const rust = await screen.findByRole('button', { name: 'Rust' })
    expect(rust).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => {
      const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/issues'))
      expect(urls.at(-1)).not.toMatch(/language=|label=|difficulty=/)
    })
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('features the first ranked issue as the Top match and lists the rest below it', async () => {
    const items = [makeIssue({ id: 1, title: 'Best', score: 92 }), makeIssue({ id: 2, title: 'Next', score: 80 })]
    mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: page(items) }) })
    renderAt('/')
    const top = within(await screen.findByRole('article', { name: 'Top match' }))
    expect(top.getByRole('link', { name: 'Best' })).toBeInTheDocument()
    expect(top.getByRole('img', { name: 'Match score 92 out of 100' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Best' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Next' }).closest('.match-card')).not.toBeNull()
  })

  it('has no Top match after the first page', async () => {
    const items = [makeIssue({ id: 21, title: 'Page two item' })]
    mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: { ...page(items), page: 2, totalPages: 3 } }) })
    renderAt('/?page=2')
    await screen.findByRole('link', { name: 'Page two item' })
    expect(screen.queryByRole('article', { name: 'Top match' })).not.toBeInTheDocument()
  })

  it('labels the grid with the range shown and the ranked total pagination can reach', async () => {
    const items = [makeIssue({ id: 1 }), makeIssue({ id: 2 }), makeIssue({ id: 3 })]
    mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: { ...page(items), total: 295_681, rankedCount: 5000, totalPages: 250 } }) })
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Also worth a look' })).toBeInTheDocument()
    expect(screen.getByText('Showing 1–3 of 5,000 ranked matches')).toBeInTheDocument()
  })

  it('counts from the start of later pages', async () => {
    const items = [makeIssue({ id: 21 }), makeIssue({ id: 22 })]
    mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: { ...page(items), page: 2, total: 42, rankedCount: 42, totalPages: 3 } }) })
    renderAt('/?page=2')
    expect(await screen.findByRole('heading', { name: 'More matches' })).toBeInTheDocument()
    expect(screen.getByText('Showing 21–22 of 42 ranked matches')).toBeInTheDocument()
  })

  it('shows skeleton cards until the first results arrive', async () => {
    mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: page([makeIssue()]) }) })
    renderAt('/')
    expect(screen.getByRole('status')).toHaveTextContent('Loading issues…')
    expect(document.querySelectorAll('.skeleton-card').length).toBeGreaterThan(0)
    await screen.findByRole('link', { name: 'Fix bug 1' })
    expect(document.querySelector('.skeleton-card')).toBeNull()
  })

  it('offers to clear filters when nothing matches', async () => {
    const fetch = mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: page([]) }) })
    renderAt('/?language=Go')
    await screen.findByRole('heading', { name: 'No open issues match these filters.' })
    const card = screen.getByRole('heading', { name: 'No open issues match these filters.' }).parentElement!
    await userEvent.click(within(card).getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => {
      const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/issues'))
      expect(urls.at(-1)).not.toContain('language=')
    })
  })

  it('links back to the first page when the requested page is past the end', async () => {
    const fetch = mockApi({ ...signedOut, 'GET /api/issues': () => ({ body: { ...page([]), page: 9, total: 42, totalPages: 3 } }) })
    renderAt('/?page=9')
    await userEvent.click(await screen.findByRole('button', { name: 'Back to the first page' }))
    await waitFor(() => {
      const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/issues'))
      expect(urls.at(-1)).toContain('page=1')
    })
  })

  it('shows the rate-limit state on a 429 and recovers on Try again', async () => {
    let calls = 0
    mockApi({
      ...signedOut,
      'GET /api/issues': () => (++calls === 1 ? { status: 429, body: { error: 'Slow down' } } : { body: page([makeIssue()]) }),
    })
    renderAt('/')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many requests right now.')
    expect(alert).not.toHaveTextContent('Slow down')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Fix bug 1' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows other failures with their message instead of stale results', async () => {
    let calls = 0
    mockApi({
      ...signedOut,
      'GET /api/issues': () => (++calls === 1 ? { body: page([makeIssue({ title: 'Old result' })]) } : { status: 500, body: { error: 'Internal server error' } }),
    })
    renderAt('/')
    await screen.findByRole('link', { name: 'Old result' })
    await userEvent.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'Python' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load issues.')
    expect(alert).toHaveTextContent('Internal server error')
    expect(screen.queryByRole('link', { name: 'Old result' })).not.toBeInTheDocument()
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

describe('Tech Blogs page', () => {
  const blogsCall = (fetch: ReturnType<typeof mockApi>) =>
    fetch.mock.calls
      .map(([u]) => new URL(String(u), 'http://x'))
      .filter((u) => u.pathname === '/api/blogs')
      .at(-1)!

  it('is reachable from the nav and lists posts ranked for the URL profile', async () => {
    const fetch = mockApi({
      ...signedOut,
      'GET /api/blogs': () => ({ body: blogsPage([makePost({ id: 1, title: 'Rust at the edge' })]) }),
    })
    renderAt('/blogs?skills=rust&langs=Go')
    expect(await screen.findByRole('link', { name: 'Rust at the edge' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tech Blogs' })).toHaveAttribute('href', '/blogs')
    expect(screen.getByText('1 post from company engineering blogs')).toBeInTheDocument()
    expect(Object.fromEntries(blogsCall(fetch).searchParams)).toMatchObject({ skills: 'rust', preferredLanguages: 'Go' })
  })

  it('filters by company', async () => {
    const fetch = mockApi({ ...signedOut, 'GET /api/blogs': () => ({ body: blogsPage([makePost()]) }) })
    renderAt('/blogs')
    await screen.findByRole('link', { name: 'Post 1' })
    await userEvent.click(within(screen.getByRole('group', { name: 'Company' })).getByRole('button', { name: 'Netflix' }))
    await waitFor(() => expect(blogsCall(fetch).searchParams.get('company')).toBe('Netflix'))
  })

  it("ranks by a signed-in user's saved skills and languages", async () => {
    const fetch = mockApi({ ...signedIn(), 'GET /api/blogs': () => ({ body: blogsPage([]) }) })
    renderAt('/blogs')
    await screen.findByText(/no posts yet/i)
    await waitFor(() =>
      expect(Object.fromEntries(blogsCall(fetch).searchParams)).toMatchObject({
        skills: 'react',
        preferredLanguages: 'TypeScript',
        level: 'easy',
      }),
    )
  })
})

describe('readQuery', () => {
  it('parses and sanitises URL params', () => {
    const q = readQuery(new URLSearchParams('skills=a,,b&level=bogus&difficulty=easy,nope&page=-3'))
    expect(q).toMatchObject({ skills: ['a', 'b'], level: null, difficulty: ['easy'], page: 1 })
  })
})
