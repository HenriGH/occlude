import { describe, expect, it } from 'vitest'
import { authFeedback, callbackFailure, chatgptAccessFeedback, isAuthReturn, readMailPause } from './authFeedback'

describe('auth error recovery', () => {
  it('distinguishes ChatGPT connection failures without exposing raw server details', () => {
    expect(chatgptAccessFeedback({ code: 'PGRST202' }, 404)).toContain('Datenbank-Update')
    expect(chatgptAccessFeedback({ code: '42501' }, 403)).toContain('HTTP 403 · 42501')
    expect(chatgptAccessFeedback({}, 401)).toContain('erneut bei Occlude anmelden')
    expect(chatgptAccessFeedback({}, 429)).toContain('kurz warten')
    expect(chatgptAccessFeedback({}, 503)).toContain('Server')
    expect(chatgptAccessFeedback({}, 0)).toContain('NETZWERK')
    expect(chatgptAccessFeedback({ code: 'private-token-in-url' }, 400)).not.toContain('private-token')
  })
  it('distinguishes project mail limits, request limits and restricted SMTP recipients', () => {
    expect(authFeedback({ code: 'over_email_send_rate_limit' })).toContain('Versandlimit des Projekts')
    expect(authFeedback({ status: 429 })).toContain('Zu viele Anmeldeversuche')
    expect(authFeedback({ code: 'email_address_not_authorized' })).toContain('SMTP')
  })
  it('explains redirect and verifier failures without echoing callback URLs or tokens', () => {
    const href = 'https://occlude.henschau2005.workers.dev/#error=access_denied&error_code=otp_expired&error_description=private-token'
    expect(callbackFailure(href)).toContain('abgelaufen')
    expect(callbackFailure(href)).not.toContain('private-token')
    expect(authFeedback({ code: 'bad_code_verifier' })).toContain('Browser')
    expect(authFeedback({ details: { code: 'flow_state_expired' } })).toContain('Browser')
    expect(authFeedback({ code: 'pkce_code_verifier_not_found' })).toContain('Browser')
    expect(authFeedback({ message: 'Requested path is invalid' })).toContain('Weiterleitungsadresse')
  })
  it('recognizes auth returns for the settings screen without treating normal visits as callbacks', () => {
    expect(isAuthReturn('https://example.test/?code=private-value')).toBe(true)
    expect(isAuthReturn('https://example.test/#error_code=otp_expired')).toBe(true)
    expect(isAuthReturn('https://example.test/')).toBe(false)
  })
  it('ignores expired or corrupt cooldown storage', () => {
    localStorage.setItem('pause', 'not-a-time')
    expect(readMailPause('pause')).toBe(0)
    localStorage.setItem('pause', '1')
    expect(readMailPause('pause')).toBe(0)
  })
})
