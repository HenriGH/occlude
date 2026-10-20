import { createMcpHandler } from '../../../server/mcp.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!
const appUrl = Deno.env.get('OCCLUDE_APP_URL') ?? 'https://occlude.henschau2005.workers.dev/'
// Supabase handles OAuth codes, PKCE, refresh-token rotation and client registration.
// This function only accepts verified, explicitly approved OAuth user tokens.
Deno.serve(createMcpHandler({ supabaseUrl, publishableKey, appUrl }))
