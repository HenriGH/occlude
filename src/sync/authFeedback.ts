export interface AuthFailure { code?: string; status?: number; message?: string; details?: { code?: string } | null }

export function chatgptAccessFeedback(error: { code?: string }, status: number): string {
  // Show only bounded machine codes, never SQL details, URLs, tokens or the raw
  // network error. A failed fetch can include sensitive request data in its stack.
  const code = /^[A-Z0-9_]{2,32}$/.test(error.code ?? '') ? error.code : undefined
  const diagnostic = [status > 0 ? `HTTP ${status}` : 'NETZWERK', code].filter(Boolean).join(' · ')
  let message = 'Die Karten-Freigabe ist fehlgeschlagen. Bitte diesen Fehlercode zur Diagnose weitergeben.'
  if (status === 0) message = 'Die Karten-Freigabe konnte nicht bestätigt werden. Bitte Verbindung und mögliche Browser-Blocker prüfen und erneut versuchen.'
  else if (['PGRST202', '42883', '42P01'].includes(code ?? '')) message = 'Das Datenbank-Update für die ChatGPT-Anbindung fehlt oder ist noch nicht verfügbar.'
  else if (status === 401 || code === 'PGRST301' || code === 'PGRST303') message = 'Die Anmeldung für die Karten-Freigabe wurde abgewiesen. Bitte erneut bei Occlude anmelden und die Verbindung in ChatGPT neu starten.'
  else if (status === 403 || code === '42501') message = 'Die Datenbank hat die Karten-Freigabe wegen fehlender Berechtigung abgewiesen.'
  else if (status === 429) message = 'Zu viele Verbindungsversuche. Bitte kurz warten und erneut versuchen.'
  else if (status >= 500) message = 'Die Karten-Freigabe ist auf dem Server gerade fehlgeschlagen. Bitte später erneut versuchen.'
  return `${message} (${diagnostic})`
}

export function authFeedback(error: AuthFailure): string {
  const code = error.code ?? error.details?.code
  if (code === 'over_email_send_rate_limit') return 'Das E-Mail-Versandlimit des Projekts ist erreicht. Eine andere Adresse oder ein geschlossener Tab setzt es nicht zurück. Bitte später erneut versuchen. Ein bereits zugesandter Code kann weiterhin geprüft werden.'
  if (error.status === 429 || code === 'over_request_rate_limit') return 'Zu viele Anmeldeversuche. Bitte warten und nicht erneut senden. Ein bereits zugesandter Code kann weiterhin geprüft werden.'
  if (code === 'email_address_not_authorized') return 'Der E-Mail-Versand ist auf Testempfänger beschränkt. Für deine Adresse muss der Projektbetreiber einen eigenen SMTP-Versand einrichten.'
  if (code === 'otp_expired') return 'Der Code oder Link ist abgelaufen oder wurde bereits verwendet. Bitte die neueste E-Mail verwenden.'
  if (['bad_code_verifier', 'pkce_code_verifier_not_found', 'flow_state_not_found', 'flow_state_expired'].includes(code ?? '')) return 'Der Anmeldelink passt nicht zu diesem Browser oder dieser Website. Öffne ihn im ursprünglichen Browser oder gib stattdessen den E-Mail-Code hier ein.'
  if (/requested path.*invalid/i.test(error.message ?? '')) return 'Der Anmeldelink konnte nicht geöffnet werden. Bitte die Weiterleitungsadresse und E-Mail-Vorlage im Supabase-Projekt prüfen oder den E-Mail-Code direkt eingeben.'
  if (code === 'email_provider_disabled') return 'Die E-Mail-Anmeldung ist im Projekt noch nicht aktiviert.'
  return 'Die Anmeldung ist fehlgeschlagen. Bitte Verbindung und neueste E-Mail prüfen. Deine lokalen Karten bleiben erhalten.'
}

export function callbackFailure(href: string): string {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const code = url.searchParams.get('error_code') ?? hash.get('error_code')
  const description = url.searchParams.get('error_description') ?? hash.get('error_description')
  return code || description || url.searchParams.has('error') || hash.has('error') ? authFeedback({ code: code ?? undefined, message: description ?? undefined }) : ''
}

export function isAuthReturn(href: string): boolean {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.slice(1))
  return url.searchParams.has('code') || hash.has('access_token') || !!callbackFailure(href)
}

export const MAIL_PAUSE_MS = 60000
export function mailCooldownKey(projectUrl: string) { return `occlude:auth-mail-pause:${new URL(projectUrl).host}` }
export function readMailPause(key: string, now = Date.now()): number {
  try {
    const value = Number(localStorage.getItem(key))
    // This is a client-side send pause, never a claim that the server quota resets.
    return Number.isFinite(value) && value > now ? Math.min(value, now + MAIL_PAUSE_MS) : 0
  } catch { return 0 }
}
export function reserveMailPause(key: string, now = Date.now()): number {
  const until = now + MAIL_PAUSE_MS
  try { localStorage.setItem(key, String(until)) } catch { /* Per-component pause still works without storage. */ }
  return until
}
