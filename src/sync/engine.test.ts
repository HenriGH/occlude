// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { initialize, OccludeDB, rateCard, removeImage, saveDeck, saveImage } from '../db'
import type { Asset } from '../domain'
import { sqlBackend } from '../test/sqlBackend'
import { SyncEngine, retryDelay } from './engine'
import { CloudError, contentHash, type Transport } from './transport'
import { parseSnapshot } from './snapshot'
import type { Connection, WireOperation } from './model'

let pg: PGlite, owner: string
const databases: OccludeDB[] = []
let clock = Date.parse('2026-10-17T12:00:00Z')
const blobs = new Map<string, Blob>()
class TestTransport implements Transport {
  online = true
  loseAck?: WireOperation['kind']
  interruptUpload = false
  requests: WireOperation[] = []
  constructor(readonly owner: string) {}
  private check(expected = this.owner) { if (!this.online) throw new Error('Offline'); if (expected !== this.owner) throw new Error('Account mismatch') }
  async userId() { this.check(); return this.owner }
  async query<T>(sql: string, values: unknown[] = []) {
    return pg.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [this.owner])
      await tx.exec('set local role authenticated')
      return tx.query<T>(sql, values)
    })
  }
  async snapshot(expected: string) { this.check(expected); return (await this.query<{ data: unknown }>('select public.occlude_snapshot() data')).rows[0].data }
  async apply(operation: WireOperation, expected: string) {
    this.check(expected); this.requests.push(operation)
    try { await this.query('select public.occlude_apply_operation($1::jsonb)', [JSON.stringify(operation)]) }
    catch (e) { if (e instanceof Error && e.message.includes('conflict:')) throw new CloudError(e.message, true); throw e }
    if (this.loseAck === operation.kind) { this.loseAck = undefined; throw new Error('Response lost after commit') }
  }
  async upload(expected: string, asset: Asset) {
    this.check(expected)
    if (await contentHash(asset.blob) !== asset.hash) throw new Error('Invalid checksum')
    const path = `${this.owner}/${asset.hash}`
    blobs.set(path, asset.blob)
    await this.query('insert into storage.objects(bucket_id,name) values($1,$2) on conflict do nothing', ['occlude-images', path])
    if (this.interruptUpload) { this.interruptUpload = false; throw new Error('Upload response interrupted') }
  }
  async download(expected: string, hash: string) { this.check(expected); const blob = blobs.get(`${this.owner}/${hash}`); if (!blob) throw new Error('Missing object'); return blob }
}
async function device() {
  const db = new OccludeDB(`sync-test-${crypto.randomUUID()}`)
  databases.push(db); await initialize(db)
  const transport = new TestTransport(owner)
  const engine = new SyncEngine(db, transport, () => clock, () => .5)
  return { db, transport, engine }
}
async function addImage(db: OccludeDB, count = 1) {
  const blob = new Blob(['local image bytes'], { type: 'image/webp' })
  const asset = { hash: await contentHash(blob), blob, width: 1000, height: 650, mimeType: 'image/webp' }
  const deck = (await db.decks.toArray())[0]
  return saveImage(asset, deck.id, Array.from({ length: count }, () => ({ id: crypto.randomUUID(), x: .1, y: .2, width: .3, height: .1 })), undefined, db)
}
beforeAll(async () => { pg = await sqlBackend() }, 30000)
beforeEach(async () => { owner = crypto.randomUUID(); await pg.query('insert into auth.users(id) values($1)', [owner]); clock = Date.now() })
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete() })
afterAll(async () => { await pg?.close() })

