const SKELETON_CARDS = 4

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-line" style={{ width: '45%' }} />
      <div className="skeleton-line skeleton-line--title" style={{ width: '90%' }} />
      <div className="skeleton-line skeleton-line--title" style={{ width: '65%' }} />
      <div className="skeleton-pills">
        <div className="skeleton-pill" />
        <div className="skeleton-pill" />
      </div>
    </div>
  )
}

export function ResultsSkeleton() {
  return (
    <div role="status">
      <span className="visually-hidden">Loading issues…</span>
      <div className="discover-results" aria-hidden>
        <div className="skeleton-card skeleton-hero">
          <div className="skeleton-hero-main">
            <div className="skeleton-line" style={{ width: '30%' }} />
            <div className="skeleton-line skeleton-line--headline" style={{ width: '85%' }} />
            <div className="skeleton-line" style={{ width: '55%' }} />
          </div>
          <div className="skeleton-ring" />
        </div>
        <div className="match-grid">
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

interface EmptyProps {
  /** Matches exist, but the requested page is past the end of them. */
  offPage: boolean
  onFirstPage: () => void
  /** Present when any filter is active. */
  onClearFilters?: () => void
}

export function EmptyResults({ offPage, onFirstPage, onClearFilters }: EmptyProps) {
  if (offPage) {
    return (
      <div className="state-card">
        <h2>No issues on this page.</h2>
        <p>The results have changed since this link was made.</p>
        <button type="button" className="btn btn-primary" onClick={onFirstPage}>
          Back to the first page
        </button>
      </div>
    )
  }
  return (
    <div className="state-card">
      <h2>No open issues match these filters.</h2>
      {onClearFilters ? (
        <>
          <p>Try removing a language or label filter.</p>
          <button type="button" className="btn btn-primary" onClick={onClearFilters}>
            Clear filters
          </button>
        </>
      ) : (
        <p>New issues are added every day, so check back soon.</p>
      )}
    </div>
  )
}

interface ErrorProps {
  message: string
  rateLimited: boolean
  onRetry: () => void
}

export function LoadError({ message, rateLimited, onRetry }: ErrorProps) {
  return (
    <div className="state-card" role="alert">
      <h2>{rateLimited ? 'Too many requests right now.' : 'Couldn’t load issues.'}</h2>
      <p>{rateLimited ? 'Give it a minute, then try again.' : message}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
