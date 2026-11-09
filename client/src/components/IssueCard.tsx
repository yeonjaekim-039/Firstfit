import type { Issue, ScoreBreakdown } from '../api'
import { LOGIN_URL } from '../api'
import { formatCount, safeHttpUrl, timeAgo } from '../format'

const BREAKDOWN_LABELS: [keyof ScoreBreakdown, string][] = [
  ['match', 'Skill match'],
  ['labels', 'Labels'],
  ['difficulty', 'Difficulty fit'],
  ['freshness', 'Freshness'],
  ['repo', 'Repo quality'],
]

interface Props {
  issue: Issue
  saved?: boolean
  /** Present when signed in. */
  onToggleSave?: () => void
  /** Show a "sign in to save" link when signed out and login is available. */
  canSignIn?: boolean
}

export function IssueCard({ issue, saved = false, onToggleSave, canSignIn = false }: Props) {
  // Blog links come from untrusted feeds: drop any that aren't http(s) rather than render them.
  const relatedPosts = issue.relatedPosts.flatMap((post) => {
    const href = safeHttpUrl(post.url)
    return href ? [{ post, href }] : []
  })
  return (
    <article className="card issue-card">
      <div className="issue-main">
        <div className="issue-meta">
          <a className="repo-link" href={issue.repo.url} target="_blank" rel="noreferrer">
            {issue.repo.fullName}
          </a>
          {issue.repo.stars !== null && (
            <span className="stars" title={`${issue.repo.stars.toLocaleString()} stars`}>
              <span aria-hidden>★</span> {formatCount(issue.repo.stars)}
              <span className="visually-hidden"> stars</span>
            </span>
          )}
          <span className="dot" aria-hidden>
            ·
          </span>
          <span>#{issue.number}</span>
          {issue.language && <span className="badge badge-lang">{issue.language}</span>}
          <span className={`badge badge-${issue.difficulty}`}>{issue.difficulty}</span>
        </div>

        <h3 className="issue-title">
          <a href={issue.url} target="_blank" rel="noreferrer">
            {issue.title}
          </a>
        </h3>

        {issue.labels.length > 0 && (
          <ul className="labels" aria-label="Labels">
            {issue.labels.map((l) => (
              <li key={l} className="label">
                {l}
              </li>
            ))}
          </ul>
        )}

        <p className="issue-stats">
          {issue.commentCount} comment{issue.commentCount === 1 ? '' : 's'} · updated {timeAgo(issue.updatedAt)}
          {issue.assignee && <> · assigned to {issue.assignee}</>}
        </p>

        {relatedPosts.length > 0 && (
          <div className="related-posts">
            <span className="related-posts-label">Related reading</span>
            <ul aria-label="Related blog posts">
              {relatedPosts.map(({ post, href }) => (
                <li key={post.id}>
                  <a href={href} target="_blank" rel="noreferrer">
                    {post.title}
                  </a>{' '}
                  <span className="muted">· {post.company}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="issue-actions">
          <a className="btn btn-primary btn-sm" href={issue.url} target="_blank" rel="noreferrer">
            View issue ↗
          </a>
          <a className="btn btn-sm" href={issue.repo.url} target="_blank" rel="noreferrer">
            Repository ↗
          </a>
          {onToggleSave ? (
            <button type="button" className="btn btn-sm" aria-pressed={saved} onClick={onToggleSave}>
              {saved ? '★ Saved' : '☆ Save'}
            </button>
          ) : (
            canSignIn && (
              <a className="btn btn-ghost btn-sm" href={LOGIN_URL}>
                Sign in to save
              </a>
            )
          )}
        </div>
      </div>

      <aside className="score" aria-label={`Match score ${issue.score} out of 100`}>
        <div className="score-value">
          {Math.round(issue.score)}
          <span>/100</span>
        </div>
        <dl className="breakdown">
          {BREAKDOWN_LABELS.map(([key, label]) => {
            const pct = Math.round(issue.breakdown[key] * 100)
            return (
              <div key={key} className="breakdown-row">
                <dt>{label}</dt>
                <dd>
                  <span className="bar" aria-hidden>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="pct">{pct}%</span>
                </dd>
              </div>
            )
          })}
        </dl>
        {issue.crowding < 1 && (
          <p className="score-note" title="Long threads often mean the issue is contested or already being worked on">
            −{Math.round((1 - issue.crowding) * 100)}% for a busy thread ({issue.commentCount} comments)
          </p>
        )}
      </aside>
    </article>
  )
}
