import { expect, test, type Page } from '@playwright/test'
import { createLocalLibrary, draw, localState } from './helpers/cloud'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

async function holdStorage(page: Page, mode: IDBTransactionMode) {
  await page.evaluate(async mode => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('occlude')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(['decks', 'preferences'], mode)
    let holding = true
    const target = window as typeof window & { releaseStorage: () => Promise<void> }
    const finished = new Promise<void>(resolve => { transaction.oncomplete = () => { database.close(); resolve() } })
    target.releaseStorage = () => { holding = false; return finished }
    // Keep a real IndexedDB transaction alive, as a stalled browser instance
    // can do. Requests from another page must use native transaction scheduling.
    const keepAlive = () => {
      const request = transaction.objectStore('preferences').get('app')
      request.onsuccess = () => { if (holding) keepAlive() }
    }
    keepAlive()
  }, mode)
}

async function releaseStorage(page: Page) {
  await page.evaluate(() => (window as typeof window & { releaseStorage: () => Promise<void> }).releaseStorage())
}

test('a second instance starts with cached cards while the browser holds a readonly transaction', async ({ page, context }) => {
  await createLocalLibrary(page)
  await holdStorage(page, 'readonly')
  const app = await context.newPage()
  try {
    await app.goto('/')
    await expect(app.getByRole('heading', { name: 'Übersicht' })).toBeVisible({ timeout: 2500 })
    await expect(app.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' })).toBeVisible()
  } finally { await releaseStorage(page) }
  // Both instances remain usable and see each other's committed edits.
  await app.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' }).click()
  await draw(app, .7)
  await app.getByRole('button', { name: '3 Karten speichern' }).click()
  await expect(app.getByRole('heading', { name: 'Bibliothek' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bild mit 3 Karten bearbeiten' })).toBeVisible()
})

test('a stalled writer shows browser-tab guidance and recovers automatically without losing queued work', async ({ page, context }) => {
  await createLocalLibrary(page)
  // Bind the local workspace without a cloud session so a real edit is queued
  // but cannot be acknowledged by a background sync during this test.
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('occlude'); r.onsuccess = () => resolve(r.result) })
    await new Promise<void>(resolve => {
      const tx = database.transaction('syncMeta', 'readwrite')
      tx.objectStore('syncMeta').put({ key: 'connection', value: { userId: '00000000-0000-4000-8000-000000000003', email: 'local@example.test', locked: false } })
      tx.oncomplete = () => resolve()
    })
    database.close()
  })
  await page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' }).click()
  await draw(page, .7)
  await page.getByRole('button', { name: '3 Karten speichern' }).click()
  await expect(page.getByRole('heading', { name: 'Bibliothek' })).toBeVisible()
  expect((await localState(page)).pending).toBe(1)
  await holdStorage(page, 'readwrite')
  const app = await context.newPage()
  await app.setViewportSize({ width: 390, height: 844 })
  try {
    await app.goto('/')
    await expect(app.getByRole('status')).toContainText('Dein Lernraum wird vorbereitet')
    await expect(app.getByRole('alert')).toContainText('schließe den Tab', { timeout: 8500 })
    await expect(app.getByRole('button', { name: 'Neu laden' })).toBeVisible()
    expect(await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally { await releaseStorage(page) }
  // No reload/click needed: the original database requests complete.
  await expect(app.getByRole('heading', { name: 'Übersicht' })).toBeVisible({ timeout: 2500 })
  expect(await localState(app)).toEqual({ cards: 3, reviews: 0, pending: 1, locked: false })
  await expect(app.getByRole('alert')).toHaveCount(0)
})

test('an older browser instance blocking a database upgrade gets an immediate, specific message', async ({ page, context }) => {
  await page.route('**/storage-holder', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Old instance</title>' }))
  await page.goto('/storage-holder')
  await page.evaluate(async () => {
    const request = indexedDB.open('occlude', 10) // Dexie v1's native version.
    request.onupgradeneeded = () => {
      const schemas: Record<string, string[]> = {
        decks: ['parentId'], assets: [], images: ['deckId', 'assetHash', '[deckId+assetHash]'],
        regions: ['imageId'], cards: ['regionId', 'imageId'], reviews: ['cardId', 'reviewedAt'], preferences: [],
      }
      for (const [name, indexes] of Object.entries(schemas)) {
        const store = request.result.createObjectStore(name, { keyPath: name === 'assets' ? 'hash' : 'id' })
        for (const index of indexes) store.createIndex(index, index === '[deckId+assetHash]' ? ['deckId', 'assetHash'] : index, { unique: ['[deckId+assetHash]', 'regionId'].includes(index) })
      }
      request.transaction!.objectStore('decks').put({ id: 'existing', name: 'Alter Lernraum', parentId: null, createdAt: 1, updatedAt: 1 })
      request.transaction!.objectStore('preferences').put({ id: 'app', selectedDeckId: null, newLimit: 20, dayBoundary: 4, theme: 'system' })
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    database.onversionchange = () => {} // Simulate an old instance ignoring upgrades.
    ;(window as typeof window & { closeOldStorage: () => void }).closeOldStorage = () => database.close()
  })
  const app = await context.newPage()
  try {
    await app.goto('/')
    await expect(app.getByRole('heading', { name: 'Ein anderer Occlude-Tab blockiert den Start.' })).toBeVisible({ timeout: 2500 })
    await expect(app.getByRole('alert')).toContainText('schließe den Occlude-Tab im Browser')
  } finally {
    await page.evaluate(() => (window as typeof window & { closeOldStorage: () => void }).closeOldStorage())
  }
  await expect(app.getByRole('heading', { name: 'Übersicht' })).toBeVisible({ timeout: 2500 })
  await expect(app.getByRole('heading', { name: 'Alter Lernraum' })).toBeVisible()
  await expect(app.getByRole('alert')).toHaveCount(0)
})
