import { test, expect, devices, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createLocalLibrary, cloudFixture } from './helpers/cloud'

const hostScript = readFileSync('android/app/src/main/assets/host.js', 'utf8')
const back = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('occlude-android-back', { cancelable: true })))

test('Android host passes physical insets, follows the app theme, and preserves the local workflow on Back', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, ...devices['Pixel 7'], colorScheme: 'light' })
  const page = await context.newPage()
  await cloudFixture(page)
  await page.addInitScript(script => {
    const nativeWindow = window as any
    nativeWindow.hostMessages = []
    nativeWindow.OccludeHost = { postMessage: (data: string) => nativeWindow.hostMessages.push(JSON.parse(data)) }
    // Run the actual document-start asset before the HTML root exists.
    eval(script)
  }, hostScript)
  await createLocalLibrary(page)
  const messages = () => page.evaluate(() => (window as any).hostMessages)
  const insets = (bottom: number) => page.evaluate(bottom => {
    ;(window as any).OccludeHost.onmessage({ data: JSON.stringify({ type: 'insets', insets: { top: 84, right: 0, bottom, left: 0 } }) })
  }, bottom)
  await expect(page.locator('html')).toHaveAttribute('data-android-host', '')
  expect(await messages()).toContainEqual({ type: 'ready' })
  await insets(84)
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--safe-bottom'))).toBe('32px')
  expect((await page.getByRole('navigation', { name: 'Mobile Navigation' }).boundingBox())!.height).toBe(96)

  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  for (const [label, dark] of [['Hell', false], ['Dunkel', true]] as const) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect.poll(async () => (await messages()).filter((m: any) => m.type === 'appearance').at(-1)?.dark).toBe(dark)
  }
  await insets(0)
  expect((await page.getByRole('navigation', { name: 'Mobile Navigation' }).boundingBox())!.height).toBe(64)
  await insets(84)
  expect(await back(page)).toBe(false)
  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Mobile Navigation' })
  await nav.getByRole('button', { name: 'Bibliothek' }).click()
  await page.getByRole('button', { name: /^Mein Studium .*2 Karten/ }).click()
  await expect(page.locator('.mobile-folder-path [aria-current="page"]')).toHaveText('Mein Studium')
  expect(await back(page)).toBe(false)
  await expect(page.locator('.mobile-folder-path').getByText('Alle Ordner', { exact: true })).toBeVisible()
  await page.getByRole('main').getByRole('button', { name: 'Neuer Ordner', exact: true }).click()
  expect(await back(page)).toBe(false)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' }).click()
  await expect(page.getByRole('button', { name: '2 Karten speichern' })).toBeVisible()
  await Promise.all([page.waitForEvent('dialog').then(dialog => dialog.dismiss()), back(page)])
  await expect(page.getByRole('button', { name: '2 Karten speichern' })).toBeVisible()
  await Promise.all([page.waitForEvent('dialog').then(dialog => dialog.accept()), back(page)])
  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
  // At the home view the host can background the activity without clearing data.
  expect(await back(page)).toBe(true)
  await context.close()
})

test('the native asset leaves an ordinary browser untouched', async ({ page }) => {
  await cloudFixture(page)
  await page.addInitScript(hostScript)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
  await expect(page.locator('html')).not.toHaveAttribute('data-android-host')
})
