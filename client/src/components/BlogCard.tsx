import type { BlogPost } from '../api'
import { formatDate, safeHttpUrl } from '../format'

const MAX_REPOS_SHOWN = 4

export function BlogCard({ post }: { post: BlogPost }) {
  const shownRepos = post.repos.slice(0, MAX_REPOS_SHOWN)
  // Feed content is untrusted: only ever link to http(s).
  const href = safeHttpUrl(post.url)
  return (
    <article className="card blog-card">
      <div className="blog-meta">
        <span className="blog-company">{post.company}</span>
        {post.publishedAt && (
          <>
            <span className="dot" aria-hidden>
              ·
            </span>
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          </>
        )}
        <span className="blog-score" title="Match with your skills and languages, plus recency">
          {Math.round(post.score)}
          <span>/100</span>
        </span>
      </div>

      <h3 className="issue-title">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {post.title}
          </a>
        ) : (
          post.title
        )}
      </h3>

      {post.excerpt && <p className="blog-excerpt">{post.excerpt}</p>}

      {post.tags.length > 0 && (
        <ul className="labels" aria-label="Topics">
          {post.tags.map((t) => (
            <li key={t} className="label">
              {t}
            </li>
          ))}
        </ul>
      )}

      {shownRepos.length > 0 && (
        <p className="blog-repos">
          Mentions{' '}
          {shownRepos.map((repo, i) => (
            <span key={repo}>
              {i > 0 && ', '}
              <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">
                {repo}
              </a>
            </span>
          ))}
          {post.repos.length > shownRepos.length && ` and ${post.repos.length - shownRepos.length} more`}
        </p>
      )}

      {post.issues.length > 0 && (
        <section className="blog-issues" aria-label="Beginner-friendly issues from repos in this post">
          <h4>Beginner-friendly issues from repos in this post</h4>
          <ul>
            {post.issues.map((issue) => (
              <li key={issue.id}>
                <a href={issue.url} target="_blank" rel="noreferrer">
                  {issue.title}
                </a>
                <span className="blog-issue-meta">
                  {issue.repo.fullName}#{issue.number}
                  <span className={`badge badge-${issue.difficulty}`}>{issue.difficulty}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {href && (
        <div className="issue-actions">
          <a className="btn btn-primary btn-sm" href={href} target="_blank" rel="noreferrer">
            Read on {post.company} ↗
          </a>
        </div>
      )}
    </article>
  )
}
