import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Eye, ImagePlus, Pencil, Trash2 } from 'lucide-react'
import { db, saveBasicCard } from '../db'
import { MAX_CARD_TEXT_LENGTH, type BasicCard, type Deck } from '../domain'
import { CardFace } from './CardFace'
import { MAX_CARD_SVG_LENGTH, validCardSvg } from '../cardSvg'

export type BasicDraft = BasicCard | { deckId: string }
export function BasicEditor({ draft, decks, onClose, onImage, onSaved, onError }: { draft: BasicDraft; decks: Deck[]; onClose: () => void; onImage: () => void; onSaved: (id: string) => void; onError: (e: unknown) => void }) {
  const initial = 'id' in draft ? draft : null
  const [front, setFront] = useState(initial?.front ?? '')
  const [back, setBack] = useState(initial?.back ?? '')
  const [frontSvg, setFrontSvg] = useState(initial?.frontSvg ?? '')
  const [backSvg, setBackSvg] = useState(initial?.backSvg ?? '')
  const [deckId, setDeckId] = useState(draft.deckId)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const locked = useRef(false)
  const dirty = front !== (initial?.front ?? '') || back !== (initial?.back ?? '') || frontSvg !== (initial?.frontSvg ?? '') || backSvg !== (initial?.backSvg ?? '') || deckId !== draft.deckId
  const leave = (action: () => void) => { if (!dirty || confirm('Ungespeicherte Änderungen verwerfen?')) action() }
  async function save() {
    if (locked.current || !front.trim() || !back.trim() || !deckId) return
    locked.current = true; setSaving(true)
    try { await saveBasicCard(deckId, front, back, initial?.id, db, { frontSvg, backSvg }); onSaved(deckId) }
    catch (e) { onError(e) }
    finally { locked.current = false; setSaving(false) }
  }
  async function upload(file: File, set: (value: string) => void) {
    try {
      if (file.size > MAX_CARD_SVG_LENGTH * 4) throw new Error('Die Grafik ist zu groß.')
      const svg = (await file.text()).trim()
      if (!svg || !validCardSvg(svg)) throw new Error('Bitte eine eigenständige SVG-Grafik ohne Skripte oder externe Inhalte auswählen.')
      set(svg)
    } catch (e) { onError(e) }
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
    <div className="basic-editor-faces">{([{ id: 'front', label: 'Frage', value: front, set: setFront, svg: frontSvg, setSvg: setFrontSvg }, { id: 'back', label: 'Antwort', value: back, set: setBack, svg: backSvg, setSvg: setBackSvg }]).map(face => <div className="basic-editor-face" key={face.id}>
      <label className="field-label" htmlFor={`basic-${face.id}`}>{face.label}</label>{preview ? <div className="basic-preview"><CardFace text={face.value} svg={face.svg} label={face.label} /></div> : <><textarea id={`basic-${face.id}`} value={face.value} maxLength={MAX_CARD_TEXT_LENGTH} onChange={e => face.set(e.target.value)} rows={7} placeholder={face.label === 'Frage' ? 'Was möchtest du abfragen?' : 'Die Lösung …'} />{face.svg && <CardFace text="" svg={face.svg} label={face.label} />}<div className="basic-artwork-actions"><label className="text-button"><ImagePlus size={16} />{face.svg ? 'Grafik ersetzen' : 'Grafik hinzufügen'}<input type="file" className="sr-only" aria-label={`SVG zur ${face.label} hinzufügen`} accept="image/svg+xml,.svg" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file, face.setSvg); e.target.value = '' }} /></label>{face.svg && <button className="icon-button" aria-label={`Grafik zur ${face.label} entfernen`} onClick={() => face.setSvg('')}><Trash2 size={16} /></button>}</div></>}
    </div>)}</div>
    <p className="basic-format-hint">Formeln: $…$ oder $$…$$</p>
  </section>
}
