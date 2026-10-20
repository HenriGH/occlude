import Dexie, { type EntityTable } from 'dexie'
import { createEmptyCard } from 'ts-fsrs'
import { dailyStreak, descendants, MAX_MASK_LABEL_LENGTH, replay, reviewDay, reviewQueue, SCHEDULER_VERSION, validBasicText, validRect, validateParent, type Asset, type BasicCard, type Deck, type Flashcard, type Grade, type ImageRecord, type Preferences, type Rect, type Region, type ReviewEvent } from './domain'
import { enqueue, enqueueImage, type OutboxOperation, type SyncMeta } from './sync/model'
import { setStorageBlocked } from './storageLifecycle'

export class OccludeDB extends Dexie {
  decks!: EntityTable<Deck, 'id'>
  assets!: EntityTable<Asset, 'hash'>
  images!: EntityTable<ImageRecord, 'id'>
  regions!: EntityTable<Region, 'id'>
  cards!: EntityTable<Flashcard, 'id'>
  reviews!: EntityTable<ReviewEvent, 'id'>
  preferences!: EntityTable<Preferences, 'id'>
  outbox!: EntityTable<OutboxOperation, 'id'>
  syncMeta!: EntityTable<SyncMeta, 'key'>
  constructor(name = 'occlude') {
    super(name)
    this.version(1).stores({
      decks: 'id, parentId', assets: 'hash', images: 'id, deckId, assetHash, &[deckId+assetHash]',
      regions: 'id, imageId', cards: 'id, &regionId, imageId', reviews: 'id, cardId, reviewedAt', preferences: 'id',
    })
    this.version(2).stores({ outbox: 'id, createdAt, state, entityId', syncMeta: 'key' })
    this.version(3).stores({ cards: 'id, &regionId, imageId, deckId' })
  }
}
export const db = new OccludeDB()
db.on('blocked', () => setStorageBlocked(true))
db.on('ready', () => { setStorageBlocked(false) }, true)
const uid = (): string => crypto.randomUUID()
export const defaultPreferences: Preferences = { id: 'app', selectedDeckId: null, newLimit: 20, dayBoundary: 4, theme: 'dark' }

export async function initialize(database = db) {
  // Existing workspaces need no startup write lock shared with other instances.
  if (await database.preferences.get('app')) return
  await database.transaction('rw', [database.decks, database.preferences], async () => {
    // Two first launches may reach this transaction concurrently.
    if (await database.preferences.get('app')) return
    const id = uid(), now = Date.now()
    await database.decks.add({ id, parentId: null, name: 'Mein Studium', createdAt: now, updatedAt: now })
    await database.preferences.add({ ...defaultPreferences, selectedDeckId: id })
  })
}

export async function saveDeck(name: string, parentId: string | null, id = uid(), database = db) {
  if (!name.trim() || name.trim().length > 120) throw new Error('Bitte einen Namen mit 1 bis 120 Zeichen eingeben.')
  await database.transaction('rw', database.tables, async () => {
    validateParent(await database.decks.toArray(), id, parentId)
    const previous = await database.decks.get(id)
    const now = Date.now()
    await database.decks.put({ id, name: name.trim(), parentId, createdAt: previous?.createdAt ?? now, updatedAt: now })
    await enqueue(database, 'deck.put', id, (await database.decks.get(id))! as unknown as Record<string, unknown>)
  })
  return id
}