describe('local outbox + actual PostgreSQL RPC integration', () => {
  it('migrates local cards, persists parent-first ordering even at the same clock tick, and lazily caches images on device B', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(clock)
    const a = await device()
    const parent = (await a.db.decks.toArray())[0]
    await saveDeck('Unterordner', parent.id, undefined, a.db)
    await addImage(a.db, 3)
    await a.engine.connect('student@example.test')
    expect(await a.db.outbox.count()).toBe(0)
    const b = await device(); await b.engine.connect('student@example.test')
    expect(await b.db.decks.count()).toBe(2)
    expect(await b.db.images.count()).toBe(1)
    expect(await b.db.cards.count()).toBe(3)
    expect(await b.db.assets.count()).toBe(0)
    await b.engine.asset((await b.db.images.toArray())[0].id)
    expect(await b.db.assets.count()).toBe(1)
  })
  it.each(['a-first', 'b-first'])('preserves concurrent offline events and converges by canonical replay (%s)', async order => {
    const a = await device(); await addImage(a.db); await a.engine.connect('student@example.test')
    const b = await device(); await b.engine.connect('student@example.test')
    const card = (await a.db.cards.toArray())[0]
    a.transport.online = false; b.transport.online = false
    await rateCard(card.id, 3, clock + 1000, crypto.randomUUID(), a.db)
    await rateCard(card.id, 1, clock + 1000, crypto.randomUUID(), b.db)
    expect((await a.db.cards.get(card.id))!.schedule.reps).toBe(1)
    await a.engine.sync(); expect(await a.db.outbox.count()).toBe(1)
    a.transport.online = true; b.transport.online = true; clock += 10000
    const [first, second] = order === 'a-first' ? [a, b] : [b, a]
    await first.engine.retry(); await second.engine.retry(); await first.engine.retry()
    expect(await a.db.reviews.count()).toBe(2); expect(await b.db.reviews.count()).toBe(2)
    expect((await a.db.cards.get(card.id))!.schedule).toEqual((await b.db.cards.get(card.id))!.schedule)
    expect((await a.db.cards.get(card.id))!.schedule.reps).toBe(2)
  })
  it('recovers an interrupted image upload and a lost server acknowledgment without duplicates after reopen', async () => {
    const a = await device(); await a.engine.connect('student@example.test')
    await addImage(a.db, 3)
    a.transport.interruptUpload = true
    await a.engine.sync(); expect(await a.db.outbox.count()).toBe(1)
    expect(parseSnapshot(await a.transport.snapshot(owner), owner).images).toHaveLength(0)
    a.transport.loseAck = 'image.put'; clock += 10000
    await a.engine.retry(); expect(await a.db.outbox.count()).toBe(1)
    a.db.close(); await a.db.open()
    const restarted = new SyncEngine(a.db, a.transport, () => clock, () => .5)
    await restarted.retry()
    expect(await a.db.outbox.count()).toBe(0)
    const snapshot = parseSnapshot(await a.transport.snapshot(owner), owner)
    expect(snapshot.images).toHaveLength(1); expect(snapshot.cards).toHaveLength(3)
    const card = (await a.db.cards.toArray())[0]
    await rateCard(card.id, 4, clock, crypto.randomUUID(), a.db)
    a.transport.loseAck = 'review.add'
    await restarted.sync(); expect(await a.db.outbox.count()).toBe(1)
    await restarted.retry()
    expect(parseSnapshot(await a.transport.snapshot(owner), owner).reviews).toHaveLength(1)
    expect((await a.db.cards.get(card.id))!.schedule.reps).toBe(1)
  })
  it('retains and reports a stale metadata edit, then rebases only after an explicit resolution', async () => {
    const a = await device(); await a.engine.connect('student@example.test')
    const b = await device(); await b.engine.connect('student@example.test')
    const deck = (await a.db.decks.toArray())[0]
    await saveDeck('Version A', null, deck.id, a.db)
    await saveDeck('Version B', null, deck.id, b.db)
    await a.engine.sync(); await b.engine.sync()
    const pending = (await b.db.outbox.toArray())[0]
    expect(pending.state).toBe('conflict')
    expect((await b.db.decks.get(deck.id))!.name).toBe('Version B')
    await b.engine.rebase(pending.id); await a.engine.sync()
    expect(await b.db.outbox.count()).toBe(0)
    expect((await a.db.decks.get(deck.id))!.name).toBe('Version B')
  })
  it('can explicitly adopt cloud metadata while retaining unacknowledged reviews', async () => {
    const a = await device(); await addImage(a.db); await a.engine.connect('student@example.test')
    const b = await device(); await b.engine.connect('student@example.test')
    const d = (await a.db.decks.toArray())[0], card = (await b.db.cards.toArray())[0]
    await saveDeck('Cloud', null, d.id, a.db); await a.engine.sync()
    await saveDeck('Local conflict', null, d.id, b.db)
    await rateCard(card.id, 3, clock + 1000, crypto.randomUUID(), b.db)
    await b.engine.acceptCloudMetadata()
    expect((await b.db.decks.get(d.id))!.name).toBe('Cloud')
    expect(await b.db.reviews.count()).toBe(1)
    expect(parseSnapshot(await b.transport.snapshot(owner), owner).reviews).toHaveLength(1)
  })
  it('refuses to discard metadata required by an unsynced new card’s review', async () => {
    const a = await device(); await a.engine.connect('student@example.test')
    await addImage(a.db)
    const card = (await a.db.cards.toArray())[0]
    await rateCard(card.id, 3, clock + 1000, crypto.randomUUID(), a.db)
    await expect(a.engine.acceptCloudMetadata()).rejects.toThrow(/nur lokal/)
    expect(await a.db.cards.count()).toBe(1)
    expect(await a.db.reviews.count()).toBe(1)
    expect(await a.db.outbox.count()).toBe(2)
  })
  it('does not replace local metadata while another synchronization is in flight', async () => {
    const a = await device(); await a.engine.connect('student@example.test')
    await addImage(a.db)
    const active = a.engine.sync()
    await expect(a.engine.acceptCloudMetadata()).rejects.toThrow(/laufende Synchronisierung/)
    await active
    expect(await a.db.outbox.count()).toBe(0)
    expect(await a.db.cards.count()).toBe(1)
  })
  it('never resurrects a deleted target or loses an offline review of it', async () => {
    const a = await device(); const imageId = await addImage(a.db); await a.engine.connect('student@example.test')
    const b = await device(); await b.engine.connect('student@example.test')
    const card = (await b.db.cards.toArray())[0]
    await removeImage(imageId, a.db)
    await rateCard(card.id, 3, clock + 1000, crypto.randomUUID(), b.db)
    await a.engine.sync(); await b.engine.sync(); await a.engine.sync()
    expect(await a.db.cards.count()).toBe(0); expect(await b.db.cards.count()).toBe(0)
    expect(await a.db.reviews.count()).toBe(1); expect(await b.db.reviews.count()).toBe(1)
  })
  it('delivers creation, review, and mask removal in order even before the first upload', async () => {
    const a = await device(); await a.engine.connect('student@example.test')
    const imageId = await addImage(a.db, 3)
    const cards = await a.db.cards.toArray(), image = (await a.db.images.get(imageId))!
    await rateCard(cards[0].id, 3, clock + 1000, crypto.randomUUID(), a.db)
    const rects = (await a.db.regions.where('imageId').equals(imageId).toArray()).filter(r => r.id !== cards[0].regionId)
    await saveImage((await a.db.assets.get(image.assetHash))!, image.deckId, rects, imageId, a.db)
    await a.engine.sync()
    expect(await a.db.outbox.count()).toBe(0)
    const b = await device(); await b.engine.connect('student@example.test')
    expect(await b.db.cards.count()).toBe(2)
    expect(await b.db.reviews.count()).toBe(1)
    expect(parseSnapshot(await b.transport.snapshot(owner), owner).cards.find(c => c.data.id === cards[0].id)?.deleted).toBe(true)
  })
  it('rolls back local mutations when the durable outbox cannot be written and refuses account switching', async () => {
    const a = await device(); await a.engine.connect('student@example.test')
    const before = await a.db.decks.count()
    const spy = vi.spyOn(a.db.outbox, 'add').mockRejectedValue(new Error('Quota exceeded'))
    await expect(saveDeck('Must not survive', null, undefined, a.db)).rejects.toThrow('Quota')
    expect(await a.db.decks.count()).toBe(before); spy.mockRestore()
    const stranger = crypto.randomUUID(); await pg.query('insert into auth.users(id) values($1)', [stranger])
    const other = new SyncEngine(a.db, new TestTransport(stranger))
    await expect(other.connect('other@example.test')).rejects.toThrow(/anderen Konto/)
    expect(((await a.db.syncMeta.get('connection'))!.value as Connection).userId).toBe(owner)
  })
  it('uses capped exponential backoff and rejects malformed cloud snapshots before a merge', () => {
    expect(retryDelay(0, () => .5)).toBe(1000)
    expect(retryDelay(2, () => .5)).toBe(4000)
    expect(retryDelay(100, () => .5)).toBe(300000)
    expect(() => parseSnapshot({ schemaVersion: 99 }, owner)).toThrow(/Version/)
    expect(() => parseSnapshot({ schemaVersion: 1, decks: [{ user_id: 'someone-else' }] }, owner)).toThrow(/Cloud-Daten/)
  })
})
