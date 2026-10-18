import { expect, test } from '@playwright/test'
import { createLocalLibrary } from './helpers/cloud'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
})

test('a mask question survives saving and reload, stays visible after reveal, and can be removed on mobile', async ({ page }) => {
  await createLocalLibrary(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Bild mit 2 Karten bearbeiten' }).click()
  await page.getByRole('button', { name: 'Maske 2 löschen' }).click()
  await page.getByRole('button', { name: 'Maske 1 auswählen' }).click()
  await page.getByRole('textbox', { name: 'Frage (optional)' }).fill('Welche Struktur ist markiert?')
  await expect(page.getByTestId('occlusion-mask')).toContainText('Welche Struktur ist markiert?')
  await page.getByRole('button', { name: '1 Karte speichern' }).click()
  await expect(page.getByRole('heading', { name: 'Bibliothek' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Bild mit 1 Karten bearbeiten' }).click()
  await page.getByRole('button', { name: 'Maske 1 auswählen' }).click()
  await expect(page.getByRole('textbox', { name: 'Frage (optional)' })).toHaveValue('Welche Struktur ist markiert?')
  await page.getByRole('button', { name: '1 Karte speichern' }).click()
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welche Struktur ist markiert?' })).toHaveCount(0)
  await expect(page.getByText('Welche Struktur ist markiert?', { exact: true })).toHaveCount(1)
  await expect(page.getByTestId('target-mask')).toContainText('Welche Struktur ist markiert?')
  await expect.poll(() => page.locator('.mask-question').evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-mask-question.png', fullPage: true })
  await page.getByRole('button', { name: 'Antwort zeigen' }).click()
  await expect(page.getByTestId('target-mask')).toHaveCount(0)
  await expect(page.locator('.review-question')).toHaveText('Welche Struktur ist markiert?')
  await expect(page.getByText('Welche Struktur ist markiert?', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Lernen beenden' }).click()
  await page.getByRole('button', { name: 'Bild mit 1 Karten bearbeiten' }).click()
  await page.getByRole('button', { name: 'Maske 1 auswählen' }).click()
  await page.getByRole('textbox', { name: 'Frage (optional)' }).fill('')
  await page.getByRole('button', { name: '1 Karte speichern' }).click()
  await expect(page.getByRole('heading', { name: 'Bibliothek' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await expect(page.locator('.review-instruction, .review-question')).toHaveCount(0)
  await expect(page.getByTestId('target-mask')).toHaveText('?')
})

test('browser and installed icons use the white/green logo regardless of the system appearance', async ({ page }) => {
  await page.goto('/')
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href')
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const src of [favicon, apple, ...manifest.icons.map((icon: { src: string }) => icon.src)]) {
      const pixels = await page.evaluate(async src => {
        const image = new Image(); image.src = src!; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, 192, 192)
        const data = ctx.getImageData(0, 0, 192, 192).data
        let white = 0, green = 0, dark = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] === 245 && data[i + 1] === 245 && data[i + 2] === 247) white++
          if (data[i] === 189 && data[i + 1] === 226 && data[i + 2] === 135) green++
          if (data[i] === 29 && data[i + 1] === 29 && data[i + 2] === 31) dark++
        }
        return { white, green, dark }
      }, src)
      expect(pixels.white).toBeGreaterThan(100)
      expect(pixels.green).toBeGreaterThan(100)
      expect(pixels.dark).toBeGreaterThan(1000)
    }
  }
})
