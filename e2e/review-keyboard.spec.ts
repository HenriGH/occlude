import { expect, test } from '@playwright/test'
import { createLocalLibrary, localState } from './helpers/cloud'

test('Space reveals, arrows select ratings, held Space cannot rate the revealed card, and numbers still work', async ({ page }) => {
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLocalLibrary(page)
  await page.getByRole('button', { name: 'Lernen', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Antwort zeigen' })).toBeVisible()
  await page.keyboard.down('Space')
  await expect(page.getByRole('button', { name: /^Gut/ })).toBeFocused()
  await page.keyboard.down('Space') // repeated keydown while holding the reveal key
  await page.keyboard.up('Space')
  expect((await localState(page)).reviews).toBe(0)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: /^Schwer/ })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('button', { name: /^Nochmal/ })).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('button', { name: /^Einfach/ })).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: /^Gut/ })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Antwort zeigen' })).toBeVisible()
  expect((await localState(page)).reviews).toBe(1)
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /^Gut/ })).toBeFocused()
  await page.keyboard.press('4')
  await expect(page.getByRole('heading', { name: 'Fertig für jetzt' })).toBeVisible()
  expect((await localState(page)).reviews).toBe(2)
  const ratings = await page.evaluate(() => new Promise<number[]>((resolve, reject) => {
    const open = indexedDB.open('occlude')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const database = open.result, request = database.transaction('reviews').objectStore('reviews').getAll()
      request.onsuccess = () => { resolve(request.result.map(row => row.rating).sort()); database.close() }
      request.onerror = () => reject(request.error)
    }
  }))
  expect(ratings).toEqual([3, 4])
})
