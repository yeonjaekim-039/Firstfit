import { createContext, useContext } from 'react'
import type { Meta, User } from './api'

export interface Session {
  meta: Meta | null
  /** undefined while loading, null when signed out. */
  user: User | null | undefined
  savedIds: ReadonlySet<number>
  setUser: (user: User) => void
  toggleSave: (issueId: number) => Promise<void>
  logout: () => Promise<void>
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
