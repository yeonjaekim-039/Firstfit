import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeIssue } from '../test/mockApi'
import { formatCount, safeHttpUrl, timeAgo } from '../format'
import { IssueCard } from './IssueCard'

describe('IssueCard', () => {
  const issue = makeIssue({ id: 7, title: 'Add dark mode', labels: ['good first issue', 'ui'], difficulty: 'medium' })

  it('shows title, repo, labels, difficulty and score breakdown', () => {
    render(<IssueCard issue={issue} />)
    expect(screen.getByRole('link', { name: 'Add dark mode' })).toHaveAttribute('href', issue.url)
    expect(screen.getByRole('link', { name: 'acme/app' })).toHaveAttribute('href', 'https://github.com/acme/app')
    expect(within(screen.getByRole('list', { name: 'Labels' })).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('medium')).toBeInTheDocument()
    expect(screen.getByLabelText('Match score 87.4 out of 100')).toHaveTextContent('87/100')
    expect(screen.getByText('Skill match').nextElementSibling).toHaveTextContent('74%')
    expect(screen.getByText('Freshness').nextElementSibling).toHaveTextContent('86%')
    expect(screen.getByText('Repo quality').nextElementSibling).toHaveTextContent('90%')
  })

  it('explains a busy-thread penalty only when one was applied', () => {
    const { unmount } = render(<IssueCard issue={issue} />)
    expect(screen.queryByText(/busy thread/)).not.toBeInTheDocument()
    unmount()
    render(<IssueCard issue={makeIssue({ commentCount: 30, crowding: 0.85 })} />)
    expect(screen.getByText('−15% for a busy thread (30 comments)')).toBeInTheDocument()
  })

  it('shows the repo star count, abbreviated, with the exact count in the tooltip', () => {
    render(<IssueCard issue={issue} />)
    const stars = screen.getByTitle('12,345 stars')
    expect(stars).toHaveTextContent('★ 12.3k stars')
  })

  it('omits the star count when repo metadata has not been fetched', () => {
    render(<IssueCard issue={makeIssue({ repo: { fullName: 'a/b', url: 'u', stars: null, pushedAt: null } })} />)
    expect(screen.queryByText(/★/)).toBeNull()
  })

  it('links directly to the issue and repo in a new tab', () => {
    render(<IssueCard issue={issue} />)
    const view = screen.getByRole('link', { name: /view issue/i })
    expect(view).toHaveAttribute('href', issue.url)
    expect(view).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: /repository/i })).toHaveAttribute('href', issue.repo.url)
  })

  it('toggles save when signed in', async () => {
    const onToggleSave = vi.fn()
    const { rerender } = render(<IssueCard issue={issue} onToggleSave={onToggleSave} />)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onToggleSave).toHaveBeenCalledOnce()
    rerender(<IssueCard issue={issue} saved onToggleSave={onToggleSave} />)
    expect(screen.getByRole('button', { name: /saved/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('offers sign-in instead of save when signed out', () => {
    render(<IssueCard issue={issue} canSignIn />)
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
    expect(screen.getByRole('link', { name: /sign in to save/i })).toHaveAttribute('href', '/api/auth/github')
  })

  it('shows related blog posts only when there are some', () => {
    const { unmount } = render(<IssueCard issue={issue} />)
    expect(screen.queryByRole('list', { name: 'Related blog posts' })).toBeNull()
    unmount()
    render(
      <IssueCard
        issue={makeIssue({
          relatedPosts: [
            { id: 1, company: 'Cloudflare', title: 'Inside workerd', url: 'https://blog.example.test/workerd', publishedAt: null },
          ],
        })}
      />,
    )
    const related = screen.getByRole('list', { name: 'Related blog posts' })
    expect(within(related).getByRole('link', { name: 'Inside workerd' })).toHaveAttribute('href', 'https://blog.example.test/workerd')
    expect(within(related).getByText('· Cloudflare')).toBeInTheDocument()
  })

  it('drops related posts whose URL is not http(s)', () => {
    render(
      <IssueCard
        issue={makeIssue({
          relatedPosts: [
            { id: 1, company: 'Evil', title: 'Hostile', url: 'javascript:alert(1)', publishedAt: null },
            { id: 2, company: 'Good', title: 'Fine', url: 'https://blog.example.test/ok', publishedAt: null },
          ],
        })}
      />,
    )
    const related = screen.getByRole('list', { name: 'Related blog posts' })
    expect(within(related).queryByText('Hostile')).toBeNull()
    expect(within(related).getByRole('link', { name: 'Fine' })).toHaveAttribute('href', 'https://blog.example.test/ok')
  })

  it('mentions an assignee when present', () => {
    render(<IssueCard issue={makeIssue({ assignee: 'someone' })} />)
    expect(screen.getByText(/assigned to someone/)).toBeInTheDocument()
  })
})

describe('safeHttpUrl', () => {
  it.each([
    ['https://a.test/x', 'https://a.test/x'],
    ['http://a.test/x', 'http://a.test/x'],
    ['javascript:alert(1)', undefined],
    ['JAVASCRIPT:alert(1)', undefined],
    ['java\tscript:alert(1)', undefined],
    ['data:text/html,x', undefined],
    ['vbscript:x', undefined],
    ['/relative', undefined],
    ['', undefined],
    [null, undefined],
  ])('%j -> %j', (input, expected) => {
    expect(safeHttpUrl(input)).toBe(expected)
  })
})

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [950, '950'],
    [1000, '1k'],
    [1234, '1.2k'],
    [45_600, '45.6k'],
    [999_949, '999.9k'],
    [999_950, '1M'],
    [1_200_000, '1.2M'],
  ])('%d -> %s', (n, expected) => {
    expect(formatCount(n)).toBe(expected)
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-11-01T00:00:00Z')
  it.each([
    ['2026-11-01T00:00:00Z', 'just now'],
    ['2026-10-31T23:30:00Z', '30m ago'],
    ['2026-10-31T21:00:00Z', '3h ago'],
    ['2026-10-25T00:00:00Z', '7d ago'],
    ['2026-07-01T00:00:00Z', '4mo ago'],
    ['2024-10-01T00:00:00Z', '2y ago'],
  ])('%s -> %s', (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected)
  })
})
