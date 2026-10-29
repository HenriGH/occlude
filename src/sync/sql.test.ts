// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SCHEDULER_VERSION } from '../domain'
import type { WireOperation } from './model'
import { sqlBackend } from '../test/sqlBackend'
import { diagram } from '../test/cardSvgFixture'

let pg: PGlite
let userA: string, userB: string
const id = () => crypto.randomUUID()
const now = Date.parse('2026-10-17T12:00:00Z')
function operation(kind: WireOperation['kind'], entityId: string, payload: Record<string, unknown>, baseVersion = 0): WireOperation {
  return { id: id(), deviceId: id(), kind, entityId, baseVersion, payload }
}
async function asUser(user: string, clientId?: string) {
  await pg.exec('reset role')
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  await pg.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, ...(clientId ? { client_id: clientId } : {}) })])
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

describe('ChatGPT deletion capabilities', () => {
  async function access(manage = true) {
    const client = id()
    await pg.query('select public.occlude_authorize_chatgpt($1,$2)', [client, 'ChatGPT'])
    if (manage) await pg.query('select public.occlude_authorize_chatgpt_management($1,$2)', [client, 'ChatGPT'])
    await asUser(userA, client)
    return client
  }
  const create = async (folder: string, count = 1) => (await pg.query<{ data: any }>('select public.occlude_mcp_create_cards($1,$2,null,$3::jsonb) data', [id(), folder, JSON.stringify(Array.from({ length: count }, (_, i) => ({ front: `Batch question ${i}`, back: 'PRIVATE ANSWER' })))])).rows[0].data
  const remove = async (request: string, cards: unknown[]) => (await pg.query<{ data: any }>('select public.occlude_mcp_delete_cards($1,$2::jsonb) data', [request, JSON.stringify(cards)])).rows[0].data
  const preview = async (folder: string) => (await pg.query<{ data: any }>('select public.occlude_mcp_preview_folder_deletion($1) data', [folder])).rows[0].data
  const removeFolder = async (request: string, folder: string, token: string) => (await pg.query<{ data: any }>('select public.occlude_mcp_delete_folder($1,$2,$3) data', [request, folder, token])).rows[0].data

  it('keeps existing creation grants restricted until explicit new consent and blocks direct/foreign/revoked access', async () => {
    const folder = await deck(), client = await access(false)
    const saved = await create(folder)
    await expect(remove(id(), [{ id: saved.card_ids[0], version: 1 }])).rejects.toThrow(/new consent/)
    await expect(preview(folder)).rejects.toThrow(/new consent/)
    await expect(pg.query('select public.occlude_mcp_list_cards(null,null,null,50)')).rejects.toThrow(/new consent/)
    await expect(pg.query('select public.occlude_authorize_chatgpt_management($1,$2)', [client, 'ChatGPT'])).rejects.toThrow(/direct user/)
    await expect(pg.query('select public.occlude_mcp_folder_state($1,$2)', [userA, folder])).rejects.toThrow(/permission denied/)
    await asUser(userA)
    await pg.query('select public.occlude_authorize_chatgpt_management($1,$2)', [client, 'ChatGPT'])
    expect((await pg.query<{ data: any }>('select public.occlude_chatgpt_connections() data')).rows[0].data).toContainEqual(expect.objectContaining({ client_id: client, can_manage: true }))
    await expect(preview(folder)).rejects.toThrow(/not authorized/)
    await asUser(userB)
    const foreign = await deck('Foreign')
    await pg.query('select public.occlude_authorize_chatgpt_management($1,$2)', [client, 'ChatGPT'])
    await asUser(userB, client)
    await expect(remove(id(), [{ id: saved.card_ids[0], version: 1 }])).rejects.toThrow(/missing or unavailable/)
    await expect(preview(folder)).rejects.toThrow(/missing or unavailable/)
    await asUser(userA, client)
    await expect(preview(foreign)).rejects.toThrow(/missing or unavailable/)
    await expect(remove(id(), [{ id: id(), version: 1 }])).rejects.toThrow(/missing or unavailable/)
    expect((await pg.query('select * from public.cards')).rows).toHaveLength(0)
    await asUser(userA)
    await pg.query('select public.occlude_revoke_chatgpt($1)', [client])
    await asUser(userA, client)
    await expect(remove(id(), [{ id: saved.card_ids[0], version: 1 }])).rejects.toThrow(/revoked/)
    await pg.exec('reset role; set role anon')
    await expect(preview(folder)).rejects.toThrow(/permission denied/)
  })
  it('undoes exactly a 27-card batch, paginates questions without answers, and safely deduplicates deletions', async () => {
    const folder = await deck(), client = await access(), saved = await create(folder, 27)
    const extra = await create(folder)
    const listed: string[] = []
    let after: string | null = null
    do {
      const page: { cards: { id: string }[]; next_after: string | null } = (await pg.query<{ data: any }>('select public.occlude_mcp_list_cards($1,$2,$3,10) data', [folder, 'Batch question', after])).rows[0].data
      expect(JSON.stringify(page)).not.toContain('PRIVATE ANSWER')
      listed.push(...page.cards.map((c: any) => c.id)); after = page.next_after
    } while (after)
    expect(new Set(listed).size).toBe(28)
    const request = id(), cards = saved.card_ids.map((id: string) => ({ id, version: 1 }))
    const result = await remove(request, cards)
    expect(result).toMatchObject({ deleted_count: 27, already_deleted_count: 0 })
    expect(await remove(request, cards)).toEqual(result)
    expect(await remove(id(), cards)).toMatchObject({ deleted_count: 0, already_deleted_count: 27 })
    await expect(remove(request, [{ id: extra.card_ids[0], version: 1 }])).rejects.toThrow(/reused/)
    await asUser(userA)
    const live = (await pg.query<{ id: string }>('select id from public.cards where deleted_at is null')).rows
    expect(live.map(row => row.id)).toEqual([extra.card_ids[0]])
    await asUser(userB, client)
    await expect(remove(id(), cards)).rejects.toThrow(/not authorized/)
  })
  it('rejects whole batches on stale versions, forged ownership, duplicates or unavailable cards', async () => {
    const folder = await deck(), client = await access(), saved = await create(folder, 2)
    await asUser(userA)
    const edited = saved.card_ids[1]
    await apply(operation('basic.put', edited, { id: edited, kind: 'basic', deckId: folder, front: 'User edited', back: 'Answer', createdAt: now }, 1))
    await asUser(userA, client)
    const first = { id: saved.card_ids[0], version: 1 }
    for (const refs of [[first, { id: edited, version: 1 }], [first, { id: id(), version: 1 }], [first, first], [{ ...first, user_id: userB }], [{ ...first, version: null }], [{ ...first, version: 1.5 }], []]) await expect(remove(id(), refs)).rejects.toThrow()
    await asUser(userA)
    expect((await pg.query('select id from public.cards where deleted_at is null')).rows).toHaveLength(2)
    await asUser(userA, client)
    expect(await remove(id(), [first, { id: edited, version: 2 }])).toMatchObject({ deleted_count: 2 })
  })
  it('deletes an image mask without changing siblings or reviews and conflicts with an offline image edit', async () => {
    const folder = await deck(), original = await image(folder), review = id()
    await apply(operation('review.add', review, { id: review, cardId: original.cardId, rating: 3, reviewedAt: now, schedulerVersion: SCHEDULER_VERSION }))
    const sibling = id(), region = id()
    const payload = { ...original.payload, regions: [...original.payload.regions, { id: region, imageId: original.imageId, x: .5, y: .5, width: .1, height: .1 }], cards: [...original.payload.cards, { id: sibling, imageId: original.imageId, regionId: region, createdAt: now }] }
    await apply(operation('image.put', original.imageId, payload, 1))
    await access()
    expect(await remove(id(), [{ id: original.cardId, version: 1 }])).toMatchObject({ deleted_count: 1 })
    await asUser(userA)
    const state = await snapshot()
    expect(state.cards.find(c => c.id === sibling)?.deleted_at).toBeNull()
    expect(state.cards.find(c => c.id === original.cardId)?.deleted_at).toBeTruthy()
    expect(state.regions.find(r => r.id === original.regionId)?.deleted_at).toBeTruthy()
    expect(state.images[0].deleted_at).toBeNull()
    expect(state.reviews).toHaveLength(1)
    await expect(apply(operation('image.put', original.imageId, payload, 2))).rejects.toThrow(/conflict:image/)
    const lateReview = id()
    await apply(operation('review.add', lateReview, { id: lateReview, cardId: original.cardId, rating: 3, reviewedAt: now + 1000, schedulerVersion: SCHEDULER_VERSION }))
    expect((await snapshot()).reviews).toHaveLength(2)
  })
  it('previews whole folder scope, refuses changes since preview and retains unrelated folders/history on retry', async () => {
    const root = await deck('Root'), child = await deck('Child', root), outside = await deck('Outside')
    const original = await image(child), review = id()
    await apply(operation('review.add', review, { id: review, cardId: original.cardId, rating: 3, reviewedAt: now, schedulerVersion: SCHEDULER_VERSION }))
    const client = await access()
    await create(child, 2); await create(outside)
    const initial = await preview(root)
    expect(initial).toMatchObject({ name: 'Root', folder_count: 2, image_count: 1, card_count: 3 })
    expect(initial.folder_ids).toBeUndefined()
    const newer = await create(child)
    await expect(removeFolder(id(), root, initial.snapshot_token)).rejects.toThrow(/folder changed/)
    const fresh = await preview(root), request = id()
    const result = await removeFolder(request, root, fresh.snapshot_token)
    expect(result).toMatchObject({ deleted_folder_count: 2, deleted_card_count: 4, deleted_image_count: 1 })
    expect(await removeFolder(request, root, fresh.snapshot_token)).toEqual(result)
    await expect(removeFolder(request, outside, fresh.snapshot_token)).rejects.toThrow(/reused/)
    await asUser(userA)
    expect((await pg.query('select id from public.decks where deleted_at is null')).rows).toEqual([{ id: outside }])
    expect((await pg.query('select id from public.cards where deleted_at is null')).rows).toHaveLength(1)
    expect((await pg.query('select * from public.review_events where id=$1', [review])).rows).toHaveLength(1)
    await expect(apply(operation('basic.put', newer.card_ids[0], { id: newer.card_ids[0], kind: 'basic', deckId: child, front: 'Stale', back: 'Edit', createdAt: now }, 1))).rejects.toThrow(/conflict/)
    await asUser(userA, client)
    await expect(removeFolder(id(), root, fresh.snapshot_token)).rejects.toThrow(/missing/)
  })
})

