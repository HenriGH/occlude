// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpHandler, supabaseMcpAuthorization, type McpAccess } from '../../server/mcp'

const configuration = { supabaseUrl: 'https://mcp-fixture.supabase.co', publishableKey: 'public-fixture', appUrl: 'https://occlude.example/' }
const endpoint = `${configuration.supabaseUrl}/functions/v1/occlude-mcp/mcp`
const meta = `${configuration.supabaseUrl}/functions/v1/occlude-mcp/.well-known/oauth-protected-resource`
async function clientFor(handler: (request: Request) => Promise<Response>) {
  const client = new Client({ name: 'chatgpt-fixture', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: 'Bearer test-token' } }, fetch: async (input, init) => handler(new Request(input, init)) }))
  return client
}
function fixture() {
  const rpc = vi.fn<McpAccess['rpc']>().mockResolvedValue({ data: [], error: null })
  const authorize = vi.fn(async () => ({ userId: crypto.randomUUID(), clientId: crypto.randomUUID(), rpc }))
  return { handler: createMcpHandler(configuration, authorize), rpc, authorize }
}

describe('public MCP protocol and input boundaries', () => {
  it('publishes OAuth discovery anonymously and challenges missing/invalid tokens without exposing data', async () => {
    const handler = createMcpHandler(configuration, async () => null)
    const discovery = await handler(new Request(meta))
    expect(await discovery.json()).toMatchObject({ resource: endpoint, authorization_servers: [`${configuration.supabaseUrl}/auth/v1`], scopes_supported: ['email'] })
    const unauthorized = await handler(new Request(endpoint, { method: 'POST' }))
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get('WWW-Authenticate')).toContain(meta)
    expect((await handler(new Request(endpoint, { method: 'POST', headers: { Authorization: 'Bearer invalid' } }))).status).toBe(401)
    expect((await handler(new Request(endpoint, { method: 'POST', headers: { Origin: 'https://untrusted.example' } }))).status).toBe(403)
  })
  it('supports the official client handshake, advertises honest write permissions, and returns stored cards without another import', async () => {
    const { handler, rpc } = fixture(), client = await clientFor(handler)
    try {
      const list = await client.listTools()
      const create = list.tools.find(tool => tool.name === 'create_flashcards')!
      expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true })
      expect(create._meta?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['email'] }])
      expect(list.tools).toHaveLength(6)
      for (const name of ['delete_flashcards', 'delete_folder']) expect(list.tools.find(tool => tool.name === name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true })
      const requestId = crypto.randomUUID(), data = { created_count: 1, card_ids: [crypto.randomUUID()], deck_id: crypto.randomUUID(), deck_name: 'Mathematik' }
      rpc.mockResolvedValue({ data, error: null })
      const args = { request_id: requestId, deck_name: 'Mathematik', cards: [{ front: 'Wie lautet die Produktregel?', back: '$\\log_b(xy)=\\log_b(x)+\\log_b(y)$ für $x,y>0$, $b>0$, $b\\ne1$.' }] }
      const result = await client.callTool({ name: 'create_flashcards', arguments: args })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toEqual({ ...data, created_cards: [{ id: data.card_ids[0], version: 1 }], app_url: configuration.appUrl })
      expect(rpc).toHaveBeenCalledWith('occlude_mcp_create_cards', { p_request_id: requestId, p_deck_id: null, p_deck_name: 'Mathematik', p_cards: args.cards })
    } finally { await client.close() }
  })
  it('routes targeted search, versioned deletion and folder previews through bounded dedicated RPCs', async () => {
    const { handler, rpc } = fixture(), client = await clientFor(handler)
    try {
      const card = { id: crypto.randomUUID(), version: 2 }, folder = crypto.randomUUID(), request = crypto.randomUUID(), token = 'a'.repeat(64)
      const cases = [
        { name: 'list_flashcards', input: { deck_id: folder, query: 'Logarithmus' }, rpc: 'occlude_mcp_list_cards', args: { p_deck_id: folder, p_query: 'Logarithmus', p_after: null, p_limit: 50 }, result: { cards: [{ ...card, question: 'Q' }], next_after: null } },
        { name: 'delete_flashcards', input: { request_id: request, cards: [card] }, rpc: 'occlude_mcp_delete_cards', args: { p_request_id: request, p_cards: [card] }, result: { deleted_count: 1, card_ids: [card.id] } },
        { name: 'preview_folder_deletion', input: { folder_id: folder }, rpc: 'occlude_mcp_preview_folder_deletion', args: { p_deck_id: folder }, result: { snapshot_token: token, card_count: 1 } },
        { name: 'delete_folder', input: { folder_id: folder, request_id: request, snapshot_token: token }, rpc: 'occlude_mcp_delete_folder', args: { p_request_id: request, p_deck_id: folder, p_snapshot_token: token }, result: { deleted_folder_count: 1, deleted_card_count: 1 } },
      ]
      for (const example of cases) {
        rpc.mockResolvedValue({ data: example.result, error: null })
        const result = await client.callTool({ name: example.name, arguments: example.input })
        expect(result.isError).not.toBe(true)
        expect(result.structuredContent).toEqual(example.result)
        expect(rpc).toHaveBeenLastCalledWith(example.rpc, example.args)
      }
      rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new consent required' } })
      const denied = await client.callTool({ name: 'delete_flashcards', arguments: cases[1].input })
      expect(denied.isError).toBe(true)
      expect(denied._meta?.['mcp/www_authenticate']).toBeDefined()
    } finally { await client.close() }
  })
  it('rejects guessed scope, duplicate cards, missing previews and forged deletion ownership before SQL', async () => {
    const { handler, rpc } = fixture(), client = await clientFor(handler)
    try {
      const card = { id: crypto.randomUUID(), version: 1 }, request = crypto.randomUUID(), folder = crypto.randomUUID()
      for (const input of [{ request_id: request, cards: [] }, { request_id: request, cards: [card, card] }, { request_id: request, cards: [{ id: card.id }] }, { request_id: request, cards: [card], user_id: crypto.randomUUID() }, { request_id: request, cards: Array.from({ length: 101 }, () => ({ id: crypto.randomUUID(), version: 1 })) }]) expect((await client.callTool({ name: 'delete_flashcards', arguments: input })).isError).toBe(true)
      expect((await client.callTool({ name: 'delete_folder', arguments: { request_id: request, folder_id: folder } })).isError).toBe(true)
      expect((await client.callTool({ name: 'delete_folder', arguments: { request_id: request, folder_id: folder, snapshot_token: 'a'.repeat(64), delete_all: true } })).isError).toBe(true)
      expect((await client.callTool({ name: 'list_flashcards', arguments: { limit: 101 } })).isError).toBe(true)
      expect(rpc).not.toHaveBeenCalled()
    } finally { await client.close() }
  })
  it('rejects forged ownership, malformed text, batches over 50 and unknown tools before calling SQL', async () => {
    const { handler, rpc } = fixture(), client = await clientFor(handler)
    try {
      const valid = { request_id: crypto.randomUUID(), cards: [{ front: 'Q', back: 'A' }] }
      for (const args of [{ ...valid, user_id: crypto.randomUUID() }, { ...valid, cards: [{ front: ' ', back: 'A' }] }, { ...valid, cards: [{ front: 'x'.repeat(10001), back: 'A' }] }, { ...valid, cards: Array.from({ length: 51 }, () => valid.cards[0]) }, { ...valid, deck_id: crypto.randomUUID(), deck_name: 'Other' }]) expect((await client.callTool({ name: 'create_flashcards', arguments: args })).isError).toBe(true)
      expect((await client.callTool({ name: 'delete_everything', arguments: {} })).isError).toBe(true)
      expect(rpc).not.toHaveBeenCalled()
    } finally { await client.close() }
  })
  it('treats revoked database capabilities as authentication failures and does not claim success', async () => {
    const { handler, rpc } = fixture(), client = await clientFor(handler)
    try {
      rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'revoked' } })
      const result = await client.callTool({ name: 'create_flashcards', arguments: { request_id: crypto.randomUUID(), cards: [{ front: 'Q', back: 'A' }] } })
      expect(result.isError).toBe(true)
      expect(result._meta?.['mcp/www_authenticate']).toEqual([expect.stringContaining(meta)])
      expect(result.structuredContent).toBeUndefined()
    } finally { await client.close() }
  })
})

