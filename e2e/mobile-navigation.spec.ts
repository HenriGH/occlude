import { devices, expect, test, type CDPSession, type Page } from '@playwright/test'
import { createLocalLibrary, draw, localState } from './helpers/cloud'

async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
}
async function touchDrag(page: Page, session: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] })
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 10, y: from.y + (to.y - from.y) * step / 10, id: 1 }] })
    await frame(page)
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await frame(page)
}
async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'Neuer Ordner', exact: true }).tap()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Ordner erstellen', exact: true }).tap()
  await expect(page.getByRole('navigation', { name: 'Ordnerpfad' }).getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
}

for (const device of ['Pixel 7', 'iPhone 13']) {
  test.describe(`mobile tabs (${device})`, () => {
    const { defaultBrowserType: _browserType, ...profile } = devices[device]
    test.use(profile)
    test.beforeEach(async ({ context, page }) => {
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
      const session = await context.newCDPSession(page)
      await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, bottom: 34, left: 0, right: 0 } })
    })

    test('two bottom tabs replace the mobile drawer; nested folders, settings and creation remain reachable', async ({ page, context }) => {
      await page.goto('/')
      const tabs = page.getByRole('navigation', { name: 'Mobile Navigation' })
      const overview = tabs.getByRole('button', { name: 'Übersicht', exact: true })
      const library = tabs.getByRole('button', { name: 'Bibliothek', exact: true })
      await expect(overview).toHaveAttribute('aria-current', 'page')
      await page.getByRole('button', { name: 'Einstellungen', exact: true }).tap()
      await page.getByRole('button', { name: 'Hell', exact: true }).tap()
      await overview.tap()
      await expect(tabs.getByRole('button')).toHaveCount(2)
      await expect(page.locator('.sidebar')).toBeHidden()
      await expect(page.locator('.topbar')).toBeHidden()
      await expect(page.getByRole('button', { name: 'Menü öffnen' })).toHaveCount(0)
      expect((await overview.boundingBox())!.x).toBeLessThan((await library.boundingBox())!.x)
      expect(await library.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight - 34)).toBe(true)

      // No app gesture claims the left edge or opens a hidden drawer.
      await touchDrag(page, await context.newCDPSession(page), { x: 24, y: 250 }, { x: 180, y: 255 })
      await expect(page.locator('.sidebar')).toBeHidden()
      await expect(overview).toHaveAttribute('aria-current', 'page')
      await library.tap()
      const path = page.getByRole('navigation', { name: 'Ordnerpfad' })
      await expect(library).toHaveAttribute('aria-current', 'page')
      await expect(path.getByRole('button', { name: 'Alle Ordner', exact: true })).toHaveAttribute('aria-current', 'page')
      await page.getByRole('button', { name: /^Mein Studium .*Leer/ }).tap()
      await expect(path.getByRole('button', { name: 'Mein Studium', exact: true })).toHaveAttribute('aria-current', 'page')
      await createFolder(page, 'Anatomie')
      await createFolder(page, 'Herz – sehr langer Unterordner')
      await expect(path.getByRole('button', { name: 'Herz – sehr langer Unterordner', exact: true })).toBeInViewport()
      await path.getByRole('button', { name: 'Anatomie', exact: true }).tap()
      await expect(page.getByRole('button', { name: /^Herz .*Leer/ })).toBeVisible()
      await path.getByRole('button', { name: 'Alle Ordner', exact: true }).tap()
      await expect(page.getByRole('button', { name: /^Mein Studium .*Leer/ })).toBeVisible()
      await page.getByRole('button', { name: /^Mein Studium .*Leer/ }).tap()
      // Re-tapping Bibliothek returns directly to the top-level folders.
      await library.tap()
      await expect(path.getByRole('button', { name: 'Alle Ordner', exact: true })).toHaveAttribute('aria-current', 'page')
      await page.screenshot({ path: `test-results/mobile-library-${device.replaceAll(' ', '-')}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Karte erstellen', exact: true }).tap()
      await expect(page.getByRole('heading', { name: 'Neue Karte', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Einstellungen', exact: true }).tap()
      await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Dunkel', exact: true }).tap()
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      const lastAction = page.getByRole('button', { name: 'Dauerhaften Speicher anfragen' })
      expect((await lastAction.boundingBox())!.y + (await lastAction.boundingBox())!.height).toBeLessThan((await tabs.boundingBox())!.y)
      await overview.tap()
      await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
      await expect(overview).toHaveAttribute('aria-current', 'page')
      expect(await page.evaluate(() => scrollY)).toBe(0)
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      await page.screenshot({ path: `test-results/mobile-tabs-${device.replaceAll(' ', '-')}-dark.png`, fullPage: true })
      await page.setViewportSize({ width: 320, height: 640 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeInViewport()
    })

    test('tab navigation protects drafts, touch editing still works, and learning uses the full available screen', async ({ page, context }) => {
      const session = await context.newCDPSession(page)
      await createLocalLibrary(page)
      const tabs = page.getByRole('navigation', { name: 'Mobile Navigation' })
      await page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' }).tap()
      const surface = page.getByTestId('image-surface')
      await surface.scrollIntoViewIfNeeded()
      let box = (await surface.boundingBox())!
      await touchDrag(page, session, { x: box.x + box.width * .1, y: box.y + box.height * .62 }, { x: box.x + box.width * .5, y: box.y + box.height * .7 })
      await expect(page.getByRole('button', { name: '3 Karten speichern' })).toBeVisible()
      const selectedMask = page.getByTestId('occlusion-mask').filter({ has: page.locator('[data-resize]') })
      const selectedId = await selectedMask.getAttribute('data-region')
      await expect(selectedMask.locator('[data-resize]')).toBeVisible()
      const corner = (await selectedMask.locator('[data-resize]').boundingBox())!
      await touchDrag(page, session, { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }, { x: corner.x + corner.width / 2 + box.width * .08, y: corner.y + corner.height / 2 + box.height * .06 })
      await expect(page.getByTestId('occlusion-mask')).toHaveCount(3)
      await expect(selectedMask).toHaveAttribute('data-region', selectedId!)
      expect(await selectedMask.evaluate(el => parseFloat(el.style.width))).toBeCloseTo(48, 0)
      expect(await selectedMask.evaluate(el => parseFloat(el.style.height))).toBeCloseTo(14, 0)
      await expect(page.getByRole('button', { name: 'Maske zeichnen (R)', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(tabs.locator('[aria-current="page"]')).toHaveCount(0)
      for (const name of ['Bibliothek', 'Übersicht']) {
        page.once('dialog', dialog => dialog.dismiss())
        await tabs.getByRole('button', { name, exact: true }).click()
        await expect(page.getByRole('button', { name: '3 Karten speichern' })).toBeVisible()
      }
      page.once('dialog', dialog => dialog.accept())
      await tabs.getByRole('button', { name: 'Übersicht', exact: true }).tap()
      await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
      expect((await localState(page)).cards).toBe(2)
      await tabs.getByRole('button', { name: 'Bibliothek', exact: true }).tap()
      await page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' }).tap()
      await page.getByRole('button', { name: 'Bild verschieben (H)', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Bild verschieben (H)', exact: true })).toHaveAttribute('aria-pressed', 'true')
      box = (await surface.boundingBox())!
      const center = { x: box.x + box.width * .5, y: box.y + box.height * .5 }
      await touchDrag(page, session, center, { x: center.x + 50, y: center.y + 20 })
      await expect(surface).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 50, 20)')
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x - 30, y: center.y, id: 1 }, { x: center.x + 30, y: center.y, id: 2 }] })
      for (let step = 1; step <= 5; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x - 30 - step * 6, y: center.y, id: 1 }, { x: center.x + 30 + step * 6, y: center.y, id: 2 }] })
        await frame(page)
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.locator('.zoom-controls')).toContainText('200 %')
      await page.getByRole('button', { name: 'Ansicht zurücksetzen', exact: true }).click()
      await page.getByRole('button', { name: 'Maske zeichnen (R)', exact: true }).click()
      await draw(page, .7)
      await page.getByRole('button', { name: '3 Karten speichern' }).click()
      await expect(page.getByRole('heading', { name: 'Bibliothek', exact: true })).toBeVisible()
      await expect(page.locator('.toast')).toBeVisible()
      expect((await page.locator('.toast').boundingBox())!.y + (await page.locator('.toast').boundingBox())!.height).toBeLessThan((await tabs.boundingBox())!.y)
      await page.getByRole('button', { name: 'Lernen', exact: true }).tap()
      await expect(tabs).toHaveCount(0)
      await page.getByRole('button', { name: 'Antwort zeigen' }).tap()
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      expect(await page.getByRole('button', { name: /^Gut/ }).evaluate(el => el.getBoundingClientRect().bottom <= innerHeight - 34)).toBe(true)
      await page.getByRole('button', { name: 'Lernen beenden', exact: true }).tap()
      await expect(tabs).toBeVisible()
      expect((await localState(page)).cards).toBe(3)
    })
  })
}
