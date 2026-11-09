import { useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api, type BlogQuery, type BlogsPage as BlogsPageData } from '../api'
import { BlogCard } from '../components/BlogCard'
import { ChipInput } from '../components/ChipInput'
import { DifficultyPicker } from '../components/DifficultyPicker'
import { Pagination } from '../components/Pagination'
import { ToggleChips } from '../components/ToggleChips'
import { useSession } from '../sessionContext'
import { readBlogQuery, writeBlogQuery } from './blogsQuery'

const SKILL_SUGGESTIONS = [
  'react', 'kafka', 'kubernetes', 'security', 'performance', 'databases', 'machine learning', 'networking', 'git',
  'payments', 'observability', 'testing',
]

export function BlogsPage() {
  const { meta, user } = useSession()
  const [params, setParams] = useSearchParams()
  const query = readBlogQuery(params)
  const key = writeBlogQuery(query).toString()

  const [result, setResult] = useState<{ key: string; data?: BlogsPageData; error?: string } | null>(null)
  const [lastData, setLastData] = useState<BlogsPageData | null>(null)
  const loading = result?.key !== key
  const data = result?.data ?? lastData
  const error = loading ? null : (result?.error ?? null)
  const [panelOpen, setPanelOpen] = useState(false)
  const panelId = useId()
  const activeCount = query.skills.length + query.preferredLanguages.length + (query.level ? 1 : 0) + query.company.length

  const update = (patch: Partial<BlogQuery>) =>
    setParams(writeBlogQuery({ ...query, page: 1, ...patch }), { replace: !('page' in patch) })

  // Same as Discover: rank by the saved profile unless the URL already carries one.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || user === undefined) return
    seeded.current = true
    if (user && !params.has('skills') && !params.has('langs') && !params.has('level')) {
      const profile = { skills: user.skills, preferredLanguages: user.preferredLanguages, level: user.difficulty }
      setParams(writeBlogQuery({ ...query, ...profile }), {
        replace: true,
      })
    }
  }, [user, params, query, setParams])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .blogs(readBlogQuery(new URLSearchParams(key)), controller.signal)
        .then((page) => {
          setResult({ key, data: page })
          setLastData(page)
        })
        .catch((err: unknown) => {
          if ((err as Error).name !== 'AbortError') setResult({ key, error: (err as Error).message })
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  return (
    <div className="discover">
      <aside className={`sidebar card${panelOpen ? ' is-open' : ''}`} aria-label="Blog options">
        <button
          type="button"
          className="sidebar-toggle"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => setPanelOpen((o) => !o)}
        >
          <span>Interests &amp; filters</span>
          <span className="sidebar-toggle-meta">
            {activeCount > 0 && <span className="count-badge">{activeCount} active</span>}
            <span className="chevron" aria-hidden>
              ▾
            </span>
          </span>
        </button>

        <div className="sidebar-body" id={panelId}>
          <h2 className="sidebar-title">Your interests</h2>
          <ChipInput
            label="Skills"
            value={query.skills}
            onChange={(skills) => update({ skills })}
            placeholder="kafka, security, react…"
            suggestions={SKILL_SUGGESTIONS}
          />
          <ChipInput
            label="Preferred languages (in order)"
            value={query.preferredLanguages}
            onChange={(preferredLanguages) => update({ preferredLanguages })}
            placeholder="TypeScript, Python…"
            suggestions={meta?.languages}
            max={10}
          />
          <DifficultyPicker label="Your level" value={query.level} onChange={(level) => update({ level })} />

          <h2 className="sidebar-title">Filters</h2>
          <ToggleChips
            label="Company"
            options={data?.companies ?? []}
            selected={query.company}
            onChange={(company) => update({ company })}
          />
          {query.company.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ company: [] })}>
              Clear filters
            </button>
          )}
          <button type="button" className="btn btn-primary sidebar-done" onClick={() => setPanelOpen(false)}>
            {data ? `Show ${data.total.toLocaleString()} post${data.total === 1 ? '' : 's'}` : 'Show posts'}
          </button>
        </div>
      </aside>

      <section className="results" aria-busy={loading} aria-label="Blog posts">
        <div className="results-header">
          <h1>Tech Blogs</h1>
          {data && (
            <p className="muted">
              {data.total.toLocaleString()} post{data.total === 1 ? '' : 's'} from company engineering blogs
            </p>
          )}
        </div>

        {error && (
          <div className="banner banner-error" role="alert">
            Couldn&apos;t load blog posts: {error}
          </div>
        )}
        {!data && loading && <p className="muted">Loading…</p>}
        {data && data.items.length === 0 && !loading && (
          <div className="empty card">
            <p>No posts yet{query.company.length > 0 ? ' for these companies' : ''}.</p>
            <p className="muted">Posts are fetched once a day from each company&apos;s feed.</p>
          </div>
        )}

        <div className={`issue-list${loading && data ? ' is-stale' : ''}`}>
          {data?.items.map((post) => <BlogCard key={post.id} post={post} />)}
        </div>

        {data && (
          <Pagination
            page={query.page}
            totalPages={data.totalPages}
            onChange={(page) => {
              update({ page })
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        )}
      </section>
    </div>
  )
}
