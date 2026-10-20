import type { OccludeDB } from '../db'

export type OperationKind = 'deck.put' | 'deck.delete' | 'image.put' | 'image.delete' | 'basic.put' | 'basic.delete' | 'review.add' | 'settings.put'
export interface WireOperation {
  id: string; deviceId: string; kind: OperationKind; entityId: string
  baseVersion: number; payload: Record<string, unknown>
}
export interface OutboxOperation extends WireOperation {
  createdAt: number; attempts: number; nextAttemptAt: number
  state: 'pending' | 'conflict'; error?: string
}
export interface Connection { userId: string; email: string; locked: boolean }
export interface SyncMeta { key: string; value: unknown }
export interface SyncStatus { lastSuccess?: number; error?: string; running?: boolean }
export const versionKey = (kind: OperationKind, id: string) => `version:${kind.split('.')[0]}:${id}`

// Called inside the SAME write transaction as the local mutation.
export async function enqueue(database: OccludeDB, kind: OperationKind, entityId: string, payload: Record<string, unknown>) {
  const connection = (await database.syncMeta.get('connection'))?.value as Connection | undefined
  if (!connection) return
  if (connection.locked) throw new Error('Bitte zuerst wieder anmelden.')
  const key = versionKey(kind, entityId)
  const baseVersion = ((await database.syncMeta.get(key))?.value as number | undefined) ?? 0
  let deviceId = (await database.syncMeta.get('device'))?.value as string | undefined
  if (!deviceId) { deviceId = crypto.randomUUID(); await database.syncMeta.put({ key: 'device', value: deviceId }) }
  const previousSequence = ((await database.syncMeta.get('sequence'))?.value as number | undefined) ?? 0
  const createdAt = Math.max(Date.now(), previousSequence + 1)
  await database.syncMeta.put({ key: 'sequence', value: createdAt })
  await database.outbox.add({ id: crypto.randomUUID(), deviceId, kind, entityId, baseVersion, payload, createdAt, attempts: 0, nextAttemptAt: 0, state: 'pending' })
  if (kind !== 'review.add') await database.syncMeta.put({ key, value: baseVersion + 1 })
}

export async function enqueueImage(database: OccludeDB, imageId: string) {
  if (!(await database.syncMeta.get('connection'))) return
  const image = await database.images.get(imageId)
  if (!image) return
  const asset = await database.assets.get(image.assetHash)
  const metadata = asset ?? image
  if (!metadata.width || !metadata.height || !metadata.mimeType) throw new Error('Die Bilddaten fehlen; die Änderung wurde nicht gespeichert.')
  const regions = await database.regions.where('imageId').equals(imageId).toArray()
  const cards = await database.cards.where('imageId').equals(imageId).toArray()
  await enqueue(database, 'image.put', imageId, {
    ...image, width: metadata.width, height: metadata.height, mimeType: metadata.mimeType,
    regions, cards: cards.map(({ schedule: _schedule, ...card }) => card),
  })
}
