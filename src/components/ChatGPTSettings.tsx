import { useEffect, useState } from 'react'
import { Link2, Unplug } from 'lucide-react'
import { supabase } from '../sync/client'
import type { CloudState } from '../sync/useCloud'

type Connection = { client_id: string; name: string; created_at: string }
export function ChatGPTSettings({ cloud, onError }: { cloud: CloudState; onError: (e: unknown) => void }) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!supabase || !cloud.session) return
    let live = true
    void Promise.resolve(supabase.rpc('occlude_chatgpt_connections')).then(({ data, error }) => { if (live) { setUnavailable(!!error); if (!error && Array.isArray(data)) setConnections(data) } }).catch(() => { if (live) setUnavailable(true) })
    return () => { live = false }
  }, [cloud.session?.access_token])
  async function revoke(clientId: string) {
    if (!supabase || busy || !confirm('Dieser Anwendung den Zugriff auf Occlude entziehen? Bereits erstellte Karten bleiben erhalten.')) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('occlude_revoke_chatgpt', { p_client_id: clientId })
      if (error) throw new Error('Der Zugriff konnte nicht widerrufen werden.')
      setConnections(items => items.filter(item => item.client_id !== clientId))
      // The database capability is revoked immediately, including still-valid
      // access tokens. Supabase additionally removes the refresh-token grant.
      const response = await supabase.auth.oauth.revokeGrant({ clientId })
      if (response.error) throw new Error('Der Zugriff ist gesperrt. Die vollständige Trennung der Anmeldung konnte noch nicht bestätigt werden.')
    } catch (e) { onError(e) }
    finally { setBusy(false) }
  }
  return <div className="settings-card"><h2><Link2 size={20} />ChatGPT</h2><p className="muted small">Verbinde Occlude einmal in ChatGPT, um dort erstellte Karten direkt in deiner Bibliothek zu speichern.</p>
    {!cloud.session ? <p className="muted small">Melde dich für die geräteübergreifende Verbindung mit deinem Occlude-Konto an.</p> : unavailable ? <p className="muted small">ChatGPT-Verbindungen konnten gerade nicht geladen werden.</p> : connections.length ? connections.map(connection => <div className="setting-row" key={connection.client_id}><strong>{connection.name}</strong><button className="text-button danger" disabled={busy} onClick={() => void revoke(connection.client_id)}><Unplug size={16} />Trennen</button></div>) : <p className="muted small">Keine Anwendung verbunden.</p>}
  </div>
}
