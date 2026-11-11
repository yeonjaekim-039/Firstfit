import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeIssue } from '../test/mockApi'
import { TopMatchCard } from './TopMatchCard'

describe('TopMatchCard', () => {
  const issue = makeIssue({ id: 7, title: 'Add dark mode', score: 50, commentCount: 1 })

  it('shows the issue with a ring and breakdown drawn from its score', () => {
    render(<TopMatchCard issue={issue} preferredLanguages={[]} />)
    expect(screen.getByRole('link', { name: 'Add dark mode' })).toHaveAttribute('href', issue.url)
    expect(screen.getByRole('link', { name: /start on this issue/i })).toHaveAttribute('href', issue.url)
    expect(screen.getByRole('link', { name: 'acme/app' })).toHaveAttribute('href', issue.repo.url)
    const ring = screen.getByRole('img', { name: 'Match score 50 out of 100' })
    expect(ring.querySelector('.score-ring-arc')).toHaveAttribute('stroke-dasharray', '157.1 314.2')
    expect(screen.getByText('Skill match').nextElementSibling).toHaveTextContent('74')
  })

  it('only claims a language preference the profile actually has', () => {
    const { unmount } = render(<TopMatchCard issue={issue} preferredLanguages={['typescript']} />)
    expect(screen.getByText(/^Matches your TypeScript preference · Easy · 1 comment · updated/)).toBeInTheDocument()
    unmount()
    render(<TopMatchCard issue={issue} preferredLanguages={['Go']} />)
    expect(screen.getByText(/^TypeScript · Easy · 1 comment · updated/)).toBeInTheDocument()
  })

  it('toggles save when signed in and offers sign-in when signed out', async () => {
    const onToggleSave = vi.fn()
    const { rerender } = render(<TopMatchCard issue={issue} preferredLanguages={[]} onToggleSave={onToggleSave} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onToggleSave).toHaveBeenCalledOnce()
    rerender(<TopMatchCard issue={issue} preferredLanguages={[]} saved onToggleSave={onToggleSave} />)
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true')
    rerender(<TopMatchCard issue={issue} preferredLanguages={[]} canSignIn />)
    expect(screen.getByRole('link', { name: /sign in to save/i })).toHaveAttribute('href', '/api/auth/github')
  })

  it('keeps the busy-thread note and drops unsafe related posts', () => {
    render(
      <TopMatchCard
        issue={makeIssue({
          commentCount: 30,
          crowding: 0.85,
          relatedPosts: [
            { id: 1, company: 'Evil', title: 'Hostile', url: 'javascript:alert(1)', publishedAt: null },
            { id: 2, company: 'Good', title: 'Fine', url: 'https://blog.example.test/ok', publishedAt: null },
          ],
        })}
        preferredLanguages={[]}
      />,
    )
    expect(screen.getByText('−15% for a busy thread (30 comments)')).toBeInTheDocument()
    expect(screen.queryByText('Hostile')).toBeNull()
    expect(screen.getByRole('link', { name: 'Fine' })).toBeInTheDocument()
  })
})
