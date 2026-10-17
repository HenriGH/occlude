import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Hand, MousePointer2, RectangleHorizontal, Trash2, Undo2 } from 'lucide-react'
import { ImageSurface } from './ImageSurface'
import { saveImage } from '../db'
import type { Asset, Deck, Rect } from '../domain'

export interface DraftImage { asset: Asset; regions: Rect[]; deckId: string; imageId?: string }
export function Editor({ draft, decks, onClose, onSaved, onError }: { draft: DraftImage; decks: Deck[]; onClose: () => void; onSaved: (deckId: string) => void; onError: (error: unknown) => void }) {
  const [regions, setRegions] = useState(draft.regions)
  const [history, setHistory] = useState<Rect[][]>([])
  const [selected, setSelected] = useState<string>()
  const [tool, setTool] = useState<'draw' | 'select' | 'pan'>('draw')
  const [deckId, setDeckId] = useState(draft.deckId)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  function change(next: Rect[]) { setHistory(h => [...h, regions]); setRegions(next); setDirty(true) }
  function undo() { if (history.length) { setRegions(history.at(-1)!); setHistory(h => h.slice(0, -1)); setSelected(undefined) } }
  async function save() {
    if (saving || !regions.length || !deckId) return
    setSaving(true)
    try { await saveImage(draft.asset, deckId, regions, draft.imageId); onSaved(deckId) }
    catch (e) { onError(e); setSaving(false) }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input, select, textarea')) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void save() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); change(regions.filter(r => r.id !== selected)); setSelected(undefined) }
      if (e.key.toLowerCase() === 'v') setTool('select')
      if (e.key.toLowerCase() === 'r') setTool('draw')
      if (e.key.toLowerCase() === 'h') setTool('pan')
    }
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    window.addEventListener('keydown', handler); window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('beforeunload', beforeUnload) }
  })
  return <section className="editor-page">
    <button className="back-link" onClick={() => { if (!dirty || confirm('Ungespeicherte Änderungen verwerfen?')) onClose() }}><ArrowLeft size={16} /> Zur Übersicht</button>
    <div className="page-heading"><div><h1>{draft.imageId ? 'Masken bearbeiten' : 'Masken zeichnen'}</h1></div><button className="button primary" onClick={() => void save()} disabled={!regions.length || !deckId || saving}><Check size={18} />{saving ? 'Wird gespeichert …' : `${regions.length} ${regions.length === 1 ? 'Karte' : 'Karten'} speichern`}</button></div>
    <div className="editor-layout"><div className="editor-board"><div className="editor-toolbar"><div className="tool-group">{([{ id: 'draw', icon: RectangleHorizontal, label: 'Maske zeichnen (R)' }, { id: 'select', icon: MousePointer2, label: 'Maske bearbeiten (V)' }, { id: 'pan', icon: Hand, label: 'Bild verschieben (H)' }] as const).map(t => <button key={t.id} className={`icon-button ${tool === t.id ? 'active' : ''}`} aria-label={t.label} aria-pressed={tool === t.id} title={t.label} onClick={() => setTool(t.id)}><t.icon size={19} /></button>)}<span className="divider" /><button className="icon-button" aria-label="Rückgängig" title="Rückgängig (⌘/Strg + Z)" disabled={!history.length} onClick={undo}><Undo2 size={18} /></button></div><span className="muted small">{draft.asset.width} × {draft.asset.height} px</span></div><ImageSurface asset={draft.asset} regions={regions} onChange={change} tool={tool} selected={selected} onSelect={setSelected} /><p className="editor-hint">{tool === 'draw' ? 'Ziehen, um eine Maske zu zeichnen.' : tool === 'select' ? 'Maske verschieben oder vergrößern.' : 'Ziehen zum Verschieben. Zwei Finger zum Zoomen.'}</p></div>
    <aside className="editor-inspector"><label className="field-label" htmlFor="editor-deck">SPEICHERN IN</label><select id="editor-deck" value={deckId} onChange={e => { setDeckId(e.target.value); setDirty(true) }}>{decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select><div className="inspector-title"><h3>Deine Masken</h3><span className="count-pill">{regions.length}</span></div>{regions.length ? <div className="mask-list">{regions.map((r, i) => <div className={`mask-row ${selected === r.id ? 'selected' : ''}`} key={r.id}><button onClick={() => { setSelected(r.id); setTool('select') }}><span className="mask-number">{String(i + 1).padStart(2, '0')}</span>Maske {i + 1}</button><button className="icon-button" aria-label={`Maske ${i + 1} löschen`} onClick={() => { change(regions.filter(item => item.id !== r.id)); setSelected(undefined) }}><Trash2 size={15} /></button></div>)}</div> : <div className="inspector-empty"><RectangleHorizontal size={28} /><p>Noch keine Masken</p></div>}<span className="shortcut-hint">Speichern <kbd>⌘ / Strg</kbd> <kbd>↵</kbd></span></aside></div>
  </section>
}
