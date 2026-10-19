import { devices, expect, test, type Page } from '@playwright/test'
import { cloudFixture, createLocalLibrary, localState, seedWorkspace } from './helpers/cloud'

const { defaultBrowserType: _browserType, ...phone } = devices['Pixel 7']
test.use({ ...phone, timezoneId: 'Europe/Berlin' })
const badge = (page: Page) => page.getByRole('img', { name: /^Streak:/ })
const celebration = (page: Page) => page.locator('.streak-celebration')
async function rate(page: Page) {
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await page.getByRole('button', { name: /^Gut/ }).click()
}
async function day(page: Page, date: string) {
  await page.clock.setSystemTime(new Date(date))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
}

test('only the first actual review earns the daily flame; feedback never blocks the next card and does not replay on reload', async ({ page, context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.clock.install({ time: new Date('2026-10-19T10:00:00Z') })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, bottom: 34, left: 0, right: 0 } })
  await createLocalLibrary(page)
  await expect(badge(page)).toHaveAccessibleName(/0 Tage.*Lerne eine Karte/)
  await expect(badge(page)).not.toHaveClass(/active/)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await expect(celebration(page)).toHaveCount(0)
  await page.getByRole('button', { name: /^Gut/ }).click()
  await expect(celebration(page)).toContainText('1 Tag')
  await expect(celebration(page)).toContainText('Streak gestartet')
  await expect(celebration(page)).toHaveCSS('pointer-events', 'none')
  await expect(page.getByRole('button', { name: 'Antwort zeigen' })).toBeVisible()
  await page.screenshot({ path: 'test-results/streak-earned-mobile.png' })
  // The next card remains usable while the first daily celebration is visible.
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await page.getByRole('button', { name: /^Gut/ }).click()
  await page.getByRole('button', { name: 'Lernen beenden' }).click()
  await expect(badge(page)).toHaveAccessibleName('Streak: 1 Tag in Folge. Heute aktiv.')
  await expect(badge(page)).toHaveClass(/active/)
  expect((await localState(page)).reviews).toBe(2)
  await context.setOffline(false)
  await page.reload()
  await expect(badge(page)).toHaveAccessibleName('Streak: 1 Tag in Folge. Heute aktiv.')
  await expect(celebration(page)).toHaveCount(0)
  await page.setViewportSize({ width: 320, height: 640 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeInViewport()
})

test('a new calendar day is gray until reviewed, a missed day resets, and reduced motion keeps feedback static', async ({ page, context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.clock.install({ time: new Date('2026-10-19T10:00:00Z') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await createLocalLibrary(page)
  await rate(page)
  await expect(celebration(page)).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.streak-sparks')).toHaveCSS('display', 'none')
  await page.getByRole('button', { name: 'Lernen beenden' }).click()
  await page.clock.runFor(3600)
  await expect(celebration(page)).toHaveCount(0)
  await day(page, '2026-10-19T22:00:00Z') // Local midnight in Berlin.
  await expect(badge(page)).toHaveAccessibleName(/1 Tag.*Lerne eine Karte/)
  await expect(badge(page)).not.toHaveClass(/active/)
  await rate(page)
  await expect(celebration(page)).toHaveText('2 TageStreak verlängert')
  await page.getByRole('button', { name: 'Lernen beenden' }).click()
  await expect(badge(page)).toHaveAccessibleName('Streak: 2 Tage in Folge. Heute aktiv.')
  await page.clock.runFor(3600)
  await day(page, '2026-10-22T10:00:00Z')
  await expect(badge(page)).toHaveAccessibleName(/0 Tage.*Lerne eine Karte/)
  await rate(page)
  await expect(celebration(page)).toHaveText('1 TagStreak gestartet')
})

test('synchronized historical reviews restore a shared streak without replaying a celebration on login or refresh', async ({ page }) => {
  const fixture = await cloudFixture(page)
  try {
    fixture.cloud.snapshot = await seedWorkspace(page, false)
    const now = new Date()
    const owner = fixture.cloud.snapshot.cards[0].user_id
    const card = fixture.cloud.snapshot.cards[0]
    const created = new Date(now); created.setDate(created.getDate() - 4); card.created_at = created.toISOString()
    fixture.cloud.snapshot.reviews = Array.from({ length: 3 }, (_, i) => {
      const at = new Date(now); at.setDate(at.getDate() - i)
      return { user_id: owner, id: crypto.randomUUID(), card_id: card.id, rating: 3, reviewed_at: at.toISOString(), scheduler_version: 'ts-fsrs@5.4.2/default/fuzz-off' }
    })
    await page.reload()
    await expect(badge(page)).toHaveAccessibleName('Streak: 3 Tage in Folge. Heute aktiv.')
    await expect(celebration(page)).toHaveCount(0)
    await page.reload()
    await expect(badge(page)).toHaveAccessibleName('Streak: 3 Tage in Folge. Heute aktiv.')
    await expect(celebration(page)).toHaveCount(0)
  } finally { fixture.release() }
})
