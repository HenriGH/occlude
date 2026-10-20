import { expect, test } from '@playwright/test'
import { cloudFixture, seedWorkspace } from './helpers/cloud'

for (const approve of [true, false]) {
  test(`OAuth connects the correct account only after explicit ${approve ? 'approval' : 'denial'} and returns to ChatGPT`, async ({ page }) => {
    const fixture = await cloudFixture(page)
    const calls: string[] = [], clientId = '00000000-0000-4000-8000-000000000099'
    const authId = 'authorization-fixture'
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': '*', 'content-type': 'application/json' }
    await page.route('**/auth/v1/oauth/authorizations/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (route.request().method() === 'GET') return route.fulfill({ headers, body: JSON.stringify({ authorization_id: authId, redirect_uri: 'https://chatgpt.com/connector_platform/oauth/callback', client: { id: clientId, name: 'ChatGPT', uri: 'https://chatgpt.com', logo_uri: '' }, user: { id: '00000000-0000-4000-8000-000000000003', email: 'background@example.test' }, scope: 'email' }) })
      calls.push(route.request().postDataJSON().action)
      return route.fulfill({ headers, body: JSON.stringify({ redirect_url: `https://chatgpt.com/connector_platform/oauth/callback?${approve ? 'code=fixture' : 'error=access_denied'}&state=fixture` }) })
    })
    await page.route('**/rest/v1/rpc/occlude_authorize_chatgpt_management', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      expect(route.request().postDataJSON()).toEqual({ p_client_id: clientId, p_client_name: 'ChatGPT' })
      calls.push('capability')
      // A PostgreSQL void RPC responds with 204 and no body in production.
      return route.fulfill({ status: 204, headers })
    })
    await page.route('https://chatgpt.com/connector_platform/oauth/callback?**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>Zurück in ChatGPT</h1>' }))
    try {
      await page.goto(`/oauth/consent?authorization_id=${authId}`)
      await page.getByRole('textbox', { name: 'E-Mail-Adresse', exact: true }).fill('background@example.test')
      await page.getByRole('textbox', { name: 'Code aus der E-Mail', exact: true }).fill('123456')
      await page.getByRole('button', { name: 'Mit Code anmelden', exact: true }).click()
      await expect(page.getByText('Neue Ordner und Frage-Antwort-Karten erstellen')).toBeVisible()
      await expect(page.getByText('Ordnernamen und Kartenfragen lesen')).toBeVisible()
      await expect(page.getByText('Auf deinen Auftrag Karten und Ordner samt Inhalt löschen')).toBeVisible()
      expect(calls).toEqual([])
      await page.getByRole('button', { name: approve ? 'Verbinden' : 'Ablehnen', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Zurück in ChatGPT' })).toBeVisible()
      expect(calls).toEqual(approve ? ['capability', 'approve'] : ['deny'])
      expect(page.url()).toContain('state=fixture')
    } finally { fixture.release() }
  })
}

for (const failure of [{ status: 403, code: '42501', text: 'Berechtigung' }, { status: 404, code: 'PGRST202', text: 'Datenbank-Update' }, { status: 0, code: '', text: 'NETZWERK' }]) {
  test(`OAuth displays actionable diagnostics for ${failure.status || 'network'} failures without approving access`, async ({ page }) => {
    const fixture = await cloudFixture(page)
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*', 'content-type': 'application/json' }
    let approvals = 0
    await page.route('**/auth/v1/oauth/authorizations/**', route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (route.request().method() === 'POST') { approvals++; return route.abort() }
      return route.fulfill({ headers, body: JSON.stringify({ authorization_id: 'authorization-fixture', redirect_uri: 'https://chatgpt.com/connector_platform/oauth/callback', client: { id: '00000000-0000-4000-8000-000000000099', name: 'ChatGPT' }, user: { id: '00000000-0000-4000-8000-000000000003' }, scope: 'email' }) })
    })
    await page.route('**/rest/v1/rpc/occlude_authorize_chatgpt_management', route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (!failure.status) return route.abort()
      return route.fulfill({ status: failure.status, headers, body: JSON.stringify({ code: failure.code, message: 'private-token-in-url', details: 'private SQL statement', hint: '' }) })
    })
    try {
      await page.goto('/oauth/consent?authorization_id=authorization-fixture')
      await page.getByRole('textbox', { name: 'E-Mail-Adresse', exact: true }).fill('background@example.test')
      await page.getByRole('textbox', { name: 'Code aus der E-Mail', exact: true }).fill('123456')
      await page.getByRole('button', { name: 'Mit Code anmelden', exact: true }).click()
      await page.getByRole('button', { name: 'Verbinden', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText(failure.text)
      if (failure.status) await expect(page.getByRole('alert')).toContainText(`HTTP ${failure.status} · ${failure.code}`)
      await expect(page.getByRole('alert')).not.toContainText('private-token')
      await expect(page.getByRole('alert')).not.toContainText('private SQL')
      await expect(page.getByRole('button', { name: 'Verbinden', exact: true })).toBeEnabled()
      expect(approvals).toBe(0)
    } finally { fixture.release() }
  })
}


test('disconnect immediately revokes the data capability and then the OAuth grant', async ({ page }) => {
  const fixture = await cloudFixture(page), calls: string[] = []
  const clientId = '00000000-0000-4000-8000-000000000099'
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': '*', 'content-type': 'application/json' }
  let connected = true
  await page.route('**/rest/v1/rpc/occlude_chatgpt_connections', route => route.fulfill({ headers, body: JSON.stringify(connected ? [{ client_id: clientId, name: 'ChatGPT', created_at: new Date().toISOString() }] : []) }))
  await page.route('**/rest/v1/rpc/occlude_revoke_chatgpt', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    expect(route.request().postDataJSON()).toEqual({ p_client_id: clientId })
    calls.push('capability'); connected = false
    return route.fulfill({ status: 204, headers })
  })
  await page.route('**/auth/v1/user/oauth/grants?**', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    expect(new URL(route.request().url()).searchParams.get('client_id')).toBe(clientId)
    calls.push('oauth'); return route.fulfill({ status: 204, headers })
  })
  try {
    fixture.cloud.snapshot = await seedWorkspace(page, false)
    await expect(page.getByRole('button', { name: 'Trennen', exact: true })).toBeVisible()
    await expect(page.getByText('Zum Löschen erst trennen und in ChatGPT neu verbinden.')).toBeVisible()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Trennen', exact: true }).click()
    await expect(page.getByText('Keine Anwendung verbunden.')).toBeVisible()
    await expect.poll(() => calls).toEqual(['capability', 'oauth'])
  } finally { fixture.release() }
})

test('OAuth authorization cannot be clickjacked inside another page', async ({ page, context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('/')
  await page.setContent('<iframe title="embedded-consent" src="/oauth/consent?authorization_id=fixture"></iframe>')
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('alert')).toHaveText('Bitte öffne die Verbindung in einem eigenen Browserfenster.')
  await expect(frame.getByRole('button', { name: 'Verbinden', exact: true })).toHaveCount(0)
})
