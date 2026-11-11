import type { RelatedPost } from '../api'
import { safeHttpUrl } from '../format'

export function RelatedPosts({ posts }: { posts: RelatedPost[] }) {
  // Blog links come from untrusted feeds: drop any that aren't http(s) rather than render them.
  const safe = posts.flatMap((post) => {
    const href = safeHttpUrl(post.url)
    return href ? [{ post, href }] : []
  })
  if (safe.length === 0) return null
  return (
    <div className="related-posts">
      <span className="related-posts-label">Related reading</span>
      <ul aria-label="Related blog posts">
        {safe.map(({ post, href }) => (
          <li key={post.id}>
            <a href={href} target="_blank" rel="noreferrer">
              {post.title}
            </a>{' '}
            <span className="muted">· {post.company}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
