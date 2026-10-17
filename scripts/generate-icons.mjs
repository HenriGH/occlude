import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Rasterize the exact SVG geometry; no separate hand-maintained bitmap design.
const svg = await readFile(new URL('../public/logo.svg', import.meta.url), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
try {
  const page = await browser.newPage()
  for (const [name, size, scale] of [
    ['icon-192', 192, .8], ['icon-512', 512, .8],
    ['icon-maskable-192', 192, .6], ['icon-maskable-512', 512, .6],
    ['apple-touch-icon', 180, .8],
  ]) {
    const encoded = await page.evaluate(async ({ svg, size, scale }) => {
      const image = new Image()
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const context = canvas.getContext('2d')
      context.fillStyle = '#1d1d1f'
      context.fillRect(0, 0, size, size)
      const margin = size * (1 - scale) / 2
      context.drawImage(image, margin, margin, size * scale, size * scale)
      return canvas.toDataURL('image/png').split(',')[1]
    }, { svg, size, scale })
    await writeFile(new URL(`../public/icons/${name}.png`, import.meta.url), Buffer.from(encoded, 'base64'))
  }
} finally { await browser.close() }
