import { devices, expect, test } from '@playwright/test'
import { createLocalLibrary, localState } from './helpers/cloud'

const { defaultBrowserType: _browserType, ...phone } = devices['Pixel 7']
test.use(phone)
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

test('a card becoming due during another attempt rejoins this round before completion, offline', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-18T12:00:00Z') })
  await createLocalLibrary(page)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  const target = page.getByTestId('target-mask')
  const first = await target.getAttribute('data-region')
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await page.getByRole('button', { name: /^Nochmal/ }).click()
  await expect(target).not.toHaveAttribute('data-region', first!)
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '2')
  const due = await page.evaluate(async regionId => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('occlude'); request.onsuccess = () => resolve(request.result) })
    const due = await new Promise<number>(resolve => {
      const request = database.transaction('cards').objectStore('cards').index('regionId').get(regionId!)
      request.onsuccess = () => resolve(+request.result.schedule.due)
    })
    database.close(); return due
  }, first)
  await page.clock.setSystemTime(new Date(due + 1000))
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await page.getByRole('button', { name: /^Gut/ }).click()
  await expect(target).toHaveAttribute('data-region', first!)
  await expect(page.getByRole('heading', { name: 'Fertig für jetzt' })).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '3')
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await page.getByRole('button', { name: /^Gut/ }).click()
  await expect(page.getByRole('heading', { name: 'Fertig für jetzt' })).toBeVisible()
  expect(await localState(page)).toMatchObject({ cards: 2, reviews: 3 })
})

test('review centers the image and docks actions safely without shifting on reveal or rotation', async ({ page, context }) => {
  const session = await context.newCDPSession(page)
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, bottom: 34, left: 0, right: 0 } })
  await createLocalLibrary(page)
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await expect(page.getByTestId('target-mask')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lernen beenden' })).toBeVisible()
  await expect(page.locator('.review-header')).toHaveText('')
  const centered = async () => {
    await expect.poll(async () => page.getByTestId('image-viewport').evaluate(el => {
      const r = el.getBoundingClientRect()
      return Math.abs(r.y + r.height / 2 - (innerHeight + 24 - 34) / 2)
    })).toBeLessThan(1)
  }
  const docked = async (name: string | RegExp) => {
    const bottom = await page.getByRole('button', { name }).evaluate(el => el.getBoundingClientRect().bottom)
    const screen = await page.evaluate(() => innerHeight)
    expect(bottom).toBeLessThanOrEqual(screen - 34)
    expect(bottom).toBeGreaterThan(screen - 60)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(screen)
  }
  await centered(); await docked('Antwort zeigen')
  await page.screenshot({ path: 'test-results/review-centered-mobile.png' })
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await centered(); await docked(/^Gut/)
  await page.setViewportSize({ width: 915, height: 412 })
  await centered(); await docked(/^Gut/)
  await page.screenshot({ path: 'test-results/review-centered-landscape.png' })
})
