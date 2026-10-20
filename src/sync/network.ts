// A stalled background request must eventually release the sync worker. Image
// transfers get more time than JSON/Auth requests on slow mobile connections.
export const cloudFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const controller = new AbortController()
  const parent = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const abort = () => controller.abort(parent?.reason)
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new DOMException('Cloud-Anfrage hat zu lange gedauert.', 'TimeoutError')), url.includes('/storage/v1/') ? 90000 : 20000)
  const cleanup = () => { clearTimeout(timeout); parent?.removeEventListener('abort', abort) }
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    // Chromium can expose an empty stream even for a response that cannot have
    // a body. Reconstructing it with that stream and status 204/205/304 throws,
    // turning a successful void RPC into a misleading network failure.
    if (!response.body || [204, 205, 304].includes(response.status) || method.toUpperCase() === 'HEAD') { cleanup(); return response }
    // fetch resolves after headers, before JSON/Blob consumption. Keep the
    // deadline active through the body without buffering a whole image twice.
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const { done, value } = await reader.read()
          if (done) { cleanup(); stream.close() }
          else stream.enqueue(value)
        } catch (error) { cleanup(); stream.error(error) }
      },
      async cancel(reason) { cleanup(); await reader.cancel(reason) },
    })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (error) { cleanup(); throw error }
}
