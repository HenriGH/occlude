import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Rating } from 'ts-fsrs'
import { deleteDeck, initialize, moveImage, OccludeDB, rateCard, refreshReviewQueue, removeImage, saveDeck, saveImage } from './db'
import type { Asset, Rect } from './domain'

let database: OccludeDB
let deck: string
const asset: Asset = { hash: 'test-hash', blob: new Blob(['image'], { type: 'image/webp' }), width: 1000, height: 600, mimeType: 'image/webp' }
const rect = (id: string): Rect => ({ id, x: .1, y: .2, width: .2, height: .1 })
beforeEach(async () => { database = new OccludeDB(`test-${crypto.randomUUID()}`); await initialize(database); deck = (await database.decks.toArray())[0].id })
afterEach(async () => { await database.delete() })

it('seeds exactly one workspace when two instances initialize for the first time', async () => {
  await database.delete()
  database = new OccludeDB(database.name)
  const other = new OccludeDB(database.name)
  try {
    await Promise.all([initialize(database), initialize(other)])
    const decks = await database.decks.toArray()
    expect(decks).toHaveLength(1)
    expect((await other.preferences.get('app'))?.selectedDeckId).toBe(decks[0].id)
  } finally { other.close() }
})

describe('transactional screenshot-to-card workflow', () => {
  it('persists label-only edits and removals without replacing cards or their review history', async () => {
    const imageId = await saveImage(asset, deck, [rect('a')], undefined, database)
    const card = (await database.cards.toArray())[0]
    await rateCard(card.id, Rating.Good, Date.now(), 'review', database)
    const before = await database.cards.get(card.id)
    await database.syncMeta.put({ key: 'connection', value: { userId: 'owner', email: 'test@example.test', locked: false } })
    await saveImage(asset, deck, [{ ...rect('a'), label: '  Welche Struktur?  ' }], imageId, database)
    expect((await database.regions.get('a'))?.label).toBe('Welche Struktur?')
    expect(await database.cards.get(card.id)).toEqual(before)
    expect(await database.reviews.count()).toBe(1)
    expect((await database.outbox.toArray())[0].payload.regions).toEqual([expect.objectContaining({ label: 'Welche Struktur?' })])
    await saveImage(asset, deck, [{ ...rect('a'), label: 'Welche Struktur?' }], imageId, database)
    expect(await database.outbox.count()).toBe(1)
    await saveImage(asset, deck, [{ ...rect('a'), label: '' }], imageId, database)
    database.close(); await database.open()
    expect((await database.regions.get('a'))?.label).toBe('')
    expect(await database.outbox.count()).toBe(2)
    expect(await database.cards.get(card.id)).toEqual(before)
  })
  it('rejects invalid label data before making any local changes', async () => {
    for (const label of ['x'.repeat(201), null, 123]) {
      await expect(saveImage(asset, deck, [{ ...rect('a'), label: label as string }], undefined, database)).rejects.toThrow('Maskenfrage')
    }
    expect(await database.images.count()).toBe(0)
    expect(await database.cards.count()).toBe(0)
  })
  it('creates exactly three independent cards with one underlying image and one Blob', async () => {
    const id = await saveImage(asset, deck, ['a', 'b', 'c'].map(rect), undefined, database)
    expect(await database.images.count()).toBe(1)
    expect(await database.assets.count()).toBe(1)
    expect(await database.regions.count()).toBe(3)
    const cards = await database.cards.toArray()
    expect(cards).toHaveLength(3)
    expect(new Set(cards.map(c => c.id)).size).toBe(3)
    await rateCard(cards[0].id, Rating.Good, Date.now(), 'event', database)
    expect((await database.cards.get(cards[0].id))?.schedule.reps).toBe(1)
    expect((await database.cards.get(cards[1].id))?.schedule.reps).toBe(0)
    expect(cards.every(c => c.imageId === id)).toBe(true)
  })
  it('deduplicates repeated image content without overwriting prior masks', async () => {
    await saveImage(asset, deck, [rect('a')], undefined, database)
    await saveImage(asset, deck, [rect('b')], undefined, database)
    expect(await database.images.count()).toBe(1)
    expect(await database.assets.count()).toBe(1)
    expect(await database.cards.count()).toBe(2)
  })
  it('preserves a changed mask history and removes only the deleted target', async () => {
    const imageId = await saveImage(asset, deck, ['a', 'b'].map(rect), undefined, database)
    const first = await database.cards.where('regionId').equals('a').first()
    await rateCard(first!.id, Rating.Good, Date.now(), 'review', database)
    const scheduled = (await database.cards.get(first!.id))!.schedule
    await saveImage(asset, deck, [{ ...rect('a'), x: .5 }, rect('c')], imageId, database)
    expect((await database.cards.get(first!.id))!.schedule).toEqual(scheduled)
    expect(await database.reviews.count()).toBe(1)
    expect(await database.cards.where('regionId').equals('b').count()).toBe(0)
    expect(await database.cards.count()).toBe(2)
  })
  it('rolls back all changes if a region belongs to a different image', async () => {
    await saveImage(asset, deck, [rect('occupied')], undefined, database)
    await expect(saveImage({ ...asset, hash: 'different' }, deck, [rect('fresh'), rect('occupied')], undefined, database)).rejects.toThrow('anderen Bild')
    expect(await database.images.count()).toBe(1)
    expect(await database.cards.count()).toBe(1)
    expect(await database.regions.get('fresh')).toBeUndefined()
    expect(await database.assets.count()).toBe(1)
  })
  it('makes review retries idempotent and persists history after reopening', async () => {
    await saveImage(asset, deck, [rect('a')], undefined, database)
    const card = (await database.cards.toArray())[0], at = Date.now()
    await Promise.all([rateCard(card.id, Rating.Easy, at, 'same-event', database), rateCard(card.id, Rating.Easy, at, 'same-event', database)])
    expect(await database.reviews.count()).toBe(1)
    expect((await database.cards.get(card.id))!.schedule.reps).toBe(1)
    database.close(); await database.open()
    expect(await database.reviews.count()).toBe(1)
    expect((await database.cards.get(card.id))!.schedule.due).toBeInstanceOf(Date)
  })
  it('rejects malformed masks and nonexistent decks without partial writes', async () => {
    await expect(saveImage(asset, deck, [{ ...rect('a'), x: 2 }], undefined, database)).rejects.toThrow()
    await expect(saveImage(asset, 'missing', [rect('a')], undefined, database)).rejects.toThrow()
    expect(await database.cards.count()).toBe(0)
  })
})

