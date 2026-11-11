import type { Issue } from '../api'
import { LOGIN_URL } from '../api'
import { BREAKDOWN_LABELS, formatCount, timeAgo } from '../format'
import { RelatedPosts } from './RelatedPosts'

interface Props {
  issue: Issue
  preferredLanguages: string[]
  saved?: boolean
  /** Present when signed in. */
  onToggleSave?: () => void
  /** Show a "sign in to save" link when signed out and login is available. */
  canSignIn?: boolean
}

const RING_RADIUS = 50
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function detailLine(issue: Issue, preferredLanguages: string[]): string {
  const { language, difficulty, commentCount, updatedAt } = issue
  const preferred = language && preferredLanguages.some((l) => l.toLowerCase() === language.toLowerCase())
  return [
    preferred ? `Matches your ${language} preference` : language,
    difficulty[0]!.toUpperCase() + difficulty.slice(1),
    `${commentCount} comment${commentCount === 1 ? '' : 's'}`,
    `updated ${timeAgo(updatedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function TopMatchCard({ issue, preferredLanguages, saved = false, onToggleSave, canSignIn = false }: Props) {
  const score = Math.round(issue.score)
  const arc = (RING_CIRCUMFERENCE * issue.score) / 100

  return (
    <article className="top-match" aria-label="Top match">
      <div className="top-match-main">
        <div className="top-match-meta">
          <span className="top-match-badge">Top match</span>
          <span className="top-match-repo">
            <a href={issue.repo.url} target="_blank" rel="noreferrer">
              {issue.repo.fullName}
            </a>
            {issue.repo.stars !== null && (
              <span title={`${issue.repo.stars.toLocaleString()} stars`}>
                {' · '}
                <span aria-hidden>★</span> {formatCount(issue.repo.stars)}
                <span className="visually-hidden"> stars</span>
              </span>
            )}
            {` · #${issue.number}`}
          </span>
        </div>

        <h2 className="top-match-title">
          <a href={issue.url} target="_blank" rel="noreferrer">
            {issue.title}
          </a>
        </h2>

        <p className="top-match-detail">{detailLine(issue, preferredLanguages)}</p>

        {issue.labels.length > 0 && (
          <ul className="top-match-labels" aria-label="Labels">
            {issue.labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}

        <RelatedPosts posts={issue.relatedPosts} />

        <div className="top-match-actions">
          <a className="top-match-cta" href={issue.url} target="_blank" rel="noreferrer">
            Start on this issue
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
          {onToggleSave ? (
            <button type="button" className="top-match-secondary" aria-pressed={saved} onClick={onToggleSave}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill={saved ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M6 3h12v18l-6-4-6 4z" />
              </svg>
              {saved ? 'Saved' : 'Save'}
            </button>
          ) : (
            canSignIn && (
              <a className="top-match-secondary" href={LOGIN_URL}>
                Sign in to save
              </a>
            )
          )}
        </div>
      </div>

      <div className="top-match-score">
        <div className="top-match-score-row">
          <svg className="score-ring" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`Match score ${score} out of 100`}>
            <circle className="score-ring-track" cx="60" cy="60" r={RING_RADIUS} />
            <circle
              className="score-ring-arc"
              cx="60"
              cy="60"
              r={RING_RADIUS}
              strokeDasharray={`${arc.toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`}
              transform="rotate(-90 60 60)"
            />
            <text className="score-ring-value" x="60" y="72" textAnchor="middle">
              {score}
            </text>
          </svg>
          <dl className="top-match-breakdown">
            {BREAKDOWN_LABELS.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{Math.round(issue.breakdown[key] * 100)}</dd>
              </div>
            ))}
          </dl>
        </div>
        {issue.crowding < 1 && (
          <p className="top-match-note" title="Long threads often mean the issue is contested or already being worked on">
            −{Math.round((1 - issue.crowding) * 100)}% for a busy thread ({issue.commentCount} comments)
          </p>
        )}
      </div>
    </article>
  )
}
