import { createEmptyCard } from 'ts-fsrs'
import { descendants, replay, SCHEDULER_VERSION, validRect, type Deck, type Flashcard, type ImageRecord, type Preferences, type Region, type ReviewEvent } from '../domain'
import type { OccludeDB } from '../db'
import { versionKey } from './model'

interface Versioned<T> { data: T; version: number; deleted: boolean }
export interface Snapshot {
  decks: Versioned<Deck>[]; images: Versioned<ImageRecord>[]; regions: Versioned<Region>[]
  cards: Versioned<Omit<Flashcard, 'schedule'>>[]; reviews: ReviewEvent[]
  profile: { version: number; settings: Pick<Preferences, 'newLimit' | 'dayBoundary'> } | null
}
const fail = (): never => { throw new Error('Ungültige Cloud-Daten. Der lokale Speicher wurde nicht ersetzt.') }
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(); return v as Record<string, unknown> }
function str(v: unknown): string { if (typeof v !== 'string' || !v) return fail(); return v }
function num(v: unknown): number { if (typeof v !== 'number' || !Number.isFinite(v)) return fail(); return v }
function integer(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) { const n = num(v); if (!Number.isInteger(n) || n < min || n > max) return fail(); return n }
function timestamp(v: unknown) { const t = Date.parse(str(v)); return Number.isFinite(t) ? t : fail() }
function uuid(v: unknown) { const s = str(v); return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s) ? s : fail() }

export function parseSnapshot(input: unknown, owner: string): Snapshot {
  const root = object(input)
  if (root.schemaVersion !== 1) throw new Error('Nicht unterstützte Cloud-Version. Bitte die App aktualisieren.')
  const rows = (key: string) => {
    if (!Array.isArray(root[key])) return fail()
    const seen = new Set<string>()
    return root[key].map(raw => {
      const r = object(raw)
      if (r.user_id !== owner) return fail()
      const id = uuid(r.id)
      if (seen.has(id)) return fail(); seen.add(id)
      return r
    })
  }
  const wrap = <T>(r: Record<string, unknown>, data: T): Versioned<T> => ({ data, version: integer(r.version, 1), deleted: r.deleted_at !== null && timestamp(r.deleted_at) >= 0 })
  const decks = rows('decks').map(r => {
    const name = str(r.name); if (name.length > 120) return fail()
    return wrap(r, { id: uuid(r.id), name, parentId: r.parent_id === null ? null : uuid(r.parent_id), createdAt: timestamp(r.created_at), updatedAt: timestamp(r.updated_at) })
  })
  for (const d of decks) if (d.data.parentId && (d.data.parentId === d.data.id || descendants(decks.map(d => d.data), d.data.id).has(d.data.parentId))) return fail()
  const images = rows('images').map(r => {
    const hash = str(r.content_hash), mimeType = str(r.mime_type), width = integer(r.width, 1, 12000), height = integer(r.height, 1, 12000)
    if (!/^[a-f0-9]{64}$/.test(hash) || width * height > 20_000_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || r.storage_path !== `${owner}/${hash}`) return fail()
    return wrap(r, { id: uuid(r.id), deckId: uuid(r.deck_id), assetHash: hash, width, height, mimeType, createdAt: timestamp(r.created_at), updatedAt: timestamp(r.updated_at) })
  })
  const regions = rows('regions').map(r => {
    const region = { id: uuid(r.id), imageId: uuid(r.image_id), x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height) }
    if (!validRect(region)) return fail()
    return wrap(r, region)
  })
  const cards = rows('cards').map(r => wrap(r, { id: uuid(r.id), imageId: uuid(r.image_id), regionId: uuid(r.region_id), createdAt: timestamp(r.created_at) }))
  const reviews = rows('reviews').map(r => {
    if (r.scheduler_version !== SCHEDULER_VERSION) throw new Error('Unbekannte Scheduler-Version in der Cloud. Bitte App aktualisieren.')
    return { id: uuid(r.id), cardId: uuid(r.card_id), rating: integer(r.rating, 1, 4) as ReviewEvent['rating'], reviewedAt: timestamp(r.reviewed_at), schedulerVersion: SCHEDULER_VERSION }
  })
  let profile: Snapshot['profile'] = null
  if (root.profile !== null) {
    const p = object(root.profile), settings = object(p.settings)
    if (p.user_id !== owner) return fail()
    profile = { version: integer(p.version), settings: { newLimit: integer(settings.newLimit, 0, 500), dayBoundary: integer(settings.dayBoundary, 0, 23) } }
  }
  if (decks.some(d => d.data.parentId && !decks.some(p => p.data.id === d.data.parentId)) ||
    images.some(i => !decks.some(d => d.data.id === i.data.deckId)) ||
    regions.some(r => !images.some(i => i.data.id === r.data.imageId)) ||
    cards.some(c => !regions.some(r => r.data.id === c.data.regionId && r.data.imageId === c.data.imageId)) ||
    reviews.some(e => !cards.some(c => c.data.id === e.cardId))) return fail()
  return { decks, images, regions, cards, reviews, profile }
}

// Caller owns a write transaction over all stores. If metadata is still pending,
// retain it verbatim; review-event union/replay is independent of metadata versions.
export async function mergeSnapshot(database: OccludeDB, snapshot: Snapshot) {
  const pending = await database.outbox.toArray()
  const pendingMetadata = pending.some(o => o.kind !== 'review.add')
  if (!pendingMetadata) {
    await database.decks.clear(); await database.images.clear(); await database.regions.clear(); await database.cards.clear()
    await database.decks.bulkPut(snapshot.decks.filter(d => !d.deleted).map(d => d.data))
    await database.images.bulkPut(snapshot.images.filter(i => !i.deleted).map(i => i.data))
    await database.regions.bulkPut(snapshot.regions.filter(r => !r.deleted).map(r => r.data))
    await database.cards.bulkPut(snapshot.cards.filter(c => !c.deleted).map(c => ({ ...c.data, schedule: createEmptyCard(new Date(c.data.createdAt)) })))
    for (const d of snapshot.decks) await database.syncMeta.put({ key: versionKey('deck.put', d.data.id), value: d.version })
    for (const i of snapshot.images) await database.syncMeta.put({ key: versionKey('image.put', i.data.id), value: i.version })
    if (snapshot.profile) {
      await database.preferences.update('app', snapshot.profile.settings)
      await database.syncMeta.put({ key: versionKey('settings.put', 'settings'), value: snapshot.profile.version })
    }
    const prefs = await database.preferences.get('app')
    if (prefs?.selectedDeckId && !await database.decks.get(prefs.selectedDeckId)) await database.preferences.update('app', { selectedDeckId: null })
  }
  for (const remote of snapshot.reviews) {
    const existing = await database.reviews.get(remote.id)
    if (existing && (existing.cardId !== remote.cardId || existing.rating !== remote.rating || existing.reviewedAt !== remote.reviewedAt || existing.schedulerVersion !== remote.schedulerVersion)) throw new Error('Widersprüchliche Ereignis-ID in der Cloud. Keine Daten wurden verworfen.')
    await database.reviews.put(remote)
  }
  for (const card of await database.cards.toArray()) {
    const events = await database.reviews.where('cardId').equals(card.id).toArray()
    await database.cards.update(card.id, { schedule: replay(card.createdAt, events) })
  }
}
