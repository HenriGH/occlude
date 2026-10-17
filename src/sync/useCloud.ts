import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Session } from '@supabase/supabase-js'
import { db } from '../db'
import { initialAuthError, supabase } from './client'
import { authFeedback } from './authFeedback'
import { cloudEngine } from './runtime'
import type { Connection, SyncStatus } from './model'

export function useCloud() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [authError, setAuthError] = useState(initialAuthError)
  const wake = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Only this tiny local read guards access to the cached workspace. Loading
  // auth, status or a large upload queue must not hold the app's startup screen.
  const identity = useLiveQuery(async () => ({ connection: (await db.syncMeta.get('connection'))?.value as Connection | undefined }))
  const local = useLiveQuery(async () => ({
    status: ((await db.syncMeta.get('status'))?.value as SyncStatus | undefined) ?? {},
    // Key cursors avoid cloning every image/mask payload for a status badge.
    pending: await db.outbox.orderBy('createdAt').primaryKeys(),
    conflicts: (await db.outbox.where('state').equals('conflict').toArray()).map(({ id, kind }) => ({ id, kind })),
    sequence: (await db.syncMeta.get('sequence'))?.value as number | undefined,
  }))
  useEffect(() => {
    if (!supabase) return
    let mounted = true
    // getSession alone does not surface URL-exchange initialization failures.
    supabase.auth.initialize().then(({ error }) => { if (mounted && error) setAuthError(initialAuthError || authFeedback(error)) }).catch(() => { if (mounted) setAuthError('Der Anmeldelink konnte nicht verarbeitet werden. Bitte den E-Mail-Code verwenden.') })
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      setSession(data.session); setAuthReady(true)
      if (error) setAuthError(initialAuthError || authFeedback(error))
    }).catch(() => { if (mounted) { setAuthReady(true); setAuthError('Cloud-Anmeldung nicht verfügbar.') } })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next); setAuthReady(true)
      if (event === 'SIGNED_IN') setAuthError('')
      // Auth expiry/recovery must not lock an offline workspace. Explicit
      // sign-out persists the lock before calling Auth (CloudSettings).
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])
  const owner = identity?.connection?.userId
  const locked = identity?.connection?.locked
  const signedInOwner = session?.user.id === owner && !!owner
  useEffect(() => {
    if (!cloudEngine || !signedInOwner || locked) return
    const sync = () => { if (navigator.onLine && document.visibilityState !== 'hidden') void cloudEngine!.sync() }
    // Focus and visibilitychange commonly fire together on mobile. Coalesce
    // them, and leave the first render free to read the local library first.
    const foreground = () => { clearTimeout(wake.current); wake.current = setTimeout(() => { wake.current = undefined; sync() }, 400) }
    foreground()
    const timer = setInterval(() => { if (wake.current === undefined) sync() }, 15000)
    window.addEventListener('online', foreground); window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', foreground)
    return () => { clearInterval(timer); clearTimeout(wake.current); wake.current = undefined; window.removeEventListener('online', foreground); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground) }
  }, [signedInOwner, locked])
  useEffect(() => {
    if (!cloudEngine || !signedInOwner || locked || !local?.sequence || !navigator.onLine || document.visibilityState === 'hidden') return
    clearTimeout(wake.current)
    wake.current = setTimeout(() => {
      wake.current = undefined
      if (navigator.onLine && document.visibilityState !== 'hidden') void cloudEngine!.sync()
    }, 300)
    return () => { clearTimeout(wake.current); wake.current = undefined }
    // Trigger only on local additions, not acknowledgments/deletions produced
    // by the worker itself. In-flight additions request another pass.
  }, [local?.sequence, signedInOwner, locked])
  const mismatch = !!(session && owner && session.user.id !== owner)
  return { session, authReady, authError, ...identity, ...local, loaded: !!identity, blocked: !!locked || mismatch }
}
export type CloudState = ReturnType<typeof useCloud>
