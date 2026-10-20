import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Eye, Pencil } from 'lucide-react'
import { saveBasicCard } from '../db'
import { MAX_CARD_TEXT_LENGTH, type BasicCard, type Deck } from '../domain'
import { CardText } from './CardText'

export type BasicDraft = BasicCard | { deckId: string }
export function BasicEditor({ draft, decks, onClose, onImage, onSaved, onError }: { draft: BasicDraft; decks: Deck[]; onClose: () => void; onImage: () => void; onSaved: (id: string) => void; onError: (e: unknown) => void }) {
  const initial = 'id' in draft ? draft : null
  const [front, setFront] = useState(initial?.front ?? '')
  const [back, setBack] = useState(initial?.back ?? '')
  const [deckId, setDeckId] = useState(draft.deckId)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const locked = useRef(false)
  const dirty = front !== (initial?.front ?? '') || back !== (initial?.back ?? '') || deckId !== draft.deckId
  const leave = (action: () => void) => { if (!dirty || confirm('Ungespeicherte Änderungen verwerfen?')) action() }
  async function save() {
    if (locked.current || !front.trim() || !back.trim() || !deckId) return
    locked.current = true; setSaving(true)
    try { await saveBasicCard(deckId, front, back, initial?.id); onSaved(deckId) }
    catch (e) { onError(e) }
    finally { locked.current = false; setSaving(false) }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save() } }
    const unload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('keydown', key); window.addEventListener('beforeunload', unload)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload) }
  })
  return <section className="basic-editor">
    <button className="back-link" onClick={() => leave(onClose)}><ArrowLeft size={16} />Zur Übersicht</button>
    <div className="page-heading"><h1>{initial ? 'Karte bearbeiten' : 'Neue Karte'}</h1><button className="button primary" disabled={!front.trim() || !back.trim() || !deckId || saving} onClick={() => void save()}><Check size={18} />{saving ? 'Wird gespeichert …' : 'Karte speichern'}</button></div>
    {!initial && <div className="card-type-switch" aria-label="Kartentyp"><button onClick={() => leave(onImage)}>Bildkarte</button><button aria-pressed="true">Frage & Antwort</button></div>}
    <div className="basic-editor-toolbar"><label className="field-label" htmlFor="basic-deck">Speichern in</label><select id="basic-deck" value={deckId} onChange={e => setDeckId(e.target.value)}>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select><button className="icon-button" aria-label={preview ? 'Text bearbeiten' : 'Vorschau'} aria-pressed={preview} onClick={() => setPreview(value => !value)}>{preview ? <Pencil size={19} /> : <Eye size={19} />}</button></div>
    <div className="basic-editor-faces">{([{ id: 'front', label: 'Frage', value: front, set: setFront }, { id: 'back', label: 'Antwort', value: back, set: setBack }]).map(face => <div className="basic-editor-face" key={face.id}>
      <label className="field-label" htmlFor={`basic-${face.id}`}>{face.label}</label>{preview ? <div className="basic-preview"><CardText text={face.value} /></div> : <textarea id={`basic-${face.id}`} value={face.value} maxLength={MAX_CARD_TEXT_LENGTH} onChange={e => face.set(e.target.value)} rows={7} placeholder={face.label === 'Frage' ? 'Was möchtest du abfragen?' : 'Die Lösung …'} />}
    </div>)}</div>
    <p className="basic-format-hint">Formeln: $…$ oder $$…$$</p>
  </section>
}
