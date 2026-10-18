import { devices, expect, test, type Page } from '@playwright/test'
import { createLocalLibrary } from './helpers/cloud'

async function expectBottomBackground(page: Page, color: [number, number, number]) {
  const screenshot = await page.screenshot({ animations: 'disabled' })
  const mismatches = await page.evaluate(async ({ encoded, color }) => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
    const ratio = image.naturalWidth / innerWidth
    const inset = Math.round(12 * ratio), height = Math.round(34 * ratio)
    const pixels = ctx.getImageData(inset, image.naturalHeight - height, image.naturalWidth - 2 * inset, height).data
    let mismatches = 0
    for (let i = 0; i < pixels.length; i += 4) if (color.some((value, channel) => pixels[i + channel] !== value)) mismatches++
    return mismatches
  }, { encoded: screenshot.toString('base64'), color })
  expect(mismatches).toBe(0)
}

async function expectContinuousNavigation(page: Page) {
  // A uniform, contrasting backdrop makes a separately filled safe area visible
  // in real pixels. This checks the page canvas, not Android's native system bar.
  const backdrop = await page.evaluateHandle(() => {
    const element = document.createElement('div')
    element.style.cssText = 'position:fixed;inset:0;z-index:19;background:rgb(20,70,100);pointer-events:none'
    element.setAttribute('aria-hidden', 'true'); document.body.append(element)
    return element
  })
  try {
    const box = (await page.getByRole('navigation', { name: 'Mobile Navigation' }).boundingBox())!
    const screenshot = await page.screenshot({ animations: 'disabled' })
    const mismatches = await page.evaluate(async ({ encoded, box }) => {
      const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      const ratio = image.naturalWidth / innerWidth
      const x = Math.round(3 * ratio), width = Math.round(5 * ratio)
      const reference = ctx.getImageData(x, Math.round((box.y + 20) * ratio), width, 1).data
      const pixels = ctx.getImageData(x, image.naturalHeight - Math.round(34 * ratio), width, Math.round(34 * ratio)).data
      let mismatches = 0
      for (let i = 0; i < pixels.length; i += 4) if ([0, 1, 2].some(channel => pixels[i + channel] !== reference[i % (width * 4) + channel])) mismatches++
      return mismatches
    }, { encoded: screenshot.toString('base64'), box })
    expect(mismatches).toBe(0)
  } finally { await backdrop.evaluate(element => element.remove()); await backdrop.dispose() }
}

for (const device of ['Pixel 7', 'iPhone 13']) {
test(`bottom safe area follows the app appearance across scroll and a cold dark launch (${device})`, async ({ browser }) => {
  const context = await browser.newContext({ ...devices[device], colorScheme: 'light', baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  try {
    await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    const session = await context.newCDPSession(page)
    // Native browser emulation of env(safe-area-inset-*), rather than replacing
    // the application's CSS custom properties. This is still not an Android OS bar.
    await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 24, bottom: 34, left: 0, right: 0 } })
    let start!: () => void
    const startupGate = new Promise<void>(resolve => { start = resolve })
    const holdStartup = async (route: import('@playwright/test').Route) => {
      if (route.request().resourceType() === 'script') await startupGate
      return route.fallback()
    }
    await page.route('**/*', holdStartup)
    try {
      await page.goto('/', { waitUntil: 'commit' })
      // A fresh install starts dark even on a light OS, before React or the DB.
      await expect(page.locator('html')).toHaveClass('dark')
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-dark.webmanifest')
      await expectBottomBackground(page, [0, 0, 0])
    } finally { start() }
    const manifest = await (await page.request.get('/manifest.webmanifest')).json()
    expect(manifest.display).toBe('standalone')
    expect(manifest.id).toBe('/')
    expect(manifest.theme_color).toBe('#f5f5f7')
    expect(manifest.background_color).toBe('#f5f5f7')
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dunkel', exact: true })).toHaveAttribute('aria-pressed', 'true')
    for (const [appearance, scheme, background] of [
      ['Dunkel', 'dark', '#000000'],
      ['Hell', 'light', '#f5f5f7'],
      ['Dunkel', 'dark', '#000000'],
    ] as const) {
      await page.getByRole('button', { name: appearance, exact: true }).click()
      await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', scheme)
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', background)
      const manifestPath = scheme === 'dark' ? '/manifest-dark.webmanifest' : '/manifest.webmanifest'
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', manifestPath)
      const active = await (await page.request.get(manifestPath)).json()
      expect(active.theme_color).toBe(background)
      expect(active.background_color).toBe(background)
      expect(active.id).toBe(manifest.id)
      expect(active.scope).toBe(manifest.scope)
      expect(active.start_url).toBe(manifest.start_url)
      expect(active.display).toBe('standalone')
      expect(active.icons).toEqual(manifest.icons)
      await expect.poll(async () => (await session.send('Page.getAppManifest')).url).toContain(manifestPath)
      expect((await session.send('Page.getAppManifest')).errors).toHaveLength(0)
      expect(await page.locator('.main-content').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(62)
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      await expectContinuousNavigation(page)
      if (appearance === 'Hell') {
        await page.reload()
        await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Hell', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(page.locator('html')).not.toHaveClass('dark')
        await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
      }
    }
    await page.screenshot({ path: `test-results/bottom-safe-area-${device.replaceAll(' ', '-')}.png`, animations: 'disabled' })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/*', async route => {
      if (route.request().resourceType() === 'script' && !route.request().isNavigationRequest()) await gate
      return route.fallback()
    })
    try {
      await page.reload({ waitUntil: 'commit' })
      await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-dark.webmanifest')
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      await expectBottomBackground(page, [0, 0, 0])
    } finally { release() }
    await expect(page.getByRole('heading', { name: 'Übersicht', exact: true })).toBeVisible()
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await expectContinuousNavigation(page)
    await createLocalLibrary(page)
    await page.getByRole('button', { name: 'Lernen', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Antwort zeigen' })).toBeVisible()
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    await expectBottomBackground(page, [0, 0, 0])
    await page.getByRole('button', { name: 'Antwort zeigen' }).click()
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    expect(await page.getByRole('button', { name: /^Gut/ }).evaluate(el => el.getBoundingClientRect().bottom <= innerHeight - 34)).toBe(true)
  } finally { await context.close() }
})
}
