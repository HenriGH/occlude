import { ArrowRight, Check, Cloud } from 'lucide-react'

interface Props {
  ready: number
  total: number
  inFolder: number
  awaitingCloud: boolean
  cloudMessage: string
  onReview: () => void
  onLibrary: () => void
  onCloud: () => void
}
export function StudySummary({ ready, total, inFolder, awaitingCloud, cloudMessage, onReview, onLibrary, onCloud }: Props) {
  if (!total && !awaitingCloud) return null
  if (!total) return <section className="study-summary" aria-label="Bibliotheksstatus">
    <div className="summary-icon"><Cloud size={24} /></div>
    <div className="summary-copy"><h2>Deine Bibliothek</h2><p role="status">{cloudMessage}</p></div>
    <button className="button subtle" onClick={onCloud}>Cloud öffnen<ArrowRight size={16} /></button>
  </section>
  return <section className="study-summary" aria-label="Lernübersicht">
    <div className={`summary-icon ${ready ? 'ready' : ''}`}>{ready ? <span>{ready}</span> : <Check size={25} />}</div>
    <div className="summary-copy"><h2>{ready ? `${ready} ${ready === 1 ? 'Karte bereit' : 'Karten bereit'}` : inFolder ? 'Für heute fertig' : 'Dieser Ordner ist leer'}</h2>
      <p>{ready ? 'Deine nächste Lernrunde.' : `${total} ${total === 1 ? 'Karte' : 'Karten'} in deiner Bibliothek`}</p>
    </div>
    <button className={`button ${ready ? 'primary' : 'subtle'}`} onClick={ready ? onReview : onLibrary}>{ready ? 'Jetzt lernen' : 'Bibliothek öffnen'}<ArrowRight size={16} /></button>
  </section>
}
