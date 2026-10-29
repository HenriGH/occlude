// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseTransport } from './transport'
import type { WireOperation } from './model'

afterEach(() => { vi.unstubAllGlobals() })
function fixture() {
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token-a', user: { id: 'a' } } } }),
    getUser: vi.fn(async (token: string) => ({ data: { user: { id: token === 'token-b' ? 'b' : 'a' } }, error: null })),
  }
  const requests: { path: string; token: string | null }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    requests.push({ path: new URL(input).pathname, token: new Headers(init?.headers).get('authorization') })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }))
  const transport = supabaseTransport({ auth } as unknown as SupabaseClient, { url: 'https://test.supabase.co', key: 'public-test-key' })
  return { auth, requests, transport }
}
const operation: WireOperation = { id: 'op', deviceId: 'device', kind: 'deck.put', entityId: 'deck', baseVersion: 1, payload: {} }
describe('verified token reuse and account isolation', () => {
  it('shares one verification across concurrent requests, reusing it until the access token changes', async () => {
    const { auth, requests, transport } = fixture()
    await Promise.all([transport.userId(), transport.snapshot('a'), transport.apply(operation, 'a')])
    await transport.snapshot('a')
    expect(auth.getUser).toHaveBeenCalledTimes(1)
    expect(requests.map(r => r.token)).toEqual(['Bearer token-a', 'Bearer token-a', 'Bearer token-a'])
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'token-a-refreshed', user: { id: 'a' } } } })
    await transport.apply(operation, 'a')
    expect(auth.getUser).toHaveBeenCalledTimes(2)
    expect(requests.at(-1)?.token).toBe('Bearer token-a-refreshed')
  })
  it('rejects another account before a mutation, even after caching the original account', async () => {
    const { auth, requests, transport } = fixture()
    await transport.snapshot('a')
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'token-b', user: { id: 'b' } } } })
    await expect(transport.apply(operation, 'a')).rejects.toThrow(/Konto/)
    expect(requests).toHaveLength(1)
    // A stale/spoofed local user object must not override the verified token owner.
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'token-b', user: { id: 'a' } } } })
    await expect(transport.apply(operation, 'a')).rejects.toThrow(/Konto/)
    expect(requests).toHaveLength(1)
  })
  it('does not cache a failed token verification and never reuses it after sign-out', async () => {
    const { auth, requests, transport } = fixture()
    auth.getUser.mockRejectedValueOnce(new Error('Offline'))
    await expect(transport.snapshot('a')).rejects.toThrow('Offline')
    await transport.snapshot('a')
    expect(auth.getUser).toHaveBeenCalledTimes(2)
    auth.getSession.mockResolvedValue({ data: { session: null } })
    await expect(transport.apply(operation, 'a')).rejects.toThrow(/anmelden/)
    expect(requests).toHaveLength(1)
  })
})


it('falls back to the legacy snapshot only when the new RPC is absent, not on arbitrary failures', async () => {
  const { transport, requests } = fixture()
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = new URL(input as string).pathname
    requests.push({ path, token: new Headers(init?.headers).get('authorization') })
    return (/_v[23]$/.test(path)) ? Response.json({ code: 'PGRST202', message: 'Missing function' }, { status: 404 }) : Response.json({ schemaVersion: 1 })
  })
  expect(await transport.snapshot('a')).toEqual({ schemaVersion: 1 })
  expect(requests.map(r => r.path)).toEqual(['/rest/v1/rpc/occlude_snapshot_v3', '/rest/v1/rpc/occlude_snapshot_v2', '/rest/v1/rpc/occlude_snapshot'])
  requests.length = 0
  vi.mocked(fetch).mockImplementation(async () => Response.json({ code: '42501', message: 'Denied' }, { status: 403 }))
  const before = vi.mocked(fetch).mock.calls.length
  await expect(transport.snapshot('a')).rejects.toThrow('Denied')
  expect(vi.mocked(fetch).mock.calls.length - before).toBe(1)
})
