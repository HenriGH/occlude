import { devices, expect, test, type CDPSession, type Page } from '@playwright/test'
import { createLocalLibrary } from './helpers/cloud'

type Point = { x: number; y: number }
async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
}
async function swipe(page: Page, session: CDPSession, from: Point, to: Point, cancel = false) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] })
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 10, y: from.y + (to.y - from.y) * step / 10, id: 1 }] })
    await frame(page)
  }
  await session.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
  await frame(page)
}

for (const device of ['Pixel 7', 'iPhone 13']) {
  test.describe(`edge navigation (${device})`, () => {
    const { defaultBrowserType: _browserType, ...profile } = devices[device]
    test.use(profile)
    test.beforeEach(async ({ context }) => {
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    })

    test('only an intentional right swipe at the edge opens the drawer; scrolling and taps still work', async ({ page, context }) => {
      const session = await context.newCDPSession(page)
      await page.goto('/')
      const menu = page.getByRole('button', { name: 'Menü öffnen' })
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      // Use trusted touch input, so browser panning/cancellation participates.
      await swipe(page, session, { x: 150, y: 300 }, { x: 280, y: 305 })
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await swipe(page, session, { x: 24, y: 300 }, { x: 49, y: 300 })
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await swipe(page, session, { x: 24, y: 300 }, { x: 6, y: 300 })
      await swipe(page, session, { x: 24, y: 300 }, { x: 180, y: 300 }, true)
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      // A second finger abandons navigation, even if the first continues right.
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 24, y: 300, id: 1 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 24, y: 300, id: 1 }, { x: 100, y: 350, id: 2 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 300, id: 1 }, { x: 250, y: 350, id: 2 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(menu).toHaveAttribute('aria-expanded', 'false')

      await swipe(page, session, { x: 24, y: 300 }, { x: 180, y: 310 })
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByRole('navigation', { name: 'Ordner', exact: true })).toBeVisible()
      await page.screenshot({ path: `test-results/edge-swipe-${device.replaceAll(' ', '-')}.png`, animations: 'disabled' })
      await page.getByRole('button', { name: 'Einstellungen', exact: true }).tap()
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible()
      await page.evaluate(() => scrollTo(0, 0))
      await swipe(page, session, { x: 24, y: 600 }, { x: 28, y: 280 })
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(80)
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      // Opening works at the current scroll position as well as on first paint.
      await swipe(page, session, { x: 24, y: 300 }, { x: 180, y: 310 })
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await page.locator('.sidebar-scrim').tap({ position: { x: 370, y: 400 } })
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await menu.tap()
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await page.getByRole('button', { name: 'Übersicht', exact: true }).tap()
      await page.getByRole('button', { name: 'Übersicht', exact: true }).waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: 'Neuer Ordner', exact: true }).tap()
      await expect(page.getByRole('dialog')).toBeVisible()
      // A modal dialog must retain ownership of the page.
      await swipe(page, session, { x: 24, y: 300 }, { x: 180, y: 310 })
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
    })

    test('editor touch drawing, panning and pinch remain available; reviews do not open a hidden drawer', async ({ page, context }) => {
      const session = await context.newCDPSession(page)
      await createLocalLibrary(page)
      await page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' }).tap()
      const surface = page.getByTestId('image-surface')
      await surface.scrollIntoViewIfNeeded()
      await page.getByRole('button', { name: 'Maske zeichnen (R)', exact: true }).tap()
      await expect(page.getByRole('button', { name: 'Maske zeichnen (R)', exact: true })).toHaveAttribute('aria-pressed', 'true')
      let box = (await surface.boundingBox())!
      await swipe(page, session, { x: box.x + box.width * .1, y: box.y + box.height * .7 }, { x: box.x + box.width * .5, y: box.y + box.height * .8 })
      await expect(page.getByRole('button', { name: '3 Karten speichern' })).toBeVisible()
      const menu = page.getByRole('button', { name: 'Menü öffnen' })
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await page.getByRole('button', { name: 'Bild verschieben (H)', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Bild verschieben (H)', exact: true })).toHaveAttribute('aria-pressed', 'true')
      box = (await surface.boundingBox())!
      await swipe(page, session, { x: 24, y: box.y + box.height * .5 }, { x: 114, y: box.y + box.height * .5 })
      await expect(surface).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 90, 0\)/)
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await page.getByRole('button', { name: 'Ansicht zurücksetzen', exact: true }).click()
      await expect(surface).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
      box = (await surface.boundingBox())!
      const center = { x: box.x + box.width * .5, y: box.y + box.height * .5 }
      await swipe(page, session, center, { x: center.x + 50, y: center.y + 20 })
      await expect(surface).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 50, 20\)/)
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x - 30, y: center.y, id: 1 }, { x: center.x + 30, y: center.y, id: 2 }] })
      for (let step = 1; step <= 5; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x - 30 - step * 6, y: center.y, id: 1 }, { x: center.x + 30 + step * 6, y: center.y, id: 2 }] })
        await frame(page)
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.locator('.zoom-controls')).toContainText('200 %')
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      // Open and dismiss without navigating: the unsaved draft remains intact.
      await swipe(page, session, { x: 24, y: 170 }, { x: 180, y: 175 })
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await page.locator('.sidebar-scrim').tap({ position: { x: 370, y: 400 } })
      await page.getByRole('button', { name: '3 Karten speichern' }).tap()
      await page.getByRole('button', { name: 'Lernen', exact: true }).tap()
      await expect(page.getByRole('button', { name: 'Antwort zeigen' })).toBeVisible()
      await swipe(page, session, { x: 24, y: 170 }, { x: 180, y: 175 })
      await expect(page.locator('.sidebar')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Antwort zeigen' })).toBeVisible()
    })
  })
}
