import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api, DIFFICULTIES, type Difficulty, type IssueQuery, type IssuesPage } from '../api'
import { ChipInput } from '../components/ChipInput'
import { DifficultyPicker } from '../components/DifficultyPicker'
import { IssueCard } from '../components/IssueCard'
import { Pagination } from '../components/Pagination'
import { ToggleChips } from '../components/ToggleChips'
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

  return (
    <div className="discover">
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

      <aside className="sidebar card" aria-label="Search options">
        <h2 className="sidebar-title">About you</h2>
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
        {profileChanged && (
          <button type="button" className="btn btn-sm" onClick={saveProfile}>
            Save as my profile
          </button>
        )}

        <h2 className="sidebar-title">Filters</h2>
        <ToggleChips
          label="Language"
          options={meta?.languages ?? []}
          selected={query.language}
          onChange={(language) => update({ language })}
        />
        <ToggleChips
          label="Label"
          options={meta?.labels ?? []}
          selected={query.label}
          onChange={(label) => update({ label })}
        />
        <ToggleChips
          label="Difficulty"
          options={DIFFICULTIES}
          format={(d) => d[0]!.toUpperCase() + d.slice(1)}
          selected={query.difficulty}
          onChange={(difficulty) => update({ difficulty: difficulty as Difficulty[] })}
        />
        {(query.language.length > 0 || query.label.length > 0 || query.difficulty.length > 0) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => update({ language: [], label: [], difficulty: [] })}
          >
            Clear filters
          </button>
        )}
      </aside>

      <section className="results" aria-busy={loading} aria-label="Results">
        <div className="results-header">
          <h1>Ranked for you</h1>
          {data && (
            <p className="muted">
              {data.total.toLocaleString()} open issue{data.total === 1 ? '' : 's'}
              {data.rankedCount < data.total && ` · top ${data.rankedCount.toLocaleString()} most recent ranked`}
            </p>
          )}
        </div>

        {notice && (
          <div className="banner" role="status">
            {notice}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
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

        <div className={`issue-list${loading && data ? ' is-stale' : ''}`}>
          {data?.items.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              saved={savedIds.has(issue.id)}
              onToggleSave={user ? () => onToggleSave(issue.id) : undefined}
              canSignIn={user === null && Boolean(meta?.auth.github)}
            />
          ))}
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