describe('hierarchy, movement and garbage collection', () => {
  it('rejects a hierarchy cycle in the transaction', async () => {
    const child = await saveDeck('Unterordner', deck, undefined, database)
    await expect(saveDeck('Studium', child, deck, database)).rejects.toThrow()
    expect((await database.decks.get(deck))!.parentId).toBeNull()
  })
  it('moves cards with their image without resetting learning progress', async () => {
    const target = await saveDeck('Ziel', null, undefined, database)
    const image = await saveImage(asset, deck, [rect('a')], undefined, database)
    const card = (await database.cards.toArray())[0]
    await rateCard(card.id, Rating.Good, Date.now(), 'event', database)
    await moveImage(image, target, database)
    expect((await database.images.get(image))!.deckId).toBe(target)
    expect((await database.cards.get(card.id))!.schedule.reps).toBe(1)
  })
  it('rejects moving duplicate content without losing either image or its cards', async () => {
    const target = await saveDeck('Ziel', null, undefined, database)
    const image = await saveImage(asset, deck, [rect('a')], undefined, database)
    await saveImage(asset, target, [rect('b')], undefined, database)
    await expect(moveImage(image, target, database)).rejects.toThrow('bereits im Zielordner')
    expect((await database.images.get(image))!.deckId).toBe(deck)
    expect(await database.cards.count()).toBe(2)
    expect(await database.assets.count()).toBe(1)
  })
  it('retains shared Blobs until the last image is deleted and cascades descendants', async () => {
    const child = await saveDeck('Kind', deck, undefined, database)
    const unrelated = await saveDeck('Anderes', null, undefined, database)
    await saveImage(asset, child, [rect('a')], undefined, database)
    const otherImage = await saveImage(asset, unrelated, [rect('b')], undefined, database)
    const card = (await database.cards.where('regionId').equals('a').first())!
    await rateCard(card.id, Rating.Good, Date.now(), 'event', database)
    await deleteDeck(deck, database)
    expect(await database.decks.count()).toBe(1)
    expect(await database.reviews.count()).toBe(0)
    expect(await database.cards.count()).toBe(1)
    expect(await database.assets.count()).toBe(1)
    await removeImage(otherImage, database)
    expect(await database.assets.count()).toBe(0)
  })
})


