import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api, type IssueQuery, type IssuesPage } from '../api'
import { ChipInput } from '../components/ChipInput'
import { DifficultyPicker } from '../components/DifficultyPicker'
import { DiscoverHeader } from '../components/DiscoverHeader'
import { FilterBar } from '../components/FilterBar'
import { IssueCard } from '../components/IssueCard'
import { Pagination } from '../components/Pagination'
import { ProfileDrawer } from '../components/ProfileDrawer'
import { TopMatchCard } from '../components/TopMatchCard'
import { useSession } from '../sessionContext'
import { readQuery, writeQuery } from './discoverQuery'

const SKILL_SUGGESTIONS = [
  'react', 'vue', 'angular', 'svelte', 'node.js', 'django', 'flask', 'fastapi', 'rails', 'spring',
  'css', 'html', 'docs', 'testing', 'cli', 'api', 'sql', 'docker', 'kubernetes', 'machine learning',
]

const AUTH_ERRORS: Record<string, string> = {
  denied: 'GitHub sign-in was cancelled.',
  state: 'Sign-in expired or was interrupted. Please try again.',
  failed: 'Sign-in failed. Please try again.',
  unavailable: 'GitHub sign-in is not configured on this server.',
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

export function DiscoverPage() {
  const { meta, user, savedIds, toggleSave, setUser } = useSession()
  const [params, setParams] = useSearchParams()
  const query = readQuery(params)
  const key = writeQuery(query).toString()

  // The last completed fetch, tagged with the query it answered; loading = it isn't for the current query.
  const [result, setResult] = useState<{ key: string; data?: IssuesPage; error?: string } | null>(null)
  const [lastData, setLastData] = useState<IssuesPage | null>(null)
  const loading = result?.key !== key
  const data = result?.data ?? lastData
  const error = loading ? null : (result?.error ?? null)
  const [notice, setNotice] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const authError = params.get('authError')

  const update = (patch: Partial<IssueQuery>) =>
    setParams(writeQuery({ ...query, page: 1, ...patch }), { replace: !('page' in patch) })

  // Seed the form from the saved profile once, unless the URL already says what to look for.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || user === undefined) return
    seeded.current = true
    const hasProfile = params.has('skills') || params.has('langs') || params.has('level')
    if (user && !hasProfile) {
      setParams(
        writeQuery({ ...query, skills: user.skills, preferredLanguages: user.preferredLanguages, level: user.difficulty }),
        { replace: true },
      )
    }
  }, [user, params, query, setParams])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .issues(readQuery(new URLSearchParams(key)), controller.signal)
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

  const profileChanged =
    user &&
    (!sameList(query.skills, user.skills) ||
      !sameList(query.preferredLanguages, user.preferredLanguages) ||
      (query.level !== null && query.level !== user.difficulty))

  const saveProfile = async () => {
    try {
      const { user: updated } = await api.updateProfile({
        skills: query.skills,
        preferredLanguages: query.preferredLanguages,
        difficulty: query.level ?? user?.difficulty ?? 'easy',
      })
      setUser(updated)
      setNotice('Saved as your profile.')
    } catch (err) {
      setNotice((err as Error).message)
    }
  }

  const onToggleSave = (id: number) =>
    toggleSave(id).catch((err: Error) => setNotice(`Couldn't update saved issues: ${err.message}`))

  const saveProps = (id: number) => ({
    saved: savedIds.has(id),
    onToggleSave: user ? () => onToggleSave(id) : undefined,
    canSignIn: user === null && Boolean(meta?.auth.github),
  })

  // Results arrive ranked, so the first item on page 1 is the highest-scoring issue overall.
  const topMatch = data?.page === 1 ? data.items[0] : undefined
  const otherIssues = topMatch ? data!.items.slice(1) : (data?.items ?? [])

  // The modal drawer covers the page, so the notice moves into it while it's open.
  const noticeBanner = notice && (
    <div className="banner" role="status">
      {notice}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>
        Dismiss
      </button>
    </div>
  )

  return (
    <div className="discover-page">
      <DiscoverHeader
        user={user}
        data={data}
        loading={loading}
        skills={query.skills}
        languages={query.preferredLanguages}
        level={query.level}
        onEditProfile={() => setDrawerOpen(true)}
      />

      <ProfileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        {noticeBanner}
        <ChipInput
          label="Skills"
          value={query.skills}
          onChange={(skills) => update({ skills })}
          placeholder="react, css, docs…"
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
        <div className="drawer-actions">
          {profileChanged && (
            <button type="button" className="btn" onClick={saveProfile}>
              Save as my profile
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setDrawerOpen(false)}>
            Done
          </button>
        </div>
      </ProfileDrawer>

      <FilterBar
        languages={meta?.languages ?? []}
        labels={meta?.labels ?? []}
        selected={query}
        onChange={update}
      />

      <div className="discover-wrap discover-body">
        {authError && (
          <div className="banner banner-error" role="alert">
            {AUTH_ERRORS[authError] ?? 'Sign-in failed.'}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const next = new URLSearchParams(params)
                next.delete('authError')
                setParams(next, { replace: true })
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="results" aria-busy={loading} aria-label="Results">
          {!drawerOpen && noticeBanner}
          {error && (
            <div className="banner banner-error" role="alert">
              Couldn&apos;t load issues: {error}
            </div>
          )}

          {!data && loading && <p className="muted">Loading…</p>}
          {data && data.items.length === 0 && !loading && (
            <div className="empty card">
              <p>No open issues match these filters.</p>
              <p className="muted">Try removing a language or label filter.</p>
            </div>
          )}

          <div className={`discover-results${loading && data ? ' is-stale' : ''}`}>
            {topMatch && (
              <TopMatchCard issue={topMatch} preferredLanguages={query.preferredLanguages} {...saveProps(topMatch.id)} />
            )}
            {otherIssues.length > 0 && (
              <div className="issue-list">
                {otherIssues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} {...saveProps(issue.id)} />
                ))}
              </div>
            )}
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
    </div>
  )
}
