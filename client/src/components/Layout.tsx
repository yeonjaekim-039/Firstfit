import type { ReactNode } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router'
import { LOGIN_URL } from '../api'
import { useSession } from '../sessionContext'

export function Layout({ children }: { children: ReactNode }) {
  const { user, meta, logout } = useSession()
  const navigate = useNavigate()
  // Discover has the forest header and draws its own full-width sections.
  const onDiscover = useMatch({ path: '/', end: true }) !== null

  return (
    <>
      <header className={`site-header${onDiscover ? ' site-header--forest' : ''}`}>
        <div className="container header-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden>
              {onDiscover ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="18" cy="18" r="3" />
                  <path d="M6 9v3a6 6 0 0 0 6 6h3" />
                </svg>
              ) : (
                '◆'
              )}
            </span>{' '}
            Issue Matcher
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end>
              Discover
            </NavLink>
            <NavLink to="/blogs">Tech Blogs</NavLink>
            <NavLink to="/dashboard">My Dashboard</NavLink>
          </nav>
          <div className="account">
            {user ? (
              <>
                {user.avatarUrl && <img className="avatar" src={user.avatarUrl} alt="" width={28} height={28} />}
                <span className="account-name">{user.login}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => logout().then(() => navigate('/'))}
                >
                  Sign out
                </button>
              </>
            ) : (
              user === null &&
              meta?.auth.github && (
                <a className="btn btn-primary btn-sm" href={LOGIN_URL}>
                  Sign in with GitHub
                </a>
              )
            )}
          </div>
        </div>
      </header>
      <main className={onDiscover ? undefined : 'container'}>{children}</main>
    </>
  )
}
