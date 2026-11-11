import type { Issue } from '../api'
import { LOGIN_URL } from '../api'
import { BREAKDOWN_LABELS, formatCount, timeAgo } from '../format'
import { RelatedPosts } from './RelatedPosts'

interface Props {
  issue: Issue
  saved?: boolean
  /** Present when signed in. */
  onToggleSave?: () => void
  /** Show a "sign in to save" link when signed out and login is available. */
  canSignIn?: boolean
}

function BookmarkIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  )
}

export function MatchCard({ issue, saved = false, onToggleSave, canSignIn = false }: Props) {
  const score = Math.round(issue.score)
  const details = [
    `#${issue.number}`,
    issue.language,
    issue.difficulty[0]!.toUpperCase() + issue.difficulty.slice(1),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="match-card">
      <div className="match-card-head">
        <div className="match-card-source">
          <a className="match-card-repo" href={issue.repo.url} target="_blank" rel="noreferrer">
            {issue.repo.fullName}
          </a>
          <span className="match-card-details">
            {issue.repo.stars !== null && (
              <span title={`${issue.repo.stars.toLocaleString()} stars`}>
                <span aria-hidden>★</span> {formatCount(issue.repo.stars)}
                <span className="visually-hidden"> stars</span>
                {' · '}
              </span>
            )}
            {details}
          </span>
        </div>
        <div className="match-card-score" role="img" aria-label={`Match score ${score} out of 100`}>
          <div className="match-card-score-value">{score}</div>
          <div className="match-card-score-label">MATCH</div>
        </div>
      </div>

      <h3 className="match-card-title">
        <a href={issue.url} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
      </h3>

      {issue.labels.length > 0 && (
        <ul className="match-card-labels" aria-label="Labels">
          {issue.labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}

      <RelatedPosts posts={issue.relatedPosts} />

      {issue.crowding < 1 && (
        <p className="score-note" title="Long threads often mean the issue is contested or already being worked on">
          −{Math.round((1 - issue.crowding) * 100)}% for a busy thread ({issue.commentCount} comments)
        </p>
      )}

      <details className="match-card-why">
        <summary>Score breakdown</summary>
        <dl>
          {BREAKDOWN_LABELS.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{Math.round(issue.breakdown[key] * 100)}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="match-card-footer">
        <span className="match-card-activity">
          {issue.commentCount} comment{issue.commentCount === 1 ? '' : 's'} · {timeAgo(issue.updatedAt)}
        </span>
        <div className="match-card-actions">
          {onToggleSave ? (
            <button type="button" className="match-card-save" aria-label="Save issue" aria-pressed={saved} onClick={onToggleSave}>
              <BookmarkIcon filled={saved} />
            </button>
          ) : (
            canSignIn && (
              <a className="match-card-save" href={LOGIN_URL} aria-label="Sign in to save" title="Sign in to save">
                <BookmarkIcon />
              </a>
            )
          )}
          <a className="btn btn-primary match-card-view" href={issue.url} target="_blank" rel="noreferrer">
            View issue
          </a>
        </div>
      </div>
    </article>
  )
}
