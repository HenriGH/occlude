import { createClient } from '@supabase/supabase-js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type CallToolRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

export interface McpConfiguration { supabaseUrl: string; publishableKey: string; appUrl: string }
export interface McpAccess {
  userId: string; clientId: string
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>
}
export type AuthorizeMcp = (token: string) => Promise<McpAccess | null>
const batch = z.object({
  request_id: z.uuid().describe('Generate one UUID for this batch. Reuse the same UUID and content if a network retry is needed.'),
  deck_id: z.uuid().optional().describe('Existing folder ID from list_folders. Omit when creating a new top-level folder.'),
  deck_name: z.string().min(1).max(120).trim().optional().describe('Name of a new top-level folder. Omit if deck_id is provided. Defaults to ChatGPT.'),
  cards: z.array(z.object({ front: z.string().max(10000).trim().min(1), back: z.string().max(10000).trim().min(1) }).strict()).min(1).max(50),
}).strict().refine(value => !(value.deck_id && value.deck_name), 'Provide either deck_id or deck_name, not both.')
const securitySchemes = [{ type: 'oauth2', scopes: ['email'] }]
const tools = [
  { name: 'list_folders', title: 'Occlude-Ordner anzeigen', description: 'List names and IDs of this user’s Occlude folders to choose a destination. Does not return existing cards, images, or learning history.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, securitySchemes, _meta: { securitySchemes } },
  { name: 'create_flashcards', title: 'Karten in Occlude speichern', description: 'Create question-answer flashcards directly in the connected Occlude account, only when the user asks to save/create cards. Write one clear question per card and a correct self-contained answer. Include necessary mathematical assumptions. Use plain text with $...$ for inline LaTeX and $$...$$ for display LaTeX; do not use HTML, Markdown tables or code fences. For an existing destination, call list_folders first and use its deck_id; for a new topic use deck_name. Save in batches of at most 50 cards. Reuse request_id unchanged on retries to avoid duplicates. On success cards are already saved and synchronize automatically; do not ask the user to copy, import, approve in Occlude or run another step.', inputSchema: z.toJSONSchema(batch), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, securitySchemes, _meta: { securitySchemes, 'openai/toolInvocation/invoking': 'Karten werden gespeichert …', 'openai/toolInvocation/invoked': 'Karten in Occlude gespeichert' } },
]

export function supabaseMcpAuthorization(configuration: McpConfiguration, fetcher: typeof fetch = fetch): AuthorizeMcp {
  return async token => {
    const client = createClient(configuration.supabaseUrl, configuration.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetcher(input, { ...init, signal: AbortSignal.timeout(12000) }) },
    })
    // Never trust decode-only claims or a caller-supplied user ID. The SDK verifies
    // signatures against this project's JWKS (or Auth server for symmetric keys).
    const { data, error } = await client.auth.getClaims(token)
    if (error || !data) return null
    const c = data.claims, issuer = `${configuration.supabaseUrl.replace(/\/$/, '')}/auth/v1`
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
    const audience = Array.isArray(c.aud) ? c.aud : [c.aud]
    if (c.iss !== issuer || c.role !== 'authenticated' || !audience.includes('authenticated') || !uuid.test(c.sub) || typeof c.client_id !== 'string' || !uuid.test(c.client_id) || c.exp <= Date.now() / 1000 || typeof c.nbf === 'number' && c.nbf > Date.now() / 1000) return null
    return { userId: c.sub, clientId: c.client_id, rpc: async (name, args) => { const result = await client.rpc(name, args); return { data: result.data, error: result.error } } }
  }
}

