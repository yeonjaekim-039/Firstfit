import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeIssue, makePost } from '../test/mockApi'
import { BlogCard } from './BlogCard'

describe('BlogCard', () => {
  it('shows title, company, date and excerpt, linking to the original article', () => {
    render(<BlogCard post={makePost({ id: 3, title: 'Rust at the edge', company: 'Cloudflare' })} />)
    expect(screen.getByRole('link', { name: 'Rust at the edge' })).toHaveAttribute('href', 'https://blog.example.test/posts/3')
    expect(screen.getByRole('link', { name: /read on cloudflare/i })).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Cloudflare')).toBeInTheDocument()
    expect(screen.getByText('Nov 5, 2026')).toHaveAttribute('dateTime', '2026-11-05T20:23:21Z')
    expect(screen.getByText('How we built it.')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Topics' })).getByText('rust')).toBeInTheDocument()
  })

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>x</script>', '/relative'])(
    'never puts a non-http(s) post URL (%j) in an href',
    (url) => {
      const { container } = render(<BlogCard post={makePost({ title: 'Hostile post', url })} />)
      expect(screen.getByText('Hostile post')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Hostile post' })).toBeNull()
      expect(screen.queryByRole('link', { name: /read on/i })).toBeNull()
      for (const a of container.querySelectorAll('a')) expect(a.getAttribute('href')).toMatch(/^https?:\/\//)
    },
  )

  it('omits the date when the feed had none', () => {
    render(<BlogCard post={makePost({ publishedAt: null })} />)
    expect(screen.queryByRole('time')).toBeNull()
    expect(document.querySelector('time')).toBeNull()
  })

  it('links mentioned repos and lists their beginner-friendly issues', () => {
    const post = makePost({
      repos: ['cloudflare/workerd', 'a/b', 'c/d', 'e/f', 'g/h', 'i/j'],
      issues: [makeIssue({ id: 42, title: 'Fix the docs build', repo: { fullName: 'cloudflare/workerd', url: 'u', stars: 1, pushedAt: null } })],
    })
    render(<BlogCard post={post} />)
    expect(screen.getByRole('link', { name: 'cloudflare/workerd' })).toHaveAttribute('href', 'https://github.com/cloudflare/workerd')
    expect(screen.getByText(/and 2 more/)).toBeInTheDocument()
    const issues = screen.getByRole('region', { name: /beginner-friendly issues/i })
    expect(within(issues).getByRole('link', { name: 'Fix the docs build' })).toHaveAttribute(
      'href',
      'https://github.com/acme/app/issues/42',
    )
    expect(within(issues).getByText('cloudflare/workerd#42')).toBeInTheDocument()
  })

  it('shows no issues section when no mentioned repo has open beginner issues', () => {
    render(<BlogCard post={makePost({ repos: ['a/b'], issues: [] })} />)
    expect(screen.queryByRole('region', { name: /beginner-friendly issues/i })).toBeNull()
  })
})
