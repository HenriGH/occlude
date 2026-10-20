import { useEffect, useState } from 'react'
import type { OAuthAuthorizationDetails, Session } from '@supabase/supabase-js'
import { Check, X } from 'lucide-react'
import { configuration, configurationError, supabase } from '../sync/client'
import { chatgptAccessFeedback } from '../sync/authFeedback'
import { EmailSignIn } from './EmailSignIn'
import { BrandMark } from './BrandMark'

function redirect(url: string) {
  const target = new URL(url)
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) throw new Error('Ungültiges Weiterleitungsziel.')
  window.location.assign(target.href)
}
export function OAuthConsent() {
  const framed = window.self !== window.top
  const authorizationId = new URLSearchParams(location.search).get('authorization_id') ?? ''
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)
  const [details, setDetails] = useState<OAuthAuthorizationDetails>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!supabase || framed) return
    let live = true
    void supabase.auth.getSession().then(({ data, error }) => { if (live) { setSession(data.session); setReady(true); if (error) setError('Anmeldung konnte nicht geladen werden.') } }).catch(() => { if (live) { setReady(true); setError('Anmeldung konnte nicht geladen werden.') } })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, value) => { setSession(value); setReady(true) })
    return () => { live = false; subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (!session || !supabase || framed) return
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(authorizationId)) { setError('Diese Verbindungsanfrage ist ungültig. Bitte in ChatGPT erneut verbinden.'); return }
    let live = true
    setError(''); setDetails(undefined)
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (!live) return
      if (error || !data) throw new Error('Die Verbindungsanfrage ist abgelaufen oder nicht verfügbar. Bitte in ChatGPT erneut verbinden.')
      if ('redirect_url' in data) { redirect(data.redirect_url); return }
      if (data.user.id !== session.user.id) throw new Error('Die Verbindungsanfrage gehört zu einem anderen Konto.')
      setDetails(data)
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Verbindungsanfrage nicht verfügbar.') })
    return () => { live = false }
  }, [session?.access_token, authorizationId])
  async function decide(approve: boolean) {
    if (!supabase || !details || busy) return
    setBusy(true); setError('')
    try {
      if (approve) {
        const { error, status } = await supabase.rpc('occlude_authorize_chatgpt_management', { p_client_id: details.client.id, p_client_name: details.client.name.slice(0, 120) })
        if (error) throw new Error(chatgptAccessFeedback(error, status))
      }
      const { data, error } = approve ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true }) : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
      if (error || !data) throw new Error('Die Verbindung konnte nicht abgeschlossen werden. Bitte erneut versuchen.')
      redirect(data.redirect_url)
    } catch (e) { setError(e instanceof Error ? e.message : 'Verbindung fehlgeschlagen.'); setBusy(false) }
  }
  if (framed) return <main className="oauth-page"><p role="alert">Bitte öffne die Verbindung in einem eigenen Browserfenster.</p></main>
  return <main className="oauth-page"><a className="brand" href="/"><BrandMark />occlude<span className="brand-dot">.</span></a><section className="oauth-card">
    <h1>Mit Occlude verbinden</h1>
    {!supabase ? <p role="alert">{configurationError || 'Cloud-Verbindung nicht eingerichtet.'}</p> : !ready ? <p role="status">Anmeldung wird geladen …</p> : !session ? <><p>Melde dich mit deinem Occlude-Konto an.</p><EmailSignIn auth={supabase.auth} projectUrl={configuration!.url} redirectPath={`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`} /></> : details ? <>
      <p><strong>{details.client.name}</strong> möchte sich mit <strong>{session.user.email}</strong> verbinden.</p>
      <ul><li>Ordnernamen und Kartenfragen lesen</li><li>Neue Ordner und Frage-Antwort-Karten erstellen</li><li>Auf deinen Auftrag Karten und Ordner samt Inhalt löschen</li></ul>
      <p className="muted small">Antworten, Bildinhalte und Lernverläufe werden nicht freigegeben. Du kannst den Zugriff in den Occlude-Einstellungen widerrufen.</p>
      <p className="oauth-details">Anwendung: {new URL(details.redirect_uri).origin}<br />Angefragte Anmeldedaten: {details.scope || 'E-Mail'}</p>
      <div className="oauth-actions"><button className="button subtle" disabled={busy} onClick={() => void decide(false)}><X size={17} />Ablehnen</button><button className="button primary" disabled={busy} onClick={() => void decide(true)}><Check size={17} />{busy ? 'Wird verbunden …' : 'Verbinden'}</button></div>
    </> : !error ? <p role="status">Verbindungsanfrage wird geladen …</p> : null}
    {error && <p className="cloud-error" role="alert">{error}</p>}
  </section></main>
}
