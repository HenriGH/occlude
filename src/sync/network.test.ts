// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { cloudFetch } from './network'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it.each([['/auth/v1/token', 20000], ['/rest/v1/rpc/occlude_snapshot', 20000], ['/storage/v1/object/occlude-images/image', 90000]] as const)('bounds a stalled %s request and cleans up its timer', async (path, timeout) => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
  })))
  const request = expect(cloudFetch(`https://test.supabase.co${path}`)).rejects.toMatchObject({ name: 'TimeoutError' })
  await vi.advanceTimersByTimeAsync(timeout)
  await request
  expect(vi.getTimerCount()).toBe(0)
})
it('preserves caller cancellation and releases the timeout after a successful request', async () => {
  vi.useFakeTimers()
  const parent = new AbortController()
  vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => {
    expect(options.signal!.aborted).toBe(true)
    throw options.signal!.reason
  }))
  parent.abort(new Error('Cancelled'))
  await expect(cloudFetch('https://test.supabase.co/rest/v1/', { signal: parent.signal })).rejects.toThrow('Cancelled')
  expect(vi.getTimerCount()).toBe(0)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  const response = await cloudFetch('https://test.supabase.co/rest/v1/')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({})
  expect(vi.getTimerCount()).toBe(0)
})
it('keeps the deadline active if headers arrive but the response body stalls', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (_url, options: RequestInit) => new Response(new ReadableStream({
    start(stream) { options.signal!.addEventListener('abort', () => stream.error(options.signal!.reason), { once: true }) },
  }))))
  const response = await cloudFetch('https://test.supabase.co/rest/v1/rpc/occlude_snapshot')
  const body = expect(response.json()).rejects.toMatchObject({ name: 'TimeoutError' })
  await vi.advanceTimersByTimeAsync(20000)
  await body
  expect(vi.getTimerCount()).toBe(0)
})
