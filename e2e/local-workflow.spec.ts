import { expect, test, type Page } from '@playwright/test'

async function screenshot(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 650
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 650)
    ctx.fillStyle = '#254c3c'; ctx.font = 'bold 34px sans-serif'; ctx.fillText('Anatomie · Das Herz', 55, 70)
    ctx.font = '25px sans-serif'
    ;['Rechter Vorhof', 'Linke Herzkammer', 'Aorta'].forEach((s, i) => ctx.fillText(s, 90, 180 + i * 130))
    return canvas.toDataURL('image/png').split(',')[1]
  })
}
async function upload(page: Page) {
  const png = await screenshot(page)
  await page.getByLabel('Bild hochladen').setInputFiles({ name: 'lecture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('heading', { name: 'Masken zeichnen' })).toBeVisible()
}
async function draw(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('image-surface').boundingBox())!
  await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * (x + .32), box.y + box.height * (y + .09), { steps: 8 })
  await page.mouse.up()
}
async function counts(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('occlude'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const stores = ['images', 'assets', 'cards', 'regions', 'reviews']
    const result: Record<string, number> = {}
    for (const store of stores) result[store] = await new Promise((resolve, reject) => { const r = database.transaction(store).objectStore(store).count(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    database.close(); return result
  })
}

test('A: native screenshot paste creates three independent cards, review persists, and masks align on mobile', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible()
  const png = await screenshot(page)
  await page.evaluate(async base64 => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }, png)
  await page.keyboard.press('Control+V')
  await expect(page.getByRole('heading', { name: 'Masken zeichnen' })).toBeVisible()
  await draw(page, .07, .21); await draw(page, .07, .41); await draw(page, .07, .61)
  await expect(page.getByTestId('occlusion-mask')).toHaveCount(3)
  await page.getByRole('button', { name: '3 Karten speichern' }).click()
  await expect(page.getByRole('heading', { name: 'Bibliothek' })).toBeVisible()
  expect(await counts(page)).toEqual({ images: 1, assets: 1, cards: 3, regions: 3, reviews: 0 })
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await expect(page.getByTestId('target-mask')).toHaveCount(1)
  await expect(page.getByTestId('occlusion-mask')).toHaveCount(2)
  await page.setViewportSize({ width: 390, height: 844 })
  const geometry = async () => page.getByTestId('target-mask').evaluate(el => {
    const mask = el.getBoundingClientRect(); const surface = el.parentElement!.getBoundingClientRect()
    return { x: (mask.x - surface.x) / surface.width, y: (mask.y - surface.y) / surface.height, width: mask.width / surface.width }
  })
  const before = await geometry()
  expect(before.x).toBeCloseTo(.07, 2); expect(before.width).toBeCloseTo(.32, 2)
  const imageBounds = (await page.getByAltText('Originalbild der Lernkarte').boundingBox())!
  expect(imageBounds.width / imageBounds.height).toBeCloseTo(1000 / 650, 2)
  await page.getByRole('button', { name: 'Vergrößern', exact: true }).click()
  const view = (await page.getByTestId('image-viewport').boundingBox())!
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2); await page.mouse.down(); await page.mouse.move(view.x + view.width / 2 + 30, view.y + view.height / 2 + 20); await page.mouse.up()
  const after = await geometry()
  expect(after.x).toBeCloseTo(before.x, 3); expect(after.y).toBeCloseTo(before.y, 3); expect(after.width).toBeCloseTo(before.width, 3)
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await expect(page.getByTestId('target-mask')).toHaveCount(0)
  await expect(page.getByTestId('occlusion-mask')).toHaveCount(2)
  await page.getByRole('button', { name: /^Gut/ }).click()
  await expect(page.getByTestId('target-mask')).toHaveCount(1)
  expect((await counts(page)).reviews).toBe(1)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await page.getByRole('button', { name: /^Einfach/ }).click()
  expect((await counts(page)).reviews).toBe(2)
  await context.setOffline(false)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible()
  expect((await counts(page)).reviews).toBe(2)
  await page.screenshot({ path: 'test-results/mobile-dashboard.png', fullPage: true })
  expect(errors).toEqual([])
})

