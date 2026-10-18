import { devices, expect, test, type CDPSession, type Page } from '@playwright/test'
import { createLocalLibrary } from './helpers/cloud'

type Point = { x: number; y: number }
const frame = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
const matrix = (page: Page) => page.getByTestId('image-surface').evaluate(el => {
  const m = new DOMMatrix(getComputedStyle(el).transform)
  return { zoom: m.a, x: m.e, y: m.f }
})
async function imagePoint(page: Page, point: Point) {
  const image = (await page.getByAltText('Originalbild der Lernkarte').boundingBox())!
  return { x: (point.x - image.x) / image.width, y: (point.y - image.y) / image.height }
}
async function pinch(page: Page, session: CDPSession, focus: Point, from: number, to: number) {
  const points = (distance: number) => [
    { x: focus.x - distance * .4, y: focus.y - distance * .3, id: 1 },
    { x: focus.x + distance * .4, y: focus.y + distance * .3, id: 2 },
  ]
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) })
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + (to - from) * step / 8) })
    await frame(page)
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await frame(page)
}
async function drag(page: Page, session: CDPSession, from: Point, to: Point) {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] })
  for (let step = 1; step <= 5; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 5, y: from.y + (to.y - from.y) * step / 5, id: 1 }] })
    await frame(page)
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

for (const device of ['Pixel 7', 'iPhone 13']) {
  test.describe(`review image (${device})`, () => {
    const { defaultBrowserType: _browserType, ...profile } = devices[device]
    test.use(profile)
    test('uses the screen width and keeps an off-center pinch anchored without exposing empty canvas', async ({ page, context }) => {
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
      const session = await context.newCDPSession(page)
      await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, bottom: 34, left: 0, right: 0 } })
      await createLocalLibrary(page)
      await page.getByRole('button', { name: 'Lernen', exact: true }).click()
      const viewport = page.getByTestId('image-viewport'), surface = page.getByTestId('image-surface')
      await expect(page.getByTestId('target-mask')).toBeVisible()
      await expect(page.locator('.zoom-controls, .review-instruction')).toHaveCount(0)
      await expect(viewport).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      const box = (await viewport.boundingBox())!
      expect(box.x).toBeCloseTo(0, 1)
      expect(box.width).toBeCloseTo(await page.evaluate(() => innerWidth), 1)
      expect((await surface.boundingBox())!.width).toBeCloseTo(box.width, 1)
      const focus = { x: box.x + box.width * .28, y: box.y + box.height * .4 }
      await drag(page, session, focus, { x: focus.x + 50, y: focus.y + 40 })
      expect(await matrix(page)).toEqual({ zoom: 1, x: 0, y: 0 })

      const before = await imagePoint(page, focus)
      await pinch(page, session, focus, 60, 120)
      expect((await matrix(page)).zoom).toBeCloseTo(2, 2)
      const after = await imagePoint(page, focus)
      expect(after.x).toBeCloseTo(before.x, 3)
      expect(after.y).toBeCloseTo(before.y, 3)
      expect((await matrix(page)).x).toBeGreaterThan(20)
      await page.screenshot({ path: `test-results/review-pinch-${device.replaceAll(' ', '-')}.png` })

      // Lift just the first finger, then continue with the remaining finger.
      const a = { x: focus.x - 20, y: focus.y, id: 1 }, b = { x: focus.x + 20, y: focus.y, id: 2 }
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [a] })
      const handoff = await matrix(page)
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...b, x: b.x + 12, y: b.y + 10 }] })
      await frame(page)
      expect((await matrix(page)).x).toBeCloseTo(handoff.x + 12, 3)
      expect((await matrix(page)).y).toBeCloseTo(handoff.y + 10, 3)
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

      // Large drags stop at the image edge instead of showing a gray canvas.
      await drag(page, session, focus, { x: box.x + box.width - 10, y: box.y + box.height - 10 })
      let image = (await surface.boundingBox())!
      expect(image.x).toBeLessThanOrEqual(box.x + .1)
      expect(image.y).toBeLessThanOrEqual(box.y + .1)
      expect(image.x + image.width).toBeGreaterThanOrEqual(box.x + box.width - .1)
      expect(image.y + image.height).toBeGreaterThanOrEqual(box.y + box.height - .1)

      const zoomed = await matrix(page)
      await page.getByRole('button', { name: 'Antwort zeigen' }).click()
      expect(await matrix(page)).toEqual(zoomed)
      await page.getByRole('button', { name: /^Gut/ }).click()
      await expect(page.getByTestId('target-mask')).toBeVisible()
      expect(await matrix(page)).toEqual({ zoom: 1, x: 0, y: 0 })
      await pinch(page, session, focus, 60, 120)
      await pinch(page, session, focus, 120, 30)
      expect(await matrix(page)).toEqual({ zoom: 1, x: 0, y: 0 })
      image = (await surface.boundingBox())!
      expect(image.x).toBeCloseTo(box.x, 1)
      expect(image.width).toBeCloseTo(box.width, 1)
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      expect(await page.getByRole('button', { name: 'Antwort zeigen' }).evaluate(el => el.getBoundingClientRect().bottom <= innerHeight - 34)).toBe(true)
    })
  })
}

test('desktop review has no zoom toolbar and trackpad pinch / Ctrl+wheel follows the cursor', async ({ page, context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLocalLibrary(page)
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await expect(page.locator('.zoom-controls')).toHaveCount(0)
  const box = (await page.getByTestId('image-viewport').boundingBox())!
  const focus = { x: Math.round(box.x + box.width * .3), y: Math.round(box.y + box.height * .35) }
  const before = await imagePoint(page, focus)
  await page.mouse.move(focus.x, focus.y)
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control')
  await expect.poll(async () => (await matrix(page)).zoom).toBeGreaterThan(1.4)
  const after = await imagePoint(page, focus)
  expect(after.x).toBeCloseTo(before.x, 3)
  expect(after.y).toBeCloseTo(before.y, 3)
})
