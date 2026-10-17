import { createClient } from '@supabase/supabase-js'
import { publicConfiguration } from './config'
import { callbackFailure, isAuthReturn } from './authFeedback'
import { cloudFetch } from './network'

export const initialAuthError = typeof location !== 'undefined' ? callbackFailure(location.href) : ''
export const returningFromAuth = typeof location !== 'undefined' && isAuthReturn(location.href)

export let configuration: ReturnType<typeof publicConfiguration> = null
export let configurationError = ''
try { configuration = publicConfiguration(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) }
catch (e) { configurationError = e instanceof Error ? e.message : 'Supabase-Konfiguration ungültig.' }
export const supabase = configuration ? createClient(configuration.url, configuration.key, {
  global: { fetch: cloudFetch },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
}) : null
