import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Rating } from 'ts-fsrs'
import { deleteDeck, initialize, moveImage, OccludeDB, rateCard, removeImage, saveDeck, saveImage } from './db'
import type { Asset, Rect } from './domain'

let database: OccludeDB
let deck: string
const asset: Asset = { hash: 'test-hash', blob: new Blob(['image'], { type: 'image/webp' }), width: 1000, height: 600, mimeType: 'image/webp' }
const rect = (id: string): Rect => ({ id, x: .1, y: .2, width: .2, height: .1 })
beforeEach(async () => { database = new OccludeDB(`test-${crypto.randomUUID()}`); await initialize(database); deck = (await database.decks.toArray())[0].id })
afterEach(async () => { await database.delete() })

describe('transactional screenshot-to-card workflow', () => {
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