describe('live local review queue', () => {
  it('appends a newly due repeat behind pending cards without duplicating them', async () => {
    await saveImage(asset, deck, ['a', 'b', 'c'].map(rect), undefined, database)
    const cards = await database.cards.toArray()
    const [first, second, third] = cards
    const at = Date.now()
    await rateCard(first.id, Rating.Again, at, 'first-attempt', database)
    const due = +(await database.cards.get(first.id))!.schedule.due
    const pending = [third.id, second.id]
    expect(await refreshReviewQueue(pending, deck, new Set(), new Date(due - 1), database)).toEqual(pending)
    expect(await refreshReviewQueue(pending, deck, new Set(), new Date(due), database)).toEqual([...pending, first.id])
    await rateCard(third.id, Rating.Good, due, 'third-attempt', database)
    expect(await refreshReviewQueue([second.id, first.id], deck, new Set(), new Date(due), database)).toEqual([second.id, first.id])
  })
  it('keeps the selected subtree and excludes removed or moved pending cards', async () => {
    const child = await saveDeck('Kind', deck, undefined, database)
    const other = await saveDeck('Anderes', null, undefined, database)
    const image = await saveImage(asset, deck, [rect('a')], undefined, database)
    await saveImage({ ...asset, hash: 'child' }, child, [rect('b')], undefined, database)
    await saveImage({ ...asset, hash: 'other' }, other, [rect('c')], undefined, database)
    const cards = await database.cards.toArray()
    const first = cards.find(c => c.regionId === 'a')!, nested = cards.find(c => c.regionId === 'b')!
    expect(await refreshReviewQueue([nested.id, first.id], deck, new Set(), new Date(), database)).toEqual([nested.id, first.id])
    await moveImage(image, other, database)
    expect(await refreshReviewQueue([nested.id, first.id, 'deleted'], deck, new Set(), new Date(), database)).toEqual([nested.id])
    expect(await refreshReviewQueue([], null, new Set(), new Date(), database)).toHaveLength(3)
  })
  it('continues to enforce the daily new-card limit as cards are introduced', async () => {
    await saveImage(asset, deck, ['a', 'b', 'c'].map(rect), undefined, database)
    await database.preferences.update('app', { newLimit: 2 })
    const initial = await refreshReviewQueue([], deck, new Set(), new Date(), database)
    expect(initial).toHaveLength(2)
    await rateCard(initial[0], Rating.Good, Date.now(), 'introduction', database)
    expect(await refreshReviewQueue(initial.slice(1), deck, new Set(), new Date(), database)).toEqual(initial.slice(1))
    await database.preferences.update('app', { newLimit: 3 })
    const expanded = await refreshReviewQueue(initial.slice(1), deck, new Set(), new Date(), database)
    expect(expanded).toHaveLength(2)
    expect(expanded[0]).toBe(initial[1])
    expect(expanded).not.toContain(initial[0])
  })
  it('does not reinsert skipped unavailable cards and completes when nothing is due', async () => {
    await saveImage(asset, deck, [rect('a'), rect('b')], undefined, database)
    const [first, second] = await database.cards.toArray()
    expect(await refreshReviewQueue([], deck, new Set([first.id]), new Date(), database)).toEqual([second.id])
    await rateCard(second.id, Rating.Good, Date.now(), 'good', database)
    expect(await refreshReviewQueue([], deck, new Set([first.id]), new Date(), database)).toEqual([])
  })
})


describe('daily streak feedback', () => {
  it('celebrates only the first committed rating per day across concurrent callers and retries', async () => {
    await saveImage(asset, deck, [rect('a'), rect('b')], undefined, database)
    const [a, b] = await database.cards.toArray()
    const at = Date.now()
    const results = await Promise.all([
      rateCard(a.id, Rating.Again, at, 'first', database),
      rateCard(b.id, Rating.Hard, at, 'second', database),
    ])
    expect(results.filter(Boolean)).toEqual([{ count: 1, active: true }])
    expect(await rateCard(a.id, Rating.Again, at, 'first', database)).toBeUndefined()
    expect(await database.reviews.count()).toBe(2)
  })
})
