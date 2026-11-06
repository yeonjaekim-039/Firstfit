import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type Difficulty, LOGIN_URL, type SavedIssue, type User } from '../api'
import { ChipInput } from '../components/ChipInput'
import { DifficultyPicker } from '../components/DifficultyPicker'
import { IssueCard } from '../components/IssueCard'
import { useSession } from '../sessionContext'

export function DashboardPage() {
  const { user, meta } = useSession()

  if (user === undefined) return <p className="muted page-pad">Loading…</p>
  if (user === null) {
    return (
      <div className="card empty signin-card">
        <h1>My Dashboard</h1>
        {meta?.auth.github ? (
          <>
            <p>Sign in with GitHub to save issues and keep your matching profile.</p>
            <a className="btn btn-primary" href={LOGIN_URL}>
              Sign in with GitHub
            </a>
          </>
        ) : (
          <p className="muted">GitHub sign-in isn&apos;t configured on this server yet.</p>
        )}
      </div>
    )
  }
  return <Dashboard user={user} />
}

function Dashboard({ user }: { user: User }) {
  const { meta, savedIds, toggleSave, setUser } = useSession()
  const [saved, setSaved] = useState<SavedIssue[] | null>(null)
  const [hiddenClosed, setHiddenClosed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [skills, setSkills] = useState(user.skills)
  const [langs, setLangs] = useState(user.preferredLanguages)
  const [level, setLevel] = useState<Difficulty>(user.difficulty)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    api.saved().then(
      (r) => {
        setSaved(r.items)
        setHiddenClosed(r.hiddenClosed)
      },
      (err: Error) => setError(err.message),
    )
  }, [])

  const dirty =
    skills.join() !== user.skills.join() ||
    langs.join() !== user.preferredLanguages.join() ||
    level !== user.difficulty

  const saveProfile = async () => {
    setStatus('saving')
    try {
      const { user: updated } = await api.updateProfile({ skills, preferredLanguages: langs, difficulty: level })
      setUser(updated)
      setStatus('saved')
    } catch (err) {
      setError((err as Error).message)
      setStatus('idle')
    }
  }

  const discoverLink = `/?${new URLSearchParams({
    ...(skills.length ? { skills: skills.join(',') } : {}),
    ...(langs.length ? { langs: langs.join(',') } : {}),
    level,
  })}`

  // Items unsaved on this page stay visible (with "Save" toggled off) until reload, so an accidental click is easy to undo.
  const visible = saved ?? []

  return (
    <div className="dashboard">
      <section className="card profile-card">
        <div className="profile-head">
          {user.avatarUrl && <img className="avatar avatar-lg" src={user.avatarUrl} alt="" width={56} height={56} />}
          <div>
            <h1>{user.name ?? user.login}</h1>
            {user.login && (
              <a className="muted" href={`https://github.com/${user.login}`} target="_blank" rel="noreferrer">
                @{user.login}
              </a>
            )}
          </div>
        </div>

        <h2 className="sidebar-title">Matching profile</h2>
        <div className="profile-fields">
          <ChipInput
            label="Skills"
            value={skills}
            onChange={(v) => (setSkills(v), setStatus('idle'))}
            placeholder="react, css, docs…"
          />
          <ChipInput
            label="Preferred languages (in order)"
            value={langs}
            onChange={(v) => (setLangs(v), setStatus('idle'))}
            suggestions={meta?.languages}
            placeholder="TypeScript, Python…"
            max={10}
          />
          <DifficultyPicker
            label="Your level"
            value={level}
            allowAny={false}
            onChange={(v) => (setLevel(v ?? 'easy'), setStatus('idle'))}
          />
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || status === 'saving'} onClick={saveProfile}>
            {status === 'saving' ? 'Saving…' : 'Save profile'}
          </button>
          {status === 'saved' && !dirty && <span className="muted">Saved ✓</span>}
          <Link className="btn btn-sm" to={discoverLink}>
            Find matches →
          </Link>
        </div>
      </section>

      <section className="saved" aria-label="Saved issues">
        <div className="results-header">
          <h2>Saved issues</h2>
          {saved && <p className="muted">{savedIds.size} saved</p>}
        </div>
        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}
        {hiddenClosed > 0 && (
          <p className="muted">
            {hiddenClosed} saved issue{hiddenClosed === 1 ? ' was' : 's were'} closed on GitHub and {hiddenClosed === 1 ? 'is' : 'are'} hidden.
          </p>
        )}
        {saved === null && !error && <p className="muted">Loading…</p>}
        {saved && visible.length === 0 && (
          <div className="card empty">
            <p>No saved issues yet.</p>
            <Link to="/" className="btn btn-sm">
              Discover issues
            </Link>
          </div>
        )}
        <div className="issue-list">
          {visible.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              saved={savedIds.has(issue.id)}
              onToggleSave={() => toggleSave(issue.id).catch((err: Error) => setError(err.message))}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