it('verifies JWT signatures, issuer, audience and OAuth client identity instead of trusting decoded tokens', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKey = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'mcp-test-key', alg: 'ES256', use: 'sig' }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ keys: [publicKey] }))
  const verify = supabaseMcpAuthorization(configuration, fetcher)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const claims = { iss: `${configuration.supabaseUrl}/auth/v1`, sub: crypto.randomUUID(), aud: 'authenticated', role: 'authenticated', client_id: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), aal: 'aal1', session_id: crypto.randomUUID() }
  async function sign(values: Record<string, unknown>) {
    const input = `${encode({ alg: 'ES256', kid: publicKey.kid, typ: 'JWT' })}.${encode(values)}`
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(input))
    return `${input}.${Buffer.from(signature).toString('base64url')}`
  }
  expect(await verify(await sign(claims))).toMatchObject({ userId: claims.sub, clientId: claims.client_id })
  for (const invalid of [{ ...claims, iss: 'https://other.supabase.co/auth/v1' }, { ...claims, aud: 'other' }, { ...claims, role: 'service_role' }, { ...claims, client_id: undefined }, { ...claims, exp: Math.floor(Date.now() / 1000) - 10 }]) expect(await verify(await sign(invalid))).toBeNull()
  const legitimate = await sign(claims)
  const forged = `${legitimate.split('.')[0]}.${encode({ ...claims, sub: crypto.randomUUID() })}.${legitimate.split('.')[2]}`
  expect(await verify(forged)).toBeNull()
})
