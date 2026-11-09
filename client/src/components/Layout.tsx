import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { LOGIN_URL } from '../api'
import { useSession } from '../sessionContext'

export function Layout({ children }: { children: ReactNode }) {
  const { user, meta, logout } = useSession()
  const navigate = useNavigate()

  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden>
              ◆
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
      <main className="container">{children}</main>
    </>
  )
}
