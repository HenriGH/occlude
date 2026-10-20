import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { KeyRound, LogIn } from 'lucide-react'
import { authFeedback, mailCooldownKey, readMailPause, reserveMailPause } from '../sync/authFeedback'

type EmailAuth = Pick<SupabaseClient['auth'], 'signInWithOtp' | 'verifyOtp'>
export function EmailSignIn({ auth, projectUrl, redirectPath = '/' }: { auth: EmailAuth; projectUrl: string; redirectPath?: string }) {
  const key = mailCooldownKey(projectUrl)
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null)
  const [until, setUntil] = useState(() => readMailPause(key))
  const [now, setNow] = useState(Date.now())
  const locked = useRef(false)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const updated = (e: StorageEvent) => { if (e.key === key || e.key === null) { setUntil(readMailPause(key)); setNow(Date.now()) } }
    window.addEventListener('storage', updated)
    return () => { clearInterval(timer); window.removeEventListener('storage', updated) }
  }, [key])
  const seconds = Math.max(0, Math.ceil((until - now) / 1000))
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const validToken = /^\d{6,10}$/.test(token)
  async function send(e: FormEvent) {
    e.preventDefault()
    if (locked.current || !validEmail) return
    const pause = Math.max(until, readMailPause(key))
    if (pause > Date.now()) { setUntil(pause); setNow(Date.now()); return }
    locked.current = true; setBusy('send'); setError(''); setNotice('')
    setUntil(reserveMailPause(key)); setNow(Date.now())
    try {
      const { error } = await auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: new URL(redirectPath.startsWith('/') && !redirectPath.startsWith('//') ? redirectPath : '/', location.origin).href } })
      if (error) { setError(authFeedback(error)); return }
      setNotice('E-Mail angefordert. Code unten eingeben oder den Link in diesem Browser öffnen.')
    } catch { setError('Die Anmelde-E-Mail konnte nicht angefordert werden. Bitte Verbindung prüfen und kurz warten.') }
    finally { locked.current = false; setBusy(null) }
  }
  async function verify(e: FormEvent) {
    e.preventDefault()
    if (locked.current || !validEmail || !validToken) return
    locked.current = true; setBusy('verify'); setError(''); setNotice('')
    try {
      const { error } = await auth.verifyOtp({ email: email.trim(), token, type: 'email' })
      if (error) { setError(authFeedback(error)); return }
      setToken(''); setNotice('Anmeldung erfolgreich. Du kannst dieses Gerät jetzt verbinden.')
    } catch { setError('Der Code konnte nicht geprüft werden. Bitte Verbindung und Code aus der neuesten E-Mail prüfen.') }
    finally { locked.current = false; setBusy(null) }
  }
  return <div className="email-sign-in">
    <form onSubmit={e => void send(e)} className="login-form">
      <p className="muted">Auf allen Geräten dieselbe E-Mail-Adresse verwenden.</p>
      <label>E-Mail-Adresse<input type="email" autoComplete="email" required value={email} onChange={e => { setEmail(e.target.value); setToken('') }} placeholder="du@uni.de" disabled={!!busy} /></label>
      <button className="button primary" type="submit" disabled={!!busy || !validEmail || seconds > 0}><LogIn size={16} />{busy === 'send' ? 'Wird gesendet …' : seconds > 0 ? `Erneut anfragen in ${seconds} s` : 'Anmelde-E-Mail senden'}</button>
    </form>
    {seconds > 0 && <p className="muted small send-pause">Sendepause. Das Anbieterlimit kann länger gelten.</p>}
    {notice && <p className="cloud-notice" role="status">{notice}</p>}
    {error && <p className="cloud-error" role="alert">{error}</p>}
    <form onSubmit={e => void verify(e)} className="login-form code-form">
      <label>Code aus der E-Mail<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} value={token} onChange={e => setToken(e.target.value.replace(/\s/g, ''))} placeholder="Anmeldecode" disabled={!!busy} /></label>
      <button className="button subtle" type="submit" disabled={!!busy || !validEmail || !validToken}><KeyRound size={16} />{busy === 'verify' ? 'Wird geprüft …' : 'Mit Code anmelden'}</button>
      <p className="muted small">Der Code funktioniert auch während der Sendepause.</p>
    </form>
  </div>
}
