// Run with Deno and the Edge Function's import map. This is an isolated protocol
// fixture: no real account, hosted RPC, OpenAI request or database write is used.
import { createMcpHandler } from '../server/mcp.ts'
import { diagram } from '../src/test/cardSvgFixture.ts'

const base = 'https://runtime-fixture.supabase.co/functions/v1/occlude-mcp'
const handler = createMcpHandler({ supabaseUrl: 'https://runtime-fixture.supabase.co', publishableKey: 'public-fixture', appUrl: 'https://occlude.example' }, async () => ({
  userId: '00000000-0000-4000-8000-000000000001', clientId: '00000000-0000-4000-8000-000000000002',
  rpc: async name => ({ data: name === 'occlude_mcp_delete_cards' ? { deleted_count: 1 } : { created_count: 1, card_ids: ['00000000-0000-4000-8000-000000000003'], deck_id: '00000000-0000-4000-8000-000000000004', deck_name: 'Mathematik' }, error: null }),
}))
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const metadata = await handler(new Request(`${base}/.well-known/oauth-protected-resource`))
assert(metadata.status === 200 && (await metadata.json()).resource === `${base}/mcp`, 'OAuth discovery failed')
assert((await handler(new Request(`${base}/mcp`, { method: 'POST' }))).status === 401, 'Missing token was not challenged')
async function call(method: string, params: object) {
  const response = await handler(new Request(`${base}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer runtime-fixture', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
  assert(response.status === 200, `HTTP ${response.status} for ${method}`)
  return (await response.json()).result
}
const initialized = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'runtime-smoke', version: '1' } })
assert(initialized.serverInfo.name === 'occlude', 'MCP initialization failed')
const tools = await call('tools/list', {})
assert(tools.tools.length === 6 && tools.tools.find((tool: { name: string }) => tool.name === 'delete_flashcards').annotations.destructiveHint === true, 'Tool discovery failed')
const saved = await call('tools/call', { name: 'create_flashcards', arguments: { request_id: crypto.randomUUID(), cards: [{ front: 'Q', back: 'A', back_svg: diagram }] } })
assert(saved.structuredContent.created_count === 1 && saved.isError !== true, 'Tool invocation failed')
const rejected = await call('tools/call', { name: 'create_flashcards', arguments: { request_id: crypto.randomUUID(), cards: [{ front: 'Q', back: 'A', back_svg: '<svg><script>bad()</script></svg>' }] } })
assert(rejected.isError === true, 'Unsafe SVG was not rejected')
const removed = await call('tools/call', { name: 'delete_flashcards', arguments: { request_id: crypto.randomUUID(), cards: saved.structuredContent.created_cards } })
assert(removed.structuredContent.deleted_count === 1 && removed.isError !== true, 'Deletion invocation failed')
console.log('Deno MCP runtime: discovery, authentication challenge, initialization, tools, creation and deletion passed.')