export function createMcpHandler(configuration: McpConfiguration, authorize = supabaseMcpAuthorization(configuration)) {
  const project = configuration.supabaseUrl.replace(/\/$/, '')
  const resource = `${project}/functions/v1/occlude-mcp/mcp`
  const metadataUrl = `${project}/functions/v1/occlude-mcp/.well-known/oauth-protected-resource`
  const appOrigin = new URL(configuration.appUrl).origin
  const challenge = `Bearer resource_metadata="${metadataUrl}", scope="email"`
  function errorResult(message: string, reauthenticate = false): CallToolResult {
    return { isError: true, content: [{ type: 'text', text: message }], ...(reauthenticate ? { _meta: { 'mcp/www_authenticate': [challenge] } } : {}) }
  }
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url), origin = request.headers.get('Origin')
    const allowed = new Set(['https://chatgpt.com', 'https://chat.openai.com', appOrigin])
    if (origin && !allowed.has(origin)) return new Response('Origin not allowed', { status: 403 })
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) }
    const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...headers, ...extra } })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (url.pathname.endsWith('/.well-known/oauth-protected-resource') && request.method === 'GET') return json({ resource, authorization_servers: [`${project}/auth/v1`], scopes_supported: ['email'], bearer_methods_supported: ['header'], resource_name: 'Occlude' })
    if (!url.pathname.endsWith('/occlude-mcp/mcp')) return json({ error: 'not_found' }, 404)
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST, OPTIONS' })
    const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1]
    if (!token || token.length > 16384) return json({ error: 'authentication_required' }, 401, { 'WWW-Authenticate': challenge })
    let access: McpAccess | null
    try { access = await authorize(token) }
    catch { return json({ error: 'authentication_unavailable' }, 401, { 'WWW-Authenticate': challenge }) }
    if (!access) return json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': `${challenge}, error="invalid_token"` })
    const server = new Server({ name: 'occlude', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: 'Occlude stores flashcards for the connected user. Tools can list folder names and create new question-answer cards. They cannot read, change or delete existing learning content. Successful creations are final and synchronize without import steps.' })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
    server.setRequestHandler(CallToolRequestSchema, async ({ params }: CallToolRequest) => {
      if (params.name === 'list_folders') {
        if (params.arguments && Object.keys(params.arguments).length) return errorResult('Dieses Werkzeug hat keine Eingabefelder.')
        const { data, error } = await access!.rpc('occlude_mcp_list_decks')
        if (error) return errorResult(error.code === '42501' ? 'Occlude-Zugriff wurde widerrufen oder noch nicht freigegeben. Bitte erneut verbinden.' : 'Ordner konnten nicht geladen werden. Bitte erneut versuchen.', error.code === '42501')
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { folders: data } }
      }
      if (params.name !== 'create_flashcards') return errorResult('Unbekanntes Werkzeug.')
      const parsed = batch.safeParse(params.arguments)
      if (!parsed.success) return errorResult('Ungültige Karten: request_id muss eine UUID sein, maximal 50 Karten mit jeweils 1–10.000 Zeichen pro Seite. Bitte entweder deck_id oder deck_name angeben.')
      const input = parsed.data
      const { data, error } = await access!.rpc('occlude_mcp_create_cards', { p_request_id: input.request_id, p_deck_id: input.deck_id ?? null, p_deck_name: input.deck_name ?? null, p_cards: input.cards })
      if (error) return errorResult(error.code === '42501' ? 'Occlude-Zugriff wurde widerrufen. Bitte erneut verbinden.' : 'Die Karten wurden nicht bestätigt. Bei einem Netzwerkfehler denselben request_id mit unverändertem Inhalt erneut senden. Bei einem fehlenden Ordner list_folders verwenden.', error.code === '42501')
      if (!data || typeof data !== 'object' || !('created_count' in data)) return errorResult('Speicherung konnte nicht bestätigt werden. Mit demselben request_id erneut versuchen.')
      return { content: [{ type: 'text', text: `${String(data.created_count)} Karten in Occlude gespeichert. Sie erscheinen automatisch auf verbundenen Geräten. Kein Import nötig.` }], structuredContent: { ...data, app_url: configuration.appUrl } }
    })
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, sessionIdGenerator: undefined, maxRequestBodySize: 3 * 1024 * 1024 })
    try {
      await server.connect(transport)
      const response = await transport.handleRequest(request)
      const merged = new Headers(response.headers)
      for (const [key, value] of Object.entries(headers)) merged.set(key, value)
      return new Response(response.body, { status: response.status, headers: merged })
    } catch { return json({ error: 'service_unavailable' }, 503) }
    finally { await server.close() }
  }
}
