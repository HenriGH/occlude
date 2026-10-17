// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SCHEDULER_VERSION } from '../domain'
import type { WireOperation } from './model'
import { sqlBackend } from '../test/sqlBackend'

let pg: PGlite
let userA: string, userB: string
const id = () => crypto.randomUUID()
const now = Date.parse('2026-10-17T12:00:00Z')
function operation(kind: WireOperation['kind'], entityId: string, payload: Record<string, unknown>, baseVersion = 0): WireOperation {
  return { id: id(), deviceId: id(), kind, entityId, baseVersion, payload }
}
async function asUser(user: string) {
  await pg.exec('reset role')
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  await pg.exec('set role authenticated')
}
async function apply(op: WireOperation) { return (await pg.query<{ result: { version: number } }>('select public.occlude_apply_operation($1::jsonb) result', [JSON.stringify(op)])).rows[0].result }
async function snapshot() { return (await pg.query<{ result: Record<string, Array<Record<string, unknown>>> }>('select public.occlude_snapshot() result')).rows[0].result }
async function deck(name = 'Anatomie', parentId: string | null = null) {
  const entity = id()
  await apply(operation('deck.put', entity, { id: entity, name, parentId, createdAt: now }))
  return entity
}
async function image(deckId: string) {
  const imageId = id(), regionId = id(), cardId = id(), hash = 'a'.repeat(64)
  await pg.query('insert into storage.objects(bucket_id,name) values($1,$2) on conflict do nothing', ['occlude-images', `${userA}/${hash}`])
  const payload = { id: imageId, deckId, assetHash: hash, width: 1000, height: 650, mimeType: 'image/webp', createdAt: now,
    regions: [{ id: regionId, imageId, x: .1, y: .2, width: .3, height: .1 }], cards: [{ id: cardId, regionId, imageId, createdAt: now }] }
  const op = operation('image.put', imageId, payload)
  await apply(op)
  return { imageId, regionId, cardId, payload, op }
}
beforeAll(async () => {
  pg = await sqlBackend()
}, 30000)
beforeEach(async () => {
  await pg.exec('reset role')
  userA = id(); userB = id()
  await pg.query('insert into auth.users(id) values($1),($2)', [userA, userB])
  await asUser(userA)
})
afterAll(async () => { await pg?.close() })

describe('PostgreSQL migration and tenant security', () => {
  it('makes all data tables RLS-protected and denies unauthenticated RPC calls', async () => {
    const tables = (await pg.query<{ relname: string; relrowsecurity: boolean }>("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).rows
    expect(tables).toHaveLength(7)
    expect(tables.every(t => t.relrowsecurity)).toBe(true)
    await pg.exec('reset role; set role anon')
    await expect(snapshot()).rejects.toThrow(/permission denied/)
  })
  it('hides another user’s rows and blocks forged ownership, direct writes, and foreign parents', async () => {
    const own = await deck()
    await asUser(userB)
    expect((await snapshot()).decks).toHaveLength(0)
    expect((await pg.query('select * from public.decks where id=$1', [own])).rows).toHaveLength(0)
    await expect(pg.query("update public.decks set name='stolen' where id=$1", [own])).rejects.toThrow(/permission denied/)
    await expect(apply(operation('deck.put', id(), { userId: userA }))).rejects.toThrow(/forged ownership/)
    const forged = id()
    await expect(apply(operation('deck.put', forged, { id: forged, name: 'Foreign', parentId: own, createdAt: now }))).rejects.toThrow(/parent missing/)
    await expect(apply(operation('deck.put', forged, { id: forged, name: 'Bad timestamp', parentId: null, createdAt: 'Infinity' }))).rejects.toThrow(/invalid timestamp/)
  })
  it('allows only the owner’s immutable private image path', async () => {
    await image(await deck())
    await asUser(userB)
    expect((await pg.query('select * from storage.objects')).rows).toHaveLength(0)
    await expect(pg.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['occlude-images', `${userA}/${'b'.repeat(64)}`])).rejects.toThrow(/row-level security/)
    await expect(pg.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['occlude-images', `${userB}/unsafe.svg`])).rejects.toThrow(/row-level security/)
    await pg.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['occlude-images', `${userB}/${'b'.repeat(64)}`])
    expect((await pg.query('delete from storage.objects returning *')).rows).toHaveLength(0)
  })
  it('deduplicates lost-ack retries and rejects stale metadata/cycles atomically', async () => {
    const parent = await deck(), child = await deck('Kind', parent)
    const op = operation('deck.put', parent, { id: parent, name: 'Neu', parentId: null, createdAt: now }, 1)
    expect(await apply(op)).toEqual({ version: 2 })
    expect(await apply(op)).toEqual({ version: 2 })
    await expect(apply({ ...op, payload: { ...op.payload, name: 'Changed retry' } })).rejects.toThrow(/reused/)
    await expect(apply({ ...op, id: id() })).rejects.toThrow(/conflict/)
    await expect(apply(operation('deck.put', parent, { ...op.payload, parentId: child }, 2))).rejects.toThrow(/cycle/)
    const state = await snapshot()
    expect(state.decks.find(d => d.id === parent)?.version).toBe(2)
  })
  it('retains concurrent review events exactly once and preserves them after deletion', async () => {
    const d = await deck(), { imageId, cardId } = await image(d)
    const reviewA = id(), reviewB = id()
    const a = operation('review.add', reviewA, { id: reviewA, cardId, rating: 3, reviewedAt: now + 1000, schedulerVersion: SCHEDULER_VERSION })
    const b = operation('review.add', reviewB, { id: reviewB, cardId, rating: 1, reviewedAt: now + 1000, schedulerVersion: SCHEDULER_VERSION })
    await apply(b); await apply(a); await apply(a)
    await expect(apply({ ...a, id: id(), payload: { ...a.payload, schedulerVersion: null } })).rejects.toThrow(/invalid review/)
    expect((await snapshot()).reviews).toHaveLength(2)
    await asUser(userB)
    expect((await pg.query('select * from public.card_scheduling')).rows).toHaveLength(0)
    const forgedReview = id()
    await expect(apply(operation('review.add', forgedReview, { id: forgedReview, cardId, rating: 4, reviewedAt: now, schedulerVersion: SCHEDULER_VERSION }))).rejects.toThrow(/target missing/)
    await asUser(userA)
    await apply(operation('image.delete', imageId, {}, 1))
    expect((await snapshot()).reviews).toHaveLength(2)
    expect((await snapshot()).cards[0].deleted_at).not.toBeNull()
  })
  it('does not publish metadata before upload or accept a mask outside the image', async () => {
    const d = await deck(), imageId = id()
    await expect(apply(operation('image.put', imageId, { id: imageId, deckId: d, assetHash: 'c'.repeat(64) }))).rejects.toThrow(/upload incomplete/)
    const { payload } = await image(d)
    const second = id(), region = id(), card = id()
    const secondDeck = await deck('Andere Vorlesung')
    await expect(apply(operation('image.put', second, { ...payload, deckId: secondDeck, id: second, regions: [{ ...payload.regions[0], id: region, imageId: second, x: 2 }], cards: [{ id: card, regionId: region, imageId: second, createdAt: now }] }))).rejects.toThrow(/check constraint/)
    expect((await snapshot()).images).toHaveLength(1)
  })
})
