import { expect, type Page } from '@playwright/test'

const owner = '00000000-0000-4000-8000-000000000003'
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'background@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-17T12:00:00Z' }
const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*' }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
export async function draw(page: Page, y: number) {
  await page.getByTestId('image-surface').scrollIntoViewIfNeeded()
  const box = (await page.getByTestId('image-surface').boundingBox())!
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * (y + .08), { steps: 4 })
  await page.mouse.up()
}
export async function localState(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('occlude'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const read = <T>(store: string) => new Promise<T[]>((resolve, reject) => { const r = database.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const result = { cards: (await read('cards')).length, reviews: (await read('reviews')).length, pending: (await read('outbox')).length, locked: (await read<{ key: string; value: { locked: boolean } }>('syncMeta')).find(m => m.key === 'connection')?.value.locked }
    database.close(); return result
  })
}
export async function cloudFixture(page: Page) {
  const authGate = deferred(), snapshotGate = deferred(), applyGate = deferred()
  const cloud = { holdAuth: false, holdSnapshot: false, holdApply: false, authRequests: 0, verifications: 0, pulls: 0, uploads: 0, operations: [] as any[], snapshot: {} as any }
  // All external requests are intercepted. No real Auth emails or cloud writes.
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    const reply = (body: unknown, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/auth/v1/verify') {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const expires = Math.floor(Date.now() / 1000) + 3600
      return reply({ access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: owner, aud: 'authenticated', role: 'authenticated', exp: expires })}.test-signature`, refresh_token: 'test-only-refresh-token', expires_in: 3600, expires_at: expires, token_type: 'bearer', user })
    }
    if (url.pathname === '/auth/v1/token') {
      cloud.authRequests++
      if (cloud.holdAuth) await authGate.promise
      return reply({ code: 'refresh_token_not_found', message: 'Refresh token not found' }, 400)
    }
    if (url.pathname === '/auth/v1/user') { cloud.verifications++; return reply(user) }
    if (url.pathname === '/rest/v1/rpc/occlude_snapshot') {
      cloud.pulls++
      if (cloud.holdSnapshot) await snapshotGate.promise
      return reply(cloud.snapshot)
    }
    if (url.pathname === '/rest/v1/rpc/occlude_apply_operation') {
      const op = request.postDataJSON().p_operation
      cloud.operations.push(op)
      if (cloud.holdApply) await applyGate.promise
      const p = op.payload, shared = { user_id: owner, version: op.baseVersion + 1, deleted_at: null }
      if (op.kind === 'image.put') {
        cloud.snapshot.images = [{ ...shared, id: p.id, deck_id: p.deckId, content_hash: p.assetHash, width: p.width, height: p.height, mime_type: p.mimeType, storage_path: `${owner}/${p.assetHash}`, created_at: new Date(p.createdAt).toISOString(), updated_at: new Date(p.updatedAt).toISOString() }]
        cloud.snapshot.regions = p.regions.map((r: any) => ({ ...shared, id: r.id, image_id: r.imageId, x: r.x, y: r.y, width: r.width, height: r.height, label: r.label ?? '' }))
        cloud.snapshot.cards = p.cards.map((c: any) => ({ ...shared, id: c.id, image_id: c.imageId, region_id: c.regionId, created_at: new Date(c.createdAt).toISOString() }))
      } else if (op.kind === 'review.add') cloud.snapshot.reviews.push({ ...shared, id: p.id, card_id: p.cardId, rating: p.rating, reviewed_at: new Date(p.reviewedAt).toISOString(), scheduler_version: p.schedulerVersion })
      else throw new Error(`Unexpected operation: ${op.kind}`)
      return reply(null)
    }
    if (url.pathname.startsWith('/storage/v1/')) { cloud.uploads++; return reply({ Key: 'test-image' }) }
    return route.abort()
  })
  const release = () => { authGate.resolve(); snapshotGate.resolve(); applyGate.resolve() }
  return { cloud, authGate, snapshotGate, applyGate, release }
}
export async function createLocalLibrary(page: Page) {
  await page.goto('/')
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const ctx = c.getContext('2d')!; ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 800, 600); return c.toDataURL('image/png').split(',')[1] })
  await page.getByLabel('Bild hochladen').setInputFiles({ name: 'cached.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await draw(page, .2); await draw(page, .45)
  await page.getByRole('button', { name: '2 Karten speichern' }).click()
  await page.getByRole('heading', { name: 'Bibliothek' }).waitFor()
}
export async function seedWorkspace(page: Page, expired: boolean) {
  await createLocalLibrary(page)
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await page.getByRole('textbox', { name: 'E-Mail-Adresse', exact: true }).fill(user.email)
  await page.getByRole('textbox', { name: 'Code aus der E-Mail' }).fill('123456')
  await page.getByRole('button', { name: 'Mit Code anmelden' }).click()
  await expect(page.getByText('Angemeldet als')).toBeVisible()
  return page.evaluate(async ({ owner, email, expired }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('occlude'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const read = (store: string) => new Promise<any[]>((resolve, reject) => { const r = database.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const decks = await read('decks'), images = await read('images'), regions = await read('regions'), cards = await read('cards')
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('syncMeta', 'readwrite'), store = tx.objectStore('syncMeta')
      store.put({ key: 'connection', value: { userId: owner, email, locked: false } })
      for (const d of decks) store.put({ key: `version:deck:${d.id}`, value: 1 })
      for (const i of images) { store.put({ key: `version:image:${i.id}`, value: 1 }); store.put({ key: `uploaded:${owner}:${i.assetHash}`, value: true }) }
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    if (expired) {
      const key = Object.keys(localStorage).find(key => key.endsWith('-auth-token'))!
      const session = JSON.parse(localStorage.getItem(key)!)
      session.expires_at = Math.floor(Date.now() / 1000) - 60
      localStorage.setItem(key, JSON.stringify(session))
    }
    database.close()
    const shared = { user_id: owner, version: 1, deleted_at: null }
    return {
      schemaVersion: 1, features: ['region-labels'], profile: null, reviews: [],
      decks: decks.map(d => ({ ...shared, id: d.id, name: d.name, parent_id: d.parentId, created_at: new Date(d.createdAt).toISOString(), updated_at: new Date(d.updatedAt).toISOString() })),
      images: images.map(i => ({ ...shared, id: i.id, deck_id: i.deckId, content_hash: i.assetHash, width: i.width, height: i.height, mime_type: i.mimeType, storage_path: `${owner}/${i.assetHash}`, created_at: new Date(i.createdAt).toISOString(), updated_at: new Date(i.updatedAt).toISOString() })),
      regions: regions.map(r => ({ ...shared, id: r.id, image_id: r.imageId, x: r.x, y: r.y, width: r.width, height: r.height, label: r.label ?? '' })),
      cards: cards.map(c => ({ ...shared, id: c.id, image_id: c.imageId, region_id: c.regionId, created_at: new Date(c.createdAt).toISOString() })),
    }
  }, { owner, email: user.email, expired })
}

