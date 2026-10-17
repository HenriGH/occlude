import { useState, type FormEvent } from 'react'
import { Cloud, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { db } from '../db'
import { configurationError, supabase } from '../sync/client'
import { cloudEngine } from '../sync/runtime'
import type { CloudState } from '../sync/useCloud'

export function CloudSettings({ cloud, onError }: { cloud: CloudState; onError: (e: unknown) => void }) {
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  async function action(work: () => Promise<unknown>) { setBusy(true); setNotice(''); try { await work() } catch (e) { onError(e) } finally { setBusy(false) } }
  async function login(e: FormEvent) {
    e.preventDefault()
    await action(async () => {
      if (!supabase) return
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin } })
      if (error) throw new Error(`Anmeldung fehlgeschlagen: ${error.message}`)
      setNotice('Anmeldelink gesendet. Öffne ihn im selben Browser auf diesem Gerät. Bitte auch im Spam-Ordner nachsehen.')
    })
  }
  return <div className="settings-card cloud-settings"><h2><Cloud size={20} />Cloud-Synchronisierung</h2>
    {!supabase ? <p className="muted">{configurationError || 'Kopiere .env.example nach .env.local und starte die App neu, um dein Supabase-Projekt zu verbinden.'}</p> : <>
      {cloud.authError && <p role="alert" className="cloud-error">{cloud.authError}</p>}
      {!cloud.authReady ? <p className="muted" role="status">Anmeldung wird geladen …</p> : !cloud.session ? <form onSubmit={e => void login(e)} className="login-form"><p className="muted">Melde dich auf deinen Geräten mit derselben E-Mail-Adresse an. Deine Karten bleiben lokal nutzbar.</p><label>E-Mail-Adresse<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="du@uni.de" /></label><button className="button primary" type="submit" disabled={busy || !email.trim()}><LogIn size={16} />{busy ? 'Wird gesendet …' : 'Anmeldelink senden'}</button></form> : <>
        <p className="cloud-account">Angemeldet als <strong>{cloud.session.user.email}</strong></p>
        {cloud.connection && cloud.session.user.id !== cloud.connection.userId ? <p className="cloud-error" role="alert">Dieses Gerät ist mit {cloud.connection.email} verbunden. Bitte mit diesem Konto anmelden. Lokale Daten werden nicht mit einem anderen Konto vermischt.</p> : !cloud.connection || cloud.connection.locked ? <><p className="muted">{cloud.connection ? 'Verbinde das ursprüngliche Konto erneut, um deine lokalen Karten zu entsperren.' : 'Verbinde dieses Gerät. Vorhandene lokale Karten werden in dein Konto übernommen; Karten anderer Geräte werden geladen.'}</p><button className="button primary" disabled={busy} onClick={() => void action(async () => {
          if (!cloud.connection && !confirm('Dieses Gerät mit dem angemeldeten Konto verbinden und vorhandene lokale Karten hochladen? Die Zuordnung bleibt für dieses Browserprofil bestehen.')) return
          await cloudEngine?.connect(cloud.session!.user.email ?? '')
        })}><Cloud size={16} />{busy ? 'Wird verbunden …' : 'Dieses Gerät verbinden'}</button></> : <>
          <div className="cloud-summary" role="status"><span className="status-dot" /><strong>{cloud.status?.running ? 'Synchronisierung läuft …' : cloud.pending?.length ? `${cloud.pending.length} Änderungen ausstehend` : cloud.status?.error ? 'Synchronisierung unterbrochen' : cloud.status?.lastSuccess ? 'Alle Änderungen synchronisiert' : 'Bereit zum Synchronisieren'}</strong></div>
          <p className="muted small">{cloud.status?.lastSuccess ? `Zuletzt erfolgreich: ${new Date(cloud.status.lastSuccess).toLocaleString('de-DE')}` : 'Noch keine erfolgreiche Synchronisierung.'}</p>
          {cloud.status?.error && <p className="cloud-error" role="alert">{cloud.status.error}</p>}
          <button className="button subtle" disabled={busy || cloud.status?.running} onClick={() => void action(() => cloudEngine!.retry())}><RefreshCw size={16} />Jetzt synchronisieren</button>
          {cloud.pending?.filter(o => o.state === 'conflict').map(op => <div className="conflict-row" key={op.id}><p>Konflikt: {op.kind.startsWith('deck.') ? 'Ordner' : op.kind.startsWith('image.') ? 'Bild und Masken' : 'Lerneinstellungen'}</p><p className="muted small">Deine lokale Änderung bleibt gespeichert. Nach Prüfung kannst du die lokale Version erneut anwenden. Gelöschte Cloud-Daten werden nicht wiederbelebt.</p><button className="button subtle" disabled={busy} onClick={() => void action(async () => { if (confirm('Die lokale Version dieses Eintrags über die aktuelle Cloud-Version schreiben? Andere Geräte können zwischenzeitlich Namen, Masken oder Ordnerzuordnungen geändert haben. Lernereignisse bleiben erhalten.')) await cloudEngine!.rebase(op.id) })}>Lokale Version erneut anwenden</button></div>)}
          {cloud.pending?.some(o => o.state === 'conflict') && <button className="text-button danger" disabled={busy} onClick={() => void action(async () => { if (confirm('Alle noch nicht synchronisierten Ordner-, Masken- und Einstellungsänderungen dieses Geräts verwerfen und den Cloud-Stand übernehmen? Lernereignisse werden niemals verworfen. Der Vorgang wird blockiert, wenn eine dafür benötigte Karte nur lokal existiert.')) await cloudEngine!.acceptCloudMetadata() })}>Cloud-Stand auf diesem Gerät übernehmen</button>}
        </>}
        <button className="text-button signout-button" disabled={busy} onClick={() => void action(async () => {
          if (cloud.connection) await db.syncMeta.put({ key: 'connection', value: { ...cloud.connection, locked: true } })
          const { error } = await supabase!.auth.signOut({ scope: 'local' })
          if (error) throw new Error('Abmeldung aus der Cloud fehlgeschlagen. Lokale Daten sind gesperrt; bitte erneut versuchen.')
        })}><LogOut size={15} />Auf diesem Gerät abmelden</button>
      </>}
      {notice && <p className="cloud-notice" role="status">{notice}</p>}
    </>}
    <p className="settings-warning">Ein Gerät bleibt einem Konto zugeordnet. Abmelden sperrt die lokale Ansicht und löscht keine ausstehenden Lernereignisse. Browserdaten sind keine verschlüsselte Datensicherung. Ein vollständiger Offline-Neustart und ein eigener Export sind noch nicht verfügbar.</p>
  </div>
}
