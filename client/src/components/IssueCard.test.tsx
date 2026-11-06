import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeIssue } from '../test/mockApi'
import { timeAgo } from '../format'
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

  it('mentions an assignee when present', () => {
    render(<IssueCard issue={makeIssue({ assignee: 'someone' })} />)
    expect(screen.getByText(/assigned to someone/)).toBeInTheDocument()
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
