import { useState } from 'react'
import type { Difficulty, IssuesPage, User } from '../api'

interface Props {
  user: User | null | undefined
  data: IssuesPage | null
  loading: boolean
  skills: string[]
  languages: string[]
  level: Difficulty | null
  onEditProfile: () => void
}

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1)

function headline(data: IssuesPage | null, loading: boolean): string {
  if (!data) return loading ? 'Finding issues you could ship' : 'Issues you could ship'
  const count = data.items.length
  if (count === 0) return 'No matches'
  return `${count} issue${count === 1 ? '' : 's'} you could ship`
}

function summary({ total, rankedCount }: IssuesPage): string | null {
  if (total === 0) return null
  if (rankedCount < total) {
    return `Ranked from ${rankedCount.toLocaleString()} recent issues across ${total.toLocaleString()} open ones.`
  }
  return `${total.toLocaleString()} open issue${total === 1 ? '' : 's'} ranked for you.`
}

export function DiscoverHeader({ user, data, loading, skills, languages, level, onEditProfile }: Props) {
  const name = user?.name?.trim().split(/\s+/)[0] || user?.login
  const [weekday] = useState(() => new Date().toLocaleDateString('en-US', { weekday: 'long' }))
  const sub = data && summary(data)

  return (
    <header className="hero">
      <div className="discover-wrap hero-inner">
        <div className="hero-copy">
          <p className="hero-eyebrow">{weekday} picks</p>
          <h1 className="hero-title">
            {headline(data, loading)} <br />
            this week{name ? `, ${name}` : ''}.
          </h1>
          {sub && <p className="hero-sub">{sub}</p>}
        </div>

        <section className="matching-card" aria-label="Matching on">
          <div className="matching-card-head">
            <span>Matching on</span>
            <button type="button" className="matching-edit" onClick={onEditProfile}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 20h4L19 9l-4-4L4 16z" />
              </svg>
              Edit profile
            </button>
          </div>
          <ul className="matching-chips">
            {skills.map((skill) => (
              <li key={skill} className="matching-chip">
                {skill}
              </li>
            ))}
            {languages.map((language, i) => (
              <li key={language} className="matching-chip matching-chip--outline">
                {i + 1} · {language}
              </li>
            ))}
            <li className="matching-chip matching-chip--level">Level: {level ? capitalize(level) : 'Any'}</li>
            {skills.length === 0 && languages.length === 0 && (
              <li className="matching-empty">Add skills and languages to sharpen your matches.</li>
            )}
          </ul>
        </section>
      </div>
    </header>
  )
}