test('E: nested deck aggregation, selected deck persistence, and history-preserving mask edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Anatomie')
  await page.getByRole('dialog').getByRole('button', { name: 'Ordner erstellen', exact: true }).click()
  await upload(page); await draw(page, .1, .2); await draw(page, .1, .5)
  await page.getByRole('button', { name: '2 Karten speichern' }).click()
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await page.getByRole('button', { name: /^Gut/ }).click()
  await page.getByRole('button', { name: 'Lernen beenden' }).click()
  await page.getByRole('button', { name: 'Bibliothek' }).click()
  await page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' }).click()
  await page.getByRole('button', { name: 'Maske bearbeiten (V)', exact: true }).click()
  const mask = (await page.getByTestId('occlusion-mask').first().boundingBox())!
  await page.mouse.move(mask.x + mask.width / 2, mask.y + mask.height / 2)
  await page.mouse.down(); await page.mouse.move(mask.x + mask.width / 2 + 20, mask.y + mask.height / 2 + 10, { steps: 5 }); await page.mouse.up()
  await page.getByRole('button', { name: 'Maske 2 löschen' }).click()
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click()
  await page.getByRole('button', { name: '2 Karten speichern' }).click()
  expect((await counts(page)).reviews).toBe(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Anatomie/ })).toBeVisible()
  await page.getByRole('navigation', { name: 'Ordner', exact: true }).getByRole('button', { name: 'Mein Studium', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' })).toBeVisible()
  await page.getByRole('button', { name: 'Ausgewählten Ordner bearbeiten' }).click()
  await expect(page.getByLabel('Übergeordneter Ordner').getByRole('option', { name: /Anatomie/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'test-results/desktop-library.png', fullPage: true })
})

test('replacing an unsaved screenshot with identical content starts a fresh draft', async ({ page }) => {
  await page.goto('/')
  await upload(page); await draw(page, .1, .2)
  await expect(page.getByTestId('occlusion-mask')).toHaveCount(1)
  page.once('dialog', dialog => dialog.accept())
  await upload(page)
  await expect(page.getByTestId('occlusion-mask')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '0 Karten speichern' })).toBeDisabled()
  await draw(page, .1, .5)
  await page.getByRole('button', { name: '1 Karte speichern' }).click()
  expect((await counts(page)).cards).toBe(1)
})

test('file validation, settings and mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByLabel('Bild hochladen').setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
  await expect(page.getByRole('alert')).toContainText('PNG-, JPEG- oder WebP')
  await page.getByRole('button', { name: 'Meldung schließen' }).click()
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Neue Karten pro Tag' }).fill('5')
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click()
  await expect(page.locator('html')).toHaveClass('dark')
  await page.reload()
  await expect(page.locator('html')).toHaveClass('dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('cloud configuration is visible and signed-out cache stays locked without losing cards', async ({ page }) => {
  await page.goto('/')
  await upload(page); await draw(page, .1, .2)
  await page.getByRole('button', { name: '1 Karte speichern' }).click()
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cloud-Synchronisierung', exact: true })).toBeVisible()
  const email = page.getByRole('textbox', { name: 'E-Mail-Adresse', exact: true })
  if (await email.count()) {
    await expect(email).toBeVisible()
    await expect(page.getByRole('button', { name: 'Anmelde-E-Mail senden', exact: true })).toBeDisabled()
  } else await expect(page.getByText(/Kopiere .env.example/)).toBeVisible()
  await page.screenshot({ path: 'test-results/cloud-settings.png', fullPage: true })
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('occlude'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('syncMeta', 'readwrite')
      tx.objectStore('syncMeta').put({ key: 'connection', value: { userId: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test', locked: true } })
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    database.close()
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dein Lernraum ist gesperrt.', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bild mit 1 Karten bearbeiten' })).toHaveCount(0)
  expect((await counts(page)).cards).toBe(1)
})