describe('PostgreSQL migration and tenant security', () => {
  it('creates vector cards atomically, keeps graphics through older text editors, and does not replay stale graphic updates', async () => {
    const folder = await deck(), client = id(), request = id()
    await pg.query('select public.occlude_authorize_chatgpt($1,$2)', [client, 'ChatGPT'])
    await asUser(userA, client)
    const cards = [{ front: 'Graph?', back: 'Explanation', front_svg: diagram, back_svg: diagram.replace('Logarithmusfunktion', 'Lösung') }]
    const create = (content: unknown[]) => pg.query<{ data: any }>('select public.occlude_mcp_create_cards($1,$2,null,$3::jsonb) data', [request, folder, JSON.stringify(content)])
    const saved = (await create(cards)).rows[0].data
    expect((await create(cards)).rows[0].data).toEqual(saved)
    await expect(create([{ ...cards[0], front_svg: '' }])).rejects.toThrow(/reused/)
    const card = saved.card_ids[0]
    await asUser(userA)
    const state = (await pg.query<{ data: any }>('select public.occlude_snapshot_v2() data')).rows[0].data
    expect(state.features).toContain('card-svg')
    expect(state.cards.find((row: any) => row.id === card)).toMatchObject({ front_svg: diagram, back_svg: cards[0].back_svg })
    const thin = (await pg.query<{ data: any }>('select public.occlude_snapshot_v3($1::jsonb) data', [JSON.stringify({ [card]: 1 })])).rows[0].data
    expect(thin.cards.find((row: any) => row.id === card)).toMatchObject({ svg_unchanged: true })
    expect(JSON.stringify(thin)).not.toContain('Logarithmusfunktion')
    const stale = (await pg.query<{ data: any }>('select public.occlude_snapshot_v3($1::jsonb) data', [JSON.stringify({ [card]: 999 })])).rows[0].data
    expect(stale.cards.find((row: any) => row.id === card).front_svg).toBe(diagram)
    const text = { id: card, kind: 'basic', deckId: folder, front: 'Edited text', back: 'Answer', createdAt: now }
    await apply(operation('basic.put', card, text, 1))
    expect((await pg.query<{ front_svg: string }>('select front_svg from public.cards where id=$1', [card])).rows[0].front_svg).toBe(diagram)
    const clear = operation('basic.put', card, { ...text, frontSvg: '', backSvg: '' }, 2)
    await apply(clear)
    const restore = operation('basic.put', card, { ...text, frontSvg: diagram, backSvg: '' }, 3)
    await apply(restore)
    await apply(clear)
    expect((await pg.query<{ front_svg: string; version: number }>('select front_svg,version from public.cards where id=$1', [card])).rows[0]).toMatchObject({ front_svg: diagram, version: 4 })
    await asUser(userB)
    expect((await pg.query<{ data: any }>('select public.occlude_snapshot_v2() data')).rows[0].data.cards).toHaveLength(0)
  })
  it('rejects active, oversized or null vector payloads without partially creating a batch', async () => {
    const folder = await deck(), client = id()
    await pg.query('select public.occlude_authorize_chatgpt($1,$2)', [client, 'ChatGPT'])
    await asUser(userA, client)
    for (const svg of [null, 'x'.repeat(100001), diagram.replace('<title>', '<script>alert(1)</script><title>'), diagram.replace('<title>', '<image href="https://external.test/x"/><title>')]) {
      const cards = [{ front: 'Valid first', back: 'A' }, { front: 'Invalid second', back: 'A', back_svg: svg }]
      await expect(pg.query('select public.occlude_mcp_create_cards($1,$2,null,$3::jsonb)', [id(), folder, JSON.stringify(cards)])).rejects.toThrow()
    }
    await asUser(userA)
    expect((await pg.query('select id from public.cards')).rows).toHaveLength(0)
  })
  it('upgrades an existing database without losing cards or immutable review events', async () => {
    const legacy = await sqlBackend({ through: '202610170001_initial_sync.sql' })
    try {
      const user = id(), d = id(), im = id(), region = id(), card = id(), review = id(), hash = 'a'.repeat(64)
      await legacy.query('insert into auth.users(id) values($1)', [user])
      await legacy.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
      await legacy.exec('set role authenticated')
      const send = (op: WireOperation) => legacy.query('select public.occlude_apply_operation($1::jsonb)', [JSON.stringify(op)])
      await send(operation('deck.put', d, { id: d, parentId: null, name: 'Bestehender Ordner', createdAt: now }))
      await legacy.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['occlude-images', `${user}/${hash}`])
      await send(operation('image.put', im, { id: im, deckId: d, assetHash: hash, width: 1000, height: 650, mimeType: 'image/webp', createdAt: now,
        regions: [{ id: region, imageId: im, x: .1, y: .2, width: .3, height: .1 }], cards: [{ id: card, regionId: region, imageId: im, createdAt: now }] }))
      await send(operation('review.add', review, { id: review, cardId: card, rating: 3, reviewedAt: now, schedulerVersion: SCHEDULER_VERSION }))
      await legacy.exec('reset role')
      await legacy.exec(await readFile('supabase/migrations/202610170002_mask_labels.sql', 'utf8'))
      await legacy.exec(await readFile('supabase/migrations/202610200001_basic_cards_chatgpt.sql', 'utf8'))
      const client = id()
      await legacy.exec('set role authenticated')
      await legacy.query('select public.occlude_authorize_chatgpt($1,$2)', [client, 'Existing ChatGPT'])
      await legacy.exec('reset role')
      await legacy.exec(await readFile('supabase/migrations/202610200002_chatgpt_deletion.sql', 'utf8'))
      await legacy.exec(await readFile('supabase/migrations/202610290001_card_svg.sql', 'utf8'))
      await legacy.exec('set role authenticated')
      expect((await legacy.query<{ data: any }>('select public.occlude_chatgpt_connections() data')).rows[0].data).toContainEqual(expect.objectContaining({ client_id: client, can_manage: false }))
      const state = (await legacy.query<{ data: any }>('select public.occlude_snapshot() data')).rows[0].data
      expect(state.features).toContain('region-labels')
      expect(state.regions).toEqual([expect.objectContaining({ id: region, label: '' })])
      expect(state.cards).toEqual([expect.objectContaining({ id: card })])
      expect(state.reviews).toEqual([expect.objectContaining({ id: review, rating: 3 })])
      expect(state.decks[0].name).toBe('Bestehender Ordner')
    } finally { await legacy.close() }
  }, 30000)
  it('stores questions, preserves them for old clients, validates edits atomically and clears them explicitly', async () => {
    const { payload, imageId, cardId, regionId } = await image(await deck())
    const labelled = { ...payload, regions: [{ ...payload.regions[0], label: 'Welche Struktur?' }] }
    const edit = operation('image.put', imageId, labelled, 1)
    expect(await apply(edit)).toEqual({ version: 2 })
    expect(await apply(edit)).toEqual({ version: 2 })
    expect((await snapshot()).regions.find(r => r.id === regionId)?.label).toBe('Welche Struktur?')
    for (const label of [null, 123, {}, 'x'.repeat(201)]) {
      await expect(apply(operation('image.put', imageId, { ...payload, regions: [{ ...payload.regions[0], label }] }, 2))).rejects.toThrow('invalid mask label')
    }
    expect((await snapshot()).images[0].version).toBe(2)
    await asUser(userB)
    expect((await snapshot()).regions).toHaveLength(0)
    await asUser(userA)
    await apply(operation('image.put', imageId, payload, 2))
    expect((await snapshot()).regions[0].label).toBe('Welche Struktur?')
    await apply(operation('image.put', imageId, { ...payload, regions: [{ ...payload.regions[0], label: '' }] }, 3))
    expect((await snapshot()).regions[0].label).toBe('')
    expect((await snapshot()).cards[0].id).toBe(cardId)
  })
  it('upgrades image-card data, supports basic edits and keeps legacy snapshots parseable', async () => {
    const folder = await deck(), basic = id()
    const original = await image(folder)
    await apply(operation('basic.put', basic, { id: basic, kind: 'basic', deckId: folder, front: 'Q', back: 'A', createdAt: now, updatedAt: now }))
    const newRegion = id()
    await expect(apply(operation('image.put', original.imageId, { ...original.payload, regions: [{ id: newRegion, imageId: original.imageId, x: .1, y: .2, width: .3, height: .1 }], cards: [{ id: basic, imageId: original.imageId, regionId: newRegion, createdAt: now }] }, 1))).rejects.toThrow(/kind is immutable/)
    const review = id()
    await apply(operation('review.add', review, { id: review, cardId: basic, rating: 3, reviewedAt: now, schedulerVersion: SCHEDULER_VERSION }))
    expect((await snapshot()).cards.map(c => c.id)).toEqual([original.cardId])
    expect((await snapshot()).reviews).toHaveLength(0)
    const fresh = (await pg.query<{ data: any }>('select public.occlude_snapshot_v2() data')).rows[0].data
    expect(fresh.features).toContain('basic-cards')
    expect(fresh.cards).toHaveLength(2)
    expect(fresh.reviews[0].card_id).toBe(basic)
    await apply(operation('basic.put', basic, { id: basic, kind: 'basic', deckId: folder, front: 'Edited', back: 'A', createdAt: now, updatedAt: now }, 1))
    expect((await pg.query<{ front: string }>('select front from public.cards where id=$1', [basic])).rows[0].front).toBe('Edited')
    await apply(operation('deck.delete', folder, {}, 1))
    expect((await pg.query<{ deleted_at: string }>('select deleted_at from public.cards where id=$1', [basic])).rows[0].deleted_at).toBeTruthy()
    expect((await pg.query('select * from public.review_events where id=$1', [review])).rows).toHaveLength(1)
  })
  it('isolates MCP access, enforces explicit consent, validates batches atomically and deduplicates retries', async () => {
    const folder = await deck(), foreign = id(), client = id(), request = id()
    await asUser(userB); await apply(operation('deck.put', foreign, { id: foreign, name: 'Other', parentId: null, createdAt: now }))
    await asUser(userA)
    await pg.query('select public.occlude_authorize_chatgpt($1,$2)', [client, 'ChatGPT'])
    await asUser(userA, client)
    expect((await pg.query('select * from public.decks')).rows).toHaveLength(0)
    await expect(snapshot()).rejects.toThrow(/direct user/)
    await expect(pg.query('select public.occlude_snapshot_v2()')).rejects.toThrow(/direct user/)
    await expect(apply(operation('deck.delete', folder, {}, 1))).rejects.toThrow(/direct user/)
    await expect(pg.query('select public.occlude_authorize_chatgpt($1,$2)', [id(), 'Other'])).rejects.toThrow(/direct user/)
    const create = (requestId: string, cards: unknown[], target = folder) => pg.query<{ data: any }>('select public.occlude_mcp_create_cards($1,$2,null,$3::jsonb) data', [requestId, target, JSON.stringify(cards)])
    await expect(create(id(), [{ front: 'Q', back: 'A' }], foreign)).rejects.toThrow(/folder missing/)
    await expect(create(id(), [{ front: 'Q', back: 'A' }, { front: '', back: 'A' }])).rejects.toThrow()
    expect((await pg.query('select public.occlude_mcp_list_decks() data')).rows[0]).toBeTruthy()
    const saved = (await create(request, [{ front: 'Q', back: 'A' }])).rows[0].data
    expect(saved.created_count).toBe(1)
    expect((await create(request, [{ front: 'Q', back: 'A' }])).rows[0].data).toEqual(saved)
    await expect(create(request, [{ front: 'Different', back: 'A' }])).rejects.toThrow(/reused/)
    await expect(create(id(), [{ front: 'Q', back: 'A', user_id: userB }])).rejects.toThrow(/forged/)
    await asUser(userB, client)
    await expect(create(id(), [{ front: 'Q', back: 'A' }])).rejects.toThrow(/not authorized/)
    await asUser(userA)
    expect((await pg.query("select * from public.cards where kind='basic'")).rows).toHaveLength(1)
    await pg.query('select public.occlude_revoke_chatgpt($1)', [client])
    await asUser(userA, client)
    await expect(create(id(), [{ front: 'Q', back: 'A' }])).rejects.toThrow(/revoked/)
  })
  it('makes all data tables RLS-protected and denies unauthenticated RPC calls', async () => {
    const tables = (await pg.query<{ relname: string; relrowsecurity: boolean }>("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).rows
    expect(tables).toHaveLength(8)
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