export async function saveImage(asset: Asset, deckId: string, rects: Rect[], existingImageId?: string, database = db) {
  if (!rects.length || rects.length > 500 || rects.some(r => !validRect(r)) || new Set(rects.map(r => r.id)).size !== rects.length)
    throw new Error('Bitte mindestens eine gültige Maske zeichnen.')
  if (rects.some(r => r.label !== undefined && (typeof r.label !== 'string' || r.label.length > MAX_MASK_LABEL_LENGTH)))
    throw new Error(`Eine Maskenfrage darf höchstens ${MAX_MASK_LABEL_LENGTH} Zeichen enthalten.`)
  rects = rects.map(r => r.label === undefined ? r : { ...r, label: r.label.trim() })
  return database.transaction('rw', database.tables, async () => {
    if (!await database.decks.get(deckId)) throw new Error('Der gewählte Ordner existiert nicht mehr.')
    const duplicate = await database.images.where('[deckId+assetHash]').equals([deckId, asset.hash]).first()
    if (existingImageId && duplicate && duplicate.id !== existingImageId) throw new Error('Dieses Bild ist bereits im Zielordner. Bitte dort bearbeiten.')
    const image = existingImageId ? await database.images.get(existingImageId) : duplicate
    if (existingImageId && !image) throw new Error('Das Bild wurde inzwischen gelöscht.')
    if (image && image.assetHash !== asset.hash) throw new Error('Das Originalbild einer Karte darf nicht ersetzt werden.')
    const imageId = image?.id ?? uid(), now = Date.now()
    const oldRegions = await database.regions.where('imageId').equals(imageId).toArray()
    // Re-pasting the same image adds masks instead of replacing existing targets.
    const next = image && !existingImageId ? [...oldRegions, ...rects] : rects
    if (next.length > 500) throw new Error('Pro Bild sind maximal 500 Masken möglich.')
    // Opening and saving an unchanged card is a local no-op. In particular, do
    // not clone its potentially large original Blob or queue another upload.
    if (existingImageId && image?.deckId === deckId && next.length === oldRegions.length && next.every(r => oldRegions.some(old => old.id === r.id && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height && (old.label ?? '') === (r.label ?? '')))) return imageId
    if (!await database.assets.where('hash').equals(asset.hash).count()) await database.assets.put(asset)
    await database.images.put({ id: imageId, deckId, assetHash: asset.hash, createdAt: image?.createdAt ?? now, updatedAt: now, width: asset.width, height: asset.height, mimeType: asset.mimeType })
    const oldCards = await database.cards.where('imageId').equals(imageId).toArray()
    for (const old of oldRegions) if (!next.some(r => r.id === old.id)) {
      const card = oldCards.find(c => c.regionId === old.id)
      if (card) { if (!(await database.syncMeta.get('connection'))) await database.reviews.where('cardId').equals(card.id).delete(); await database.cards.delete(card.id) }
      await database.regions.delete(old.id)
    }
    for (const rect of next) {
      const elsewhere = await database.regions.get(rect.id)
      if (elsewhere && elsewhere.imageId !== imageId) throw new Error('Die Maske gehört zu einem anderen Bild.')
      await database.regions.put({ ...rect, imageId })
      if (!oldCards.some(c => c.regionId === rect.id)) await database.cards.add({ id: uid(), regionId: rect.id, imageId, createdAt: now, schedule: createEmptyCard(new Date(now)) })
    }
    await enqueueImage(database, imageId)
    return imageId
  })
}

export async function saveBasicCard(deckId: string, front: string, back: string, id = uid(), database = db) {
  if (!validBasicText(front) || !validBasicText(back)) throw new Error('Frage und Antwort müssen jeweils 1 bis 10.000 Zeichen enthalten.')
  return database.transaction('rw', database.tables, async () => {
    if (!await database.decks.get(deckId)) throw new Error('Der gewählte Ordner existiert nicht mehr.')
    const previous = await database.cards.get(id)
    if (previous && previous.kind !== 'basic') throw new Error('Dieser Kartentyp kann nicht ersetzt werden.')
    front = front.trim(); back = back.trim()
    if (previous?.deckId === deckId && previous.front === front && previous.back === back) return id
    const now = Date.now()
    const card: BasicCard = { id, kind: 'basic', deckId, front, back, createdAt: previous?.createdAt ?? now, updatedAt: now, schedule: previous?.schedule ?? createEmptyCard(new Date(now)) }
    await database.cards.put(card)
    const { schedule: _schedule, ...metadata } = card
    await enqueue(database, 'basic.put', id, metadata)
    return id
  })
}

export async function removeBasicCard(id: string, database = db, queueOperation = true) {
  await database.transaction('rw', database.tables, async () => {
    const card = await database.cards.get(id)
    if (!card || card.kind !== 'basic') return
    if (queueOperation) await enqueue(database, 'basic.delete', id, { id })
    if (!(await database.syncMeta.get('connection'))) await database.reviews.where('cardId').equals(id).delete()
    await database.cards.delete(id)
  })
}

