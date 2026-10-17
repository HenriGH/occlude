import { useEffect, useState, useSyncExternalStore } from 'react'
import { isStorageBlocked, subscribeStorage } from '../storageLifecycle'
import { BrandMark } from './BrandMark'

export function StartupScreen({ error = false }: { error?: boolean }) {
  const blocked = useSyncExternalStore(subscribeStorage, isStorageBlocked)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(timer)
  }, [])
  const help = blocked || slow || !!error
  return <main className={`loading-screen ${help ? 'startup-help' : ''}`} role={help ? 'alert' : 'status'}>
    <BrandMark />
    {!help ? <p>Dein Lernraum wird vorbereitet …</p> : <>
      <h1>{blocked ? 'Ein anderer Occlude-Tab blockiert den Start.' : error ? 'Der Lernraum konnte nicht geöffnet werden.' : 'Der Start dauert länger als erwartet.'}</h1>
      <p>{blocked
        ? 'Speichere offene Änderungen in anderen Occlude-Fenstern und schließe den Occlude-Tab im Browser. Die App startet automatisch weiter, sobald der Speicher frei ist.'
        : error
          ? 'Prüfe, ob Website-Daten in deinem Browser erlaubt sind. Falls Occlude auch im Browser geöffnet ist, speichere dort offene Änderungen und schließe den Tab. Lade die App anschließend neu.'
          : 'Falls Occlude auch im Browser geöffnet ist: Speichere dort offene Änderungen und schließe den Tab. Die App versucht weiter, deinen Lernraum zu öffnen.'}</p>
      <button className="button primary" onClick={() => location.reload()}>Neu laden</button>
      <p className="small">Gespeicherte Karten und ausstehende Änderungen bleiben erhalten. Website-Daten bitte nicht löschen.</p>
    </>}
  </main>
}
