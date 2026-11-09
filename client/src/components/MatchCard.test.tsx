import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeIssue } from '../test/mockApi'
import { MatchCard } from './MatchCard'

describe('MatchCard', () => {
  const issue = makeIssue({ id: 7, number: 3947, title: 'Add dark mode', labels: ['good first issue', 'ui'], difficulty: 'medium' })

  it('shows the issue, its repo, labels, rounded score and breakdown', () => {
    render(<MatchCard issue={issue} />)
    expect(screen.getByRole('link', { name: 'Add dark mode' })).toHaveAttribute('href', issue.url)
    expect(screen.getByRole('link', { name: 'acme/app' })).toHaveAttribute('href', issue.repo.url)
    expect(screen.getByRole('link', { name: 'View issue' })).toHaveAttribute('href', issue.url)
    expect(within(screen.getByRole('list', { name: 'Labels' })).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Match score 87 out of 100' })).toHaveTextContent('87MATCH')
    expect(screen.getByText(/#3947 · TypeScript · Medium/)).toBeInTheDocument()
    expect(screen.getByText('Freshness').nextElementSibling).toHaveTextContent('86')
  })

  it('toggles save when signed in and offers sign-in when signed out', async () => {
    const onToggleSave = vi.fn()
    const { rerender } = render(<MatchCard issue={issue} onToggleSave={onToggleSave} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save issue' }))
    expect(onToggleSave).toHaveBeenCalledOnce()
    rerender(<MatchCard issue={issue} saved onToggleSave={onToggleSave} />)
    expect(screen.getByRole('button', { name: 'Save issue' })).toHaveAttribute('aria-pressed', 'true')
    rerender(<MatchCard issue={issue} canSignIn />)
    expect(screen.getByRole('link', { name: 'Sign in to save' })).toHaveAttribute('href', '/api/auth/github')
  })

  it('keeps the busy-thread note and omits stars until repo metadata exists', () => {
    render(
      <MatchCard
        issue={makeIssue({ commentCount: 30, crowding: 0.85, repo: { fullName: 'a/b', url: 'u', stars: null, pushedAt: null } })}
      />,
    )
    expect(screen.getByText('−15% for a busy thread (30 comments)')).toBeInTheDocument()
    expect(screen.queryByText(/★/)).toBeNull()
  })
})
