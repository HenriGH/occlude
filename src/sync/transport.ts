import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Asset } from '../domain'
import type { WireOperation } from './model'
import { cloudFetch } from './network'

export class CloudError extends Error {
  constructor(message: string, public conflict = false) { super(message) }
}
export interface Transport {
  userId(): Promise<string>
  snapshot(owner: string): Promise<unknown>
  apply(operation: WireOperation, owner: string): Promise<void>
  upload(owner: string, asset: Asset): Promise<void>
  download(owner: string, hash: string): Promise<Blob>
}
export async function contentHash(blob: Blob) {
  const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}
function failure(error: { message: string; code?: string }): never {
  if (error.code === 'PGRST202' || error.code === '42P01') throw new CloudError('Die Supabase-Migration fehlt. Bitte die SQL-Datei aus supabase/migrations im SQL Editor ausführen.')
  if (error.message.startsWith('conflict:') || error.code === '23505') throw new CloudError('Eine andere Geräteänderung betrifft dieselben Daten. Die lokale Änderung bleibt erhalten; bitte den Konflikt in den Einstellungen prüfen.', true)
  throw new CloudError(`Cloud-Anfrage fehlgeschlagen: ${error.message}`)
}
export function supabaseTransport(client: SupabaseClient, configuration: { url: string; key: string }): Transport {
  let verified: { token: string; result: Promise<{ scoped: SupabaseClient; userId: string }> } | undefined
  async function authorized(owner?: string) {
    const { data: { session } } = await client.auth.getSession()
    if (!session) throw new CloudError('Bitte erneut anmelden, um zu synchronisieren. Lokale Karten bleiben verfügbar.')
    const token = session.access_token
    // Verify each access token once, sharing concurrent verification. Every
    // request still re-reads the session and checks its verified owner. Token
    // refresh/account changes invalidate this cache; RLS authorizes every RPC.
    if (!verified || verified.token !== token) {
      const result = (async () => {
        const { data, error } = await client.auth.getUser(token)
        if (error || !data.user) throw new CloudError('Cloud-Anmeldung konnte nicht bestätigt werden. Lokale Karten bleiben verfügbar.')
        const scoped = createClient(configuration.url, configuration.key, { accessToken: async () => token, global: { fetch: cloudFetch } })
        return { scoped, userId: data.user.id }
      })()
      verified = { token, result }
      void result.catch(() => { if (verified?.result === result) verified = undefined })
    }
    const result = await verified.result
    if (owner && result.userId !== owner) throw new CloudError('Das angemeldete Konto passt nicht zu den lokalen Daten. Synchronisierung angehalten.')
    return result
  }
  return {
    async userId() {
      return (await authorized()).userId
    },
    async snapshot(owner) {
      const { scoped } = await authorized(owner)
      const response = await scoped.rpc('occlude_snapshot_v2')
      if (!response.error) return response.data
      if (response.error.code !== 'PGRST202' && response.error.code !== '42883') failure(response.error)
      const legacy = await scoped.rpc('occlude_snapshot')
      if (legacy.error) failure(legacy.error)
      return legacy.data
    },
    async apply(operation, owner) {
      const { scoped } = await authorized(owner)
      const { error } = await scoped.rpc('occlude_apply_operation', { p_operation: operation })
      if (error) failure(error)
    },
    async upload(owner, asset) {
      const bucket = (await authorized(owner)).scoped.storage.from('occlude-images')
      if (await contentHash(asset.blob) !== asset.hash) throw new CloudError('Die lokale Bilddatei ist beschädigt. Upload abgebrochen.')
      const path = `${owner}/${asset.hash}`
      const { error } = await bucket.upload(path, asset.blob, { contentType: asset.mimeType, upsert: false })
      if (!error) return
      // An earlier upload may have committed before the response was lost. Verify
      // the immutable existing object rather than overwriting it or trusting a 409.
      const existing = await bucket.download(path)
      if (existing.error || !existing.data || await contentHash(existing.data) !== asset.hash) failure(error)
    },
    async download(owner, hash) {
      const bucket = (await authorized(owner)).scoped.storage.from('occlude-images')
      const { data, error } = await bucket.download(`${owner}/${hash}`)
      if (error || !data) throw new CloudError('Das Bild konnte nicht geladen werden. Bitte Verbindung und private Storage-Regeln prüfen.')
      if (data.size > 15 * 1024 * 1024 || await contentHash(data) !== hash) throw new CloudError('Die Cloud-Bilddatei hat eine ungültige Prüfsumme oder Größe.')
      return data
    },
  }
}
