import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, type Meta, type User } from './api'
import { SessionContext } from './sessionContext'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [savedIds, setSavedIds] = useState<ReadonlySet<number>>(new Set())

  useEffect(() => {
    api.meta().then(setMeta, () => setMeta({ languages: [], labels: [], auth: { github: false } }))
    api.me().then(
      ({ user, savedIssueIds }) => {
        setUser(user)
        setSavedIds(new Set(savedIssueIds))
      },
      (err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err)
        setUser(null)
      },
    )
  }, [])

  const toggleSave = useCallback(
    async (issueId: number) => {
      const wasSaved = savedIds.has(issueId)
      const flip = (saved: boolean) =>
        setSavedIds((prev) => {
          const next = new Set(prev)
          if (saved) next.add(issueId)
          else next.delete(issueId)
          return next
        })
      flip(!wasSaved) // optimistic
      try {
        await (wasSaved ? api.unsave(issueId) : api.save(issueId))
      } catch (err) {
        flip(wasSaved)
        throw err
      }
    },
    [savedIds],
  )

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    setSavedIds(new Set())
  }, [])

  const value = useMemo(
    () => ({ meta, user, savedIds, setUser, toggleSave, logout }),
    [meta, user, savedIds, toggleSave, logout],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
