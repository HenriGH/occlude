import { db } from '../db'
import { configuration, supabase } from './client'
import { SyncEngine } from './engine'
import { supabaseTransport } from './transport'

export const cloudEngine = supabase && configuration ? new SyncEngine(db, supabaseTransport(supabase, configuration)) : null
export async function ensureImageAsset(imageId: string) {
  const image = await db.images.get(imageId)
  const cached = image ? await db.assets.get(image.assetHash) : undefined
  if (cached) return cached
  if (!cloudEngine) throw new Error('Das Bild fehlt auf diesem Gerät; keine Cloud-Verbindung konfiguriert.')
  return cloudEngine.asset(imageId)
}
