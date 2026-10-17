import { devices, expect, test } from '@playwright/test'
import { cloudFixture, createLocalLibrary, localState, seedWorkspace } from './helpers/cloud'

test('an existing library with nothing due or an empty selected folder never becomes a first-card prompt', async ({ page }) => {
  await createLocalLibrary(page)
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Neue Karten pro Tag' }).fill('0')
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Für heute fertig' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bibliothek öffnen' })).toBeVisible()
  await expect(page.getByText('Noch keine Karten', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Erste Karten erstellen', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/minimal-desktop-dashboard.png', fullPage: true })
  await page.getByRole('button', { name: 'Ordner erstellen', exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Leerer Ordner')
  await page.getByRole('dialog').getByRole('button', { name: 'Ordner erstellen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dieser Ordner ist leer' })).toBeVisible()
  await expect(page.getByText('2 Karten in deiner Bibliothek')).toBeVisible()
  await page.getByRole('button', { name: 'Bibliothek öffnen' }).click()
  await expect(page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' })).toBeVisible()
})

test('a second device shows account recovery while its first pull is stalled, then displays the existing account cards', async ({ page, browser }) => {
  const first = await cloudFixture(page)
  const secondContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  let second: Awaited<ReturnType<typeof cloudFixture>> | undefined
  try {
    const snapshot = await seedWorkspace(page, false)
    first.cloud.snapshot = snapshot
    const auth = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.endsWith('-auth-token')))
    await secondContext.addInitScript(entries => { for (const [key, value] of entries) localStorage.setItem(key, value) }, auth)
    const device = await secondContext.newPage()
    second = await cloudFixture(device)
    second.cloud.snapshot = snapshot; second.cloud.holdSnapshot = true
    await device.goto('/')
    await expect(device.getByText('Verbinde dieses Gerät, um deine Karten zu laden.')).toBeVisible()
    await expect(device.getByText('Noch keine Karten', { exact: true })).toHaveCount(0)
    await device.getByRole('button', { name: 'Cloud öffnen' }).click()
    device.once('dialog', dialog => dialog.accept())
    await device.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true }).click()
    await expect.poll(() => second!.cloud.pulls).toBe(1)
    await device.getByRole('button', { name: 'Übersicht', exact: true }).click()
    await expect(device.getByRole('region', { name: 'Bibliotheksstatus' })).toBeVisible()
    await expect(device.getByText('Noch keine Karten', { exact: true })).toHaveCount(0)
    second.snapshotGate.resolve()
    await expect(device.getByRole('heading', { name: '2 Karten bereit' })).toBeVisible()
    expect((await localState(device)).cards).toBe(2)
    expect(second.cloud.operations).toEqual([])
  } finally { first.release(); second?.release(); await secondContext.close() }
})

for (const deviceName of ['Pixel 7', 'iPhone 13']) {
test(`mobile installation metadata, safe areas, landscape and dark launch (${deviceName})`, async ({ browser }) => {
  const context = await browser.newContext({ ...devices[deviceName], baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  try {
    // No external Auth/Storage request may leave this visual check.
    await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
    const manifest = await (await page.request.get('/manifest.webmanifest')).json()
    expect(manifest.display).toBe('standalone')
    for (const icon of manifest.icons) {
      expect((await page.request.get(icon.src)).ok()).toBe(true)
      const size = await page.evaluate(async src => { const img = new Image(); img.src = src; await img.decode(); return `${img.naturalWidth}x${img.naturalHeight}` }, icon.src)
      expect(size).toBe(icon.sizes)
    }
    expect((await page.request.get('/icons/apple-touch-icon.png')).ok()).toBe(true)
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-top', '47px')
      document.documentElement.style.setProperty('--safe-bottom', '34px')
    })
    await expect(page.locator('.topbar')).toBeHidden()
    expect((await page.getByRole('heading', { name: 'Übersicht', exact: true }).boundingBox())!.y).toBeGreaterThanOrEqual(71)
    expect((await page.getByRole('navigation', { name: 'Mobile Navigation' }).boundingBox())!.height).toBeGreaterThanOrEqual(98)
    expect(await page.locator('.main-content').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(62)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/minimal-${deviceName.replaceAll(' ', '-')}-light.png`, fullPage: true })
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await page.getByRole('button', { name: 'Dunkel', exact: true }).click()
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/*', async route => {
      if (route.request().resourceType() === 'script') await gate
      return route.fallback()
    })
    try {
      await page.reload({ waitUntil: 'commit' })
      await expect(page.locator('html')).toHaveClass('dark')
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000')
      expect(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)')
    } finally { release() }
    await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/minimal-${deviceName.replaceAll(' ', '-')}-dark.png`, fullPage: true })
    await page.setViewportSize({ width: 844, height: 390 })
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-left', '44px')
      document.documentElement.style.setProperty('--safe-right', '44px')
      document.documentElement.style.setProperty('--safe-bottom', '21px')
    })
    await expect(page.getByRole('navigation', { name: 'Mobile Navigation' })).toBeVisible()
    await expect(page.locator('.sidebar')).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await page.getByRole('heading', { name: 'Übersicht', exact: true }).boundingBox())!.x).toBeGreaterThanOrEqual(64)
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)')
    await page.screenshot({ path: `test-results/minimal-${deviceName.replaceAll(' ', '-')}-landscape.png`, fullPage: true })
  } finally { await context.close() }
})
}
