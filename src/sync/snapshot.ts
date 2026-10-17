import { createEmptyCard } from 'ts-fsrs'
import { descendants, MAX_MASK_LABEL_LENGTH, replay, SCHEDULER_VERSION, validRect, type Deck, type Flashcard, type ImageRecord, type Preferences, type Region, type ReviewEvent } from '../domain'
import type { OccludeDB } from '../db'
import { versionKey } from './model'

interface Versioned<T> { data: T; version: number; deleted: boolean }
export interface Snapshot {
  regionLabels: boolean
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
    if (r.label !== undefined && (typeof r.label !== 'string' || r.label.length > MAX_MASK_LABEL_LENGTH)) return fail()
    const region = { id: uuid(r.id), imageId: uuid(r.image_id), x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height), ...(r.label === undefined ? {} : { label: r.label as string }) }
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
  return { decks, images, regions, cards, reviews, profile, regionLabels: Array.isArray(root.features) && root.features.includes('region-labels') }
}

// Caller owns a write transaction over metadata, reviews, outbox and syncMeta.
// Preserve local schedules and write only actual differences. An unchanged pull
// must not rebuild the library, replay every review, or invalidate all UI queries.
export async function mergeSnapshot(database: OccludeDB, snapshot: Snapshot) {
  const [pending, decks, images, regions, cards, reviews, prefs, meta] = await Promise.all([
    database.outbox.toArray(), database.decks.toArray(), database.images.toArray(),
    database.regions.toArray(), database.cards.toArray(), database.reviews.toArray(),
    database.preferences.get('app'), database.syncMeta.toArray(),
  ])
  const pendingMetadata = pending.some(o => o.kind !== 'review.add')
  const versions = new Map(meta.map(m => [m.key, m.value]))
  const nextMeta = new Map<string, unknown>()
  const remember = (key: string, value: unknown) => { if (versions.get(key) !== value) nextMeta.set(key, value) }
  remember('regionLabels', snapshot.regionLabels)
  const connection = versions.get('connection') as { userId: string } | undefined
  if (connection) for (const image of snapshot.images) {
    // The RPC only publishes metadata after the immutable Storage object exists.
    remember(`uploaded:${connection.userId}:${image.data.assetHash}`, true)
  }
  const same = <T extends object>(a: T, b: T) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof T)[])
    return [...keys].every(key => a[key] === b[key])
  }
  const reconcile = async <T extends { id: string }>(table: { bulkDelete(keys: string[]): PromiseLike<unknown>; bulkPut(rows: T[]): PromiseLike<unknown> }, local: T[], remote: T[], unique?: (row: T) => string) => {
    const before = new Map(local.map(row => [row.id, row]))
    const after = new Set(remote.map(row => row.id))
    // Remove changed unique-index entries before putting their replacements,
    // allowing two images to swap folders without a transient index collision.
    const remove = local.filter(row => !after.has(row.id)).map(row => row.id)
    const put = remote.filter(row => !before.has(row.id) || !same(before.get(row.id)!, row))
    if (unique) for (const row of put) { const old = before.get(row.id); if (old && unique(old) !== unique(row)) remove.push(row.id) }
    if (remove.length) await table.bulkDelete(remove)
    if (put.length) await table.bulkPut(put)
  }
  let nextCards = new Map(cards.map(card => [card.id, card]))
  const changedCards = new Set<string>()
  if (!pendingMetadata) {
    await reconcile<Deck>(database.decks, decks, snapshot.decks.filter(d => !d.deleted).map(d => d.data))
    await reconcile<ImageRecord>(database.images, images, snapshot.images.filter(i => !i.deleted).map(i => i.data), i => `${i.deckId}:${i.assetHash}`)
    await reconcile<Region>(database.regions, regions, snapshot.regions.filter(r => !r.deleted).map(r => r.data))
    nextCards = new Map(snapshot.cards.filter(c => !c.deleted).map(({ data }) => {
      const prior = nextCards.get(data.id)
      const { schedule: _schedule, ...priorData } = prior ?? {} as Flashcard
      if (prior && same(priorData, data)) return [data.id, prior]
      changedCards.add(data.id)
      return [data.id, { ...data, schedule: createEmptyCard(new Date(data.createdAt)) }]
    }))
    for (const d of snapshot.decks) remember(versionKey('deck.put', d.data.id), d.version)
    for (const i of snapshot.images) remember(versionKey('image.put', i.data.id), i.version)
    if (snapshot.profile) {
      if (prefs?.newLimit !== snapshot.profile.settings.newLimit || prefs?.dayBoundary !== snapshot.profile.settings.dayBoundary) await database.preferences.update('app', snapshot.profile.settings)
      remember(versionKey('settings.put', 'settings'), snapshot.profile.version)
    }
    if (prefs?.selectedDeckId && !snapshot.decks.some(d => !d.deleted && d.data.id === prefs.selectedDeckId)) await database.preferences.update('app', { selectedDeckId: null })
  }
  const events = new Map(reviews.map(event => [event.id, event]))
  const newEvents: ReviewEvent[] = []
  for (const remote of snapshot.reviews) {
    const existing = events.get(remote.id)
    if (existing && !same(existing, remote)) throw new Error('Widersprüchliche Ereignis-ID in der Cloud. Keine Daten wurden verworfen.')
    if (!existing) { events.set(remote.id, remote); newEvents.push(remote); changedCards.add(remote.cardId) }
  }
  if (newEvents.length) await database.reviews.bulkPut(newEvents)
  const history = new Map<string, ReviewEvent[]>()
  for (const event of events.values()) if (changedCards.has(event.cardId)) {
    const group = history.get(event.cardId) ?? []
    group.push(event); history.set(event.cardId, group)
  }
  for (const id of changedCards) {
    const card = nextCards.get(id)
    if (card) nextCards.set(id, { ...card, schedule: replay(card.createdAt, history.get(id) ?? []) })
  }
  // Reuse schedule objects for untouched cards; their Date fields and history
  // are already materialized locally and need no database writes.
  const removed = cards.filter(card => !nextCards.has(card.id)).map(card => card.id)
  const put = [...nextCards.values()].filter(card => changedCards.has(card.id))
  if (removed.length) await database.cards.bulkDelete(removed)
  if (put.length) await database.cards.bulkPut(put)
  if (nextMeta.size) await database.syncMeta.bulkPut([...nextMeta].map(([key, value]) => ({ key, value })))
}
