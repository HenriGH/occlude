import { expect, test, type Page } from '@playwright/test'

const user = { id: '00000000-0000-4000-8000-000000000002', aud: 'authenticated', role: 'authenticated', email: 'student@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-17T12:00:00Z' }
const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*', 'x-supabase-api-version': '2024-01-01' }
async function mockAuth(page: Page, limited = false) {
  const calls = { send: 0, verify: [] as Record<string, unknown>[] }
  // No real email or auth HTTP request may leave these tests.
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
    if (!url.hostname.endsWith('.supabase.co')) return route.abort()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/auth/v1/otp') {
      calls.send++
      return route.fulfill({ status: limited ? 429 : 200, headers, contentType: 'application/json', body: JSON.stringify(limited ? { code: 'over_email_send_rate_limit', error_code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' } : {}) })
    }
    if (url.pathname === '/auth/v1/verify') {
      calls.verify.push(request.postDataJSON())
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ access_token: token, refresh_token: 'test-only-refresh-token', expires_in: 3600, token_type: 'bearer', user }) })
    }
    if (url.pathname === '/auth/v1/user') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(user) })
    return route.abort()
  })
  return calls
}
async function openSettings(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
}
test('an email code signs in through the real SDK without opening a redirect link or sending twice', async ({ page }) => {
  const calls = await mockAuth(page)
  await openSettings(page)
  await page.getByRole('textbox', { name: 'E-Mail-Adresse', exact: true }).fill(user.email)
  await page.getByRole('button', { name: 'Anmelde-E-Mail senden', exact: true }).click()
  await expect(page.getByRole('button', { name: /Erneut anfragen/ })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Code aus der E-Mail' }).fill('642781')
  await page.getByRole('button', { name: 'Mit Code anmelden' }).click()
  await expect(page.getByText('Angemeldet als')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dieses Gerät verbinden', exact: true })).toBeVisible()
  expect(calls.send).toBe(1)
  expect(calls.verify).toEqual([{ email: user.email, token: '642781', type: 'email', gotrue_meta_security: {} }])
})
test('a callback error opens settings; a project mail limit persists across reload and changing the email', async ({ page }) => {
  const calls = await mockAuth(page, true)
  await page.goto('/?error=access_denied&error_code=bad_code_verifier')
  await expect(page.getByRole('heading', { name: 'Cloud-Synchronisierung', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Browser')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse', exact: true }).fill(user.email)
  await page.getByRole('button', { name: 'Anmelde-E-Mail senden', exact: true }).click()
  await expect(page.getByText(/Versandlimit des Projekts/)).toBeVisible()
  await page.goto('/')
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await page.getByRole('textbox', { name: 'E-Mail-Adresse', exact: true }).fill('other@example.test')
  await expect(page.getByRole('button', { name: /Erneut anfragen/ })).toBeDisabled()
  expect(calls.send).toBe(1)
})
