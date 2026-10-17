import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Session } from '@supabase/supabase-js'
import { db } from '../db'
import { supabase } from './client'
import { cloudEngine } from './runtime'
import type { Connection, SyncStatus } from './model'

export function useCloud() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [authError, setAuthError] = useState('')
  const local = useLiveQuery(async () => ({
    connection: (await db.syncMeta.get('connection'))?.value as Connection | undefined,
    status: ((await db.syncMeta.get('status'))?.value as SyncStatus | undefined) ?? {},
    pending: await db.outbox.orderBy('createdAt').toArray(),
  }))
  useEffect(() => {
    if (!supabase) return
    let mounted = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      setSession(data.session); setAuthReady(true)
      if (error) setAuthError('Cloud-Anmeldung ist gerade nicht verfügbar. Lokale Daten bleiben erhalten.')
    }).catch(() => { if (mounted) { setAuthReady(true); setAuthError('Cloud-Anmeldung nicht verfügbar.') } })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next); setAuthReady(true)
      if (event === 'SIGNED_OUT') {
        // Do not await Supabase APIs inside this auth callback.
        void db.transaction('rw', db.syncMeta, async () => {
          const connection = (await db.syncMeta.get('connection'))?.value as Connection | undefined
          if (connection) await db.syncMeta.put({ key: 'connection', value: { ...connection, locked: true } })
        }).catch(() => setAuthError('Abmeldung konnte nicht gespeichert werden. Bitte die Seite schließen.'))
      }
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])
  const owner = local?.connection?.userId
  const locked = local?.connection?.locked
  useEffect(() => {
    if (!cloudEngine || !owner || locked) return
    const sync = () => { if (navigator.onLine) void cloudEngine!.sync() }
    const foreground = () => { if (document.visibilityState === 'visible') sync() }
    sync()
    const timer = setInterval(sync, 15000)
    window.addEventListener('online', sync); window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', foreground)
    return () => { clearInterval(timer); window.removeEventListener('online', sync); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', foreground) }
  }, [owner, locked, session?.user.id])
  const pendingIds = local?.pending.map(o => o.id).join(',')
  useEffect(() => {
    if (!cloudEngine || !owner || locked || !navigator.onLine) return
    const timer = setTimeout(() => void cloudEngine!.sync(), 300)
    return () => clearTimeout(timer)
  }, [pendingIds, owner, locked])
  const mismatch = !!(session && owner && session.user.id !== owner)
  return { session, authReady, authError, ...local, loaded: !!local, blocked: !!locked || mismatch }
}
export type CloudState = ReturnType<typeof useCloud>