export async function rateCard(cardId: string, rating: Grade, at = Date.now(), eventId = uid(), database = db) {
  if (![1, 2, 3, 4].includes(rating) || !Number.isFinite(at)) throw new Error('Ungültige Bewertung.')
  return database.transaction('rw', database.tables, async () => {
    const existing = await database.reviews.get(eventId)
    if (existing) {
      if (existing.cardId !== cardId || existing.rating !== rating || existing.reviewedAt !== at) throw new Error('Widersprüchliche Wiederholung der Bewertung.')
      return
    }
    const card = await database.cards.get(cardId)
    if (!card) throw new Error('Diese Karte existiert nicht mehr.')
    const { start, end } = reviewDay(new Date(at), 0)
    const firstToday = await database.reviews.where('reviewedAt').between(start, end, true, false).count() === 0
    const event: ReviewEvent = { id: eventId, cardId, rating, reviewedAt: at, schedulerVersion: SCHEDULER_VERSION }
    await database.reviews.add(event)
    const events = await database.reviews.where('cardId').equals(cardId).toArray()
    await database.cards.update(cardId, { schedule: replay(card.createdAt, events) })
    await enqueue(database, 'review.add', event.id, event as unknown as Record<string, unknown>)
    // The indexed day check shares the rating transaction across tabs. Only the
    // first daily review reads the full history for immediate, offline feedback.
    if (firstToday) return dailyStreak(await database.reviews.toArray(), new Date(at))
  })
}

// Refresh only from IndexedDB. Keep pending order and append newly due cards,
// including earlier attempts in this round, without duplicating pending IDs.
export async function refreshReviewQueue(pending: string[], root: string | null, skipped: ReadonlySet<string>, now = new Date(), database = db) {
  return database.transaction('r', [database.cards, database.images, database.decks, database.reviews, database.preferences], async () => {
    const [cards, images, decks, events, preferences] = await Promise.all([
      database.cards.toArray(), database.images.toArray(), database.decks.toArray(),
      database.reviews.toArray(), database.preferences.get('app'),
    ])
    const eligible = reviewQueue(cards, images, decks, events, preferences ?? defaultPreferences, root, now).queue.map(card => card.id)
    const available = new Set(eligible)
    return [...new Set([...pending.filter(id => available.has(id)), ...eligible])].filter(id => !skipped.has(id))
  })
}

export async function deleteDeck(id: string, database = db) {
  await database.transaction('rw', database.tables, async () => {
    const ids = descendants(await database.decks.toArray(), id)
    await enqueue(database, 'deck.delete', id, {})
    const images = (await database.images.toArray()).filter(i => ids.has(i.deckId))
    for (const image of images) await removeImage(image.id, database, false)
    for (const card of await database.cards.where('deckId').anyOf([...ids]).toArray()) await removeBasicCard(card.id, database, false)
    await database.decks.bulkDelete([...ids])
    const prefs = await database.preferences.get('app')
    if (prefs?.selectedDeckId && ids.has(prefs.selectedDeckId)) await database.preferences.update('app', { selectedDeckId: null })
  })
}

export async function removeImage(id: string, database = db, queueOperation = true) {
  await database.transaction('rw', database.tables, async () => {
    const image = await database.images.get(id)
    if (!image) return
    const cards = await database.cards.where('imageId').equals(id).toArray()
    if (queueOperation) await enqueue(database, 'image.delete', id, {})
    if (!(await database.syncMeta.get('connection'))) for (const card of cards) await database.reviews.where('cardId').equals(card.id).delete()
    await database.cards.bulkDelete(cards.map(c => c.id))
    await database.regions.where('imageId').equals(id).delete()
    await database.images.delete(id)
    // Retain Blobs while connected: an earlier unacknowledged creation may still need upload.
    if (!(await database.syncMeta.get('connection')) && await database.images.where('assetHash').equals(image.assetHash).count() === 0) await database.assets.delete(image.assetHash)
  })
}

export async function moveImage(id: string, deckId: string, database = db) {
  await database.transaction('rw', database.tables, async () => {
    if (!await database.decks.get(deckId)) throw new Error('Der Zielordner existiert nicht.')
    const image = await database.images.get(id)
    if (!image) throw new Error('Das Bild existiert nicht mehr.')
    const duplicate = await database.images.where('[deckId+assetHash]').equals([deckId, image.assetHash]).first()
    if (duplicate && duplicate.id !== id) throw new Error('Dieses Bild ist bereits im Zielordner. Seine bestehenden Karten bleiben unverändert.')
    await database.images.update(id, { deckId, updatedAt: Date.now() })
    await enqueueImage(database, id)
  })
}

export async function updatePreferences(patch: Partial<Preferences>, database = db) {
  await database.transaction('rw', database.tables, async () => {
    await database.preferences.update('app', patch)
    if (patch.newLimit !== undefined || patch.dayBoundary !== undefined) {
      const prefs = (await database.preferences.get('app'))!
      await enqueue(database, 'settings.put', 'settings', { newLimit: prefs.newLimit, dayBoundary: prefs.dayBoundary })
    }
  })
}
