import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Ellipsis, Folder, FolderPlus, ImagePlus, LayoutDashboard, Leaf, Menu, Moon, MoreHorizontal, Plus, Settings2, ShieldCheck, Sparkles, Sun, Trash2, Upload, X } from 'lucide-react'
import { db, defaultPreferences, deleteDeck, initialize, moveImage, removeImage, saveDeck, updatePreferences } from './db'
import { descendants, reviewQueue, type Deck, type ImageRecord } from './domain'
import { prepareImage } from './images'
import { Editor, type DraftImage } from './components/Editor'
import { Review } from './components/Review'
import { useBlobUrl } from './components/ImageSurface'
import { useCloud, type CloudState } from './sync/useCloud'
import { CloudSettings } from './components/CloudSettings'
import { ensureImageAsset } from './sync/runtime'
import { returningFromAuth } from './sync/client'

type View = 'dashboard' | 'library' | 'create' | 'settings'
function deckPath(decks: Deck[], id: string): string {
  const seen = new Set<string>(); const names: string[] = []
  while (id && !seen.has(id)) { seen.add(id); const d = decks.find(d => d.id === id); if (!d) break; names.unshift(d.name); id = d.parentId ?? '' }
  return names.join(' / ')
}

export default function App() {
  const cloud = useCloud()
  const [view, setView] = useState<View>(returningFromAuth ? 'settings' : 'dashboard')
  const [draft, setDraft] = useState<DraftImage | null>(null)
  const [draftVersion, setDraftVersion] = useState(0)
  const [session, setSession] = useState<{ ids: string[]; name: string } | null>(null)
  const [deckDialog, setDeckDialog] = useState<{ deck?: Deck; parentId: string | null } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [clock, setClock] = useState(Date.now())
  const [bootError, setBootError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const processingRef = useRef(false)
  const onError = useCallback((e: unknown) => {
    const name = e instanceof Error ? e.name : ''
    setToast({ message: name.includes('Quota') ? 'Der Gerätespeicher ist voll. Bitte Speicher freigeben, bevor du fortfährst.' : e instanceof Error ? e.message : 'Das hat leider nicht geklappt. Bitte erneut versuchen.', error: true })
  }, [])
  const run = useCallback(async (action: () => Promise<unknown>) => { try { await action() } catch (e) { onError(e) } }, [onError])
  useEffect(() => { initialize().catch(e => setBootError(e instanceof Error ? e.message : 'Der lokale Speicher ist nicht verfügbar.')) }, [])
  const data = useLiveQuery(async () => {
    const [decks, images, cards, reviews, preferences] = await Promise.all([db.decks.toArray(), db.images.toArray(), db.cards.toArray(), db.reviews.toArray(), db.preferences.get('app')])
    return { decks: decks.sort((a, b) => b.updatedAt - a.updatedAt), images, cards, reviews, prefs: preferences ?? defaultPreferences }
  })
  const prefs = data?.prefs ?? defaultPreferences
  const decks = data?.decks ?? []
  const selected = decks.find(d => d.id === prefs.selectedDeckId)
  const root = selected?.id ?? null
  const library = useMemo(() => {
    const decks = data?.decks ?? []
    const prefs = data?.prefs ?? defaultPreferences
    const scope = descendants(decks, root)
    const stats = reviewQueue(data?.cards ?? [], data?.images ?? [], decks, data?.reviews ?? [], prefs, root, new Date(clock))
    const images = (data?.images ?? []).filter(i => scope.has(i.deckId)).sort((a, b) => b.createdAt - a.createdAt)
    const sortedDecks = [...decks].sort((a, b) => deckPath(decks, a.id).localeCompare(deckPath(decks, b.id), 'de'))
    const deckStats = new Map(decks.map(d => {
      const ids = descendants(decks, d.id)
      const imageIds = new Set((data?.images ?? []).filter(i => ids.has(i.deckId)).map(i => i.id))
      return [d.id, { count: (data?.cards ?? []).filter(c => imageIds.has(c.imageId)).length, ready: reviewQueue(data?.cards ?? [], data?.images ?? [], decks, data?.reviews ?? [], prefs, d.id, new Date(clock)).queue.length }]
    }))
    return { stats, images, sortedDecks, deckStats }
  }, [data, root, clock])
  const { stats, images, sortedDecks, deckStats } = library
  const selectDeck = (id: string | null) => { void run(() => db.preferences.update('app', { selectedDeckId: id })); setMenuOpen(false) }
  const navigate = (next: View) => { setView(next); setMenuOpen(false) }
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000)
    const connectivity = () => { setOnline(navigator.onLine); setClock(Date.now()) }
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); window.addEventListener('focus', connectivity)
    return () => { clearInterval(timer); window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity); window.removeEventListener('focus', connectivity) }
  }, [])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', prefs.theme === 'dark' || prefs.theme === 'system' && media.matches)
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [prefs.theme])
  useEffect(() => { if (toast && !toast.error) { const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) } }, [toast])
  async function acceptFile(file: File) {
    if (processingRef.current || session) return
    if (!decks.length) { setDeckDialog({ parentId: null }); onError(new Error('Lege zuerst einen Ordner für deine Karten an.')); return }
    if (draft && !confirm('Den geöffneten Entwurf durch ein neues Bild ersetzen? Ungespeicherte Änderungen gehen verloren.')) return
    processingRef.current = true; setProcessing(true)
    try { const asset = await prepareImage(file); setDraft({ asset, regions: [], deckId: root ?? decks[0].id }); setDraftVersion(v => v + 1) }
    catch (e) { onError(e) }
    finally { processingRef.current = false; setProcessing(false) }
  }
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).matches('input, textarea, [contenteditable]') || deckDialog || session) return
      const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))
      const file = item?.getAsFile(); if (file) { e.preventDefault(); void acceptFile(file) }
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })
  async function editImage(image: ImageRecord) {
    const asset = await ensureImageAsset(image.id)
    setDraft({ asset, regions: await db.regions.where('imageId').equals(image.id).toArray(), deckId: image.deckId, imageId: image.id })
    setDraftVersion(v => v + 1)
  }
  function beginReview() {
    const current = reviewQueue(data?.cards ?? [], data?.images ?? [], decks, data?.reviews ?? [], prefs, root, new Date())
    setSession({ ids: current.queue.map(c => c.id), name: selected?.name ?? 'Alle Ordner' })
  }
  if (bootError) return <div className="fatal-error" role="alert"><h1>Lokaler Speicher nicht verfügbar</h1><p>{bootError}</p><p>Bitte erlaube Website-Daten und verwende einen aktuellen Browser.</p></div>
  if (!data || !cloud.loaded) return <div className="loading-screen" role="status"><span className="brand-mark">o</span> Dein Lernraum wird vorbereitet …</div>
  if (cloud.blocked) return <main className="cloud-lock"><h1>Dein Lernraum ist gesperrt.</h1><p className="muted">Melde dich mit dem verbundenen Konto an, um auf diesem Gerät weiterzulernen.</p><CloudSettings cloud={cloud} onError={onError} />{toast?.error && <p role="alert" className="cloud-error">{toast.message}</p>}</main>
  const cloudLabel = cloud.connection ? !online ? 'Offline · Änderungen bleiben lokal' : cloud.status?.error ? 'Cloud-Verbindung prüfen' : cloud.status?.running ? 'Wird synchronisiert …' : cloud.pending?.length ? `${cloud.pending.length} Änderungen ausstehend` : cloud.status?.lastSuccess ? 'Mit der Cloud synchronisiert' : 'Cloud verbunden' : 'Auf diesem Gerät'

  return <div className={`app-shell ${session ? 'review-shell' : ''}`}>
    {!session && <><div className={`sidebar-scrim ${menuOpen ? 'visible' : ''}`} onClick={() => setMenuOpen(false)} /><aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); if (!draft || confirm('Ungespeicherten Entwurf schließen?')) { setDraft(null); navigate('dashboard') } }}><span className="brand-mark"><span /></span>occlude<span className="brand-dot">.</span></a>
      <span className="workspace-label">DEIN LERNRAUM</span>
      <nav className="primary-nav" aria-label="Hauptnavigation"><button className={view === 'dashboard' && !draft ? 'active' : ''} onClick={() => { if (draft && !confirm('Ungespeicherten Entwurf schließen?')) return; setDraft(null); navigate('dashboard') }}><LayoutDashboard size={18} />Übersicht</button><button className={view === 'library' && !draft ? 'active' : ''} onClick={() => { if (draft && !confirm('Ungespeicherten Entwurf schließen?')) return; setDraft(null); navigate('library') }}><BookOpen size={18} />Kartenbibliothek<span className="nav-count">{data.cards.length}</span></button></nav>
      <div className="sidebar-section-heading"><span>DEINE ORDNER</span><button className="icon-button" aria-label="Ordner erstellen" onClick={() => setDeckDialog({ parentId: root })}><Plus size={16} /></button></div>
      <nav className="deck-nav" aria-label="Ordner"><button className={!root ? 'selected' : ''} onClick={() => selectDeck(null)}><Folder size={16} /><span>Alle Ordner</span></button>{sortedDecks.map(d => <button key={d.id} className={root === d.id ? 'selected' : ''} title={deckPath(decks, d.id)} style={{ paddingLeft: 13 + Math.min(5, deckPath(decks, d.id).split(' / ').length - 1) * 13 }} onClick={() => selectDeck(d.id)}><ChevronRight size={12} /><span>{d.name}</span></button>)}<button className="new-deck-link" onClick={() => setDeckDialog({ parentId: root })}><Plus size={15} />Neuer Ordner</button></nav>
      <div className="sidebar-bottom"><div className="local-status"><span className="status-dot" /><div><strong>{cloudLabel}</strong><span>{cloud.connection ? 'Lokale Daten bleiben verfügbar' : 'Lokal gespeichert · Konto optional'}</span></div><ShieldCheck size={17} /></div><button className={`settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => { if (draft && !confirm('Ungespeicherten Entwurf schließen?')) return; setDraft(null); navigate('settings') }}><Settings2 size={17} />Einstellungen<ChevronRight size={14} /></button><div className="sidebar-footer"><span className="avatar">D</span><div><strong>Dein persönlicher Raum</strong><span>Weniger Aufwand. Mehr Wissen.</span></div></div></div>
    </aside></>}
    <main className="main-panel" onDragOver={e => { if (e.dataTransfer.types.includes('Files') && !session) { e.preventDefault(); setDragging(true) } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }} onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !deckDialog) void acceptFile(f) }}>
      {!session && <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Menü öffnen" onClick={() => setMenuOpen(true)}><Menu size={20} /></button><span>Mein Lernraum</span><ChevronRight size={13} /><strong>{draft ? 'Karte erstellen' : ({ dashboard: 'Übersicht', library: 'Kartenbibliothek', create: 'Karte erstellen', settings: 'Einstellungen' })[view]}</strong></div><div className="topbar-right"><span className="local-pill"><span className="status-dot" />{cloud.connection ? cloud.pending?.length ? 'Ausstehend' : 'Cloud' : 'Lokal'}</span><span className="date-label">{new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(clock))}</span></div></header>}
      <input ref={fileInput} type="file" className="sr-only" aria-label="Bild hochladen" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void acceptFile(file); e.target.value = '' }} />
      <div className={`main-content ${session ? 'session-content' : ''}`}>
      {session ? <Review ids={session.ids} deckName={session.name} onClose={() => { setSession(null); setClock(Date.now()) }} onError={onError} /> : draft ? <Editor key={draftVersion} draft={draft} decks={sortedDecks} onClose={() => setDraft(null)} onError={onError} onSaved={id => { selectDeck(id); setDraft(null); setView('library'); setToast({ message: 'Deine Karten sind gespeichert und bereit zum Lernen.', error: false }) }} /> : view === 'settings' ? <Settings prefs={prefs} run={run} cloud={cloud} onError={onError} /> : view === 'create' ? <><div className="page-heading"><div><p className="eyebrow">VOM SCREENSHOT ZUR LERNKARTE</p><h1>Einfügen. Verdecken. Merken.</h1><p className="muted">Keine Titel, keine langen Formulare. Nur dein Lernstoff.</p></div></div><UploadArea onUpload={() => fileInput.current?.click()} large /><div className="creation-steps">{['Screenshot aufnehmen', 'Begriffe mit Masken verdecken', 'Speichern & direkt lernen'].map((s, i) => <div key={s}><span>{String(i + 1).padStart(2, '0')}</span><p>{s}</p></div>)}</div></> : <>
        <div className="page-heading"><div><p className="eyebrow">{view === 'library' ? 'DEIN WISSEN, AN EINEM ORT' : 'KLEINE SCHRITTE. BLEIBENDES WISSEN.'}</p><h1>{view === 'library' ? 'Deine Kartenbibliothek.' : 'Bereit für einen klaren Kopf?'}</h1><p className="muted">{view === 'library' ? 'Deine Bilder, Masken und Lernkarten. Immer griffbereit.' : 'Ein guter Moment, um etwas im Kopf zu behalten.'}</p></div><button className="button primary create-top" onClick={() => navigate('create')}><Plus size={18} />Karte erstellen</button></div>
        {view === 'dashboard' && <><section className="study-hero"><div className="hero-copy"><span className="hero-tag"><Sparkles size={13} /> DEIN NÄCHSTER LERNMOMENT</span><h2>{stats.queue.length ? `${stats.queue.length} ${stats.queue.length === 1 ? "Karte wartet" : "Karten warten"} auf dich.` : 'Jeder Aha-Moment beginnt klein.'}</h2><p>{stats.queue.length ? 'Ein kurzer Durchgang heute. Ein bisschen sicherer morgen.' : 'Mach aus deinen Vorlesungsfolien Wissen, das bleibt.'}</p><button className="button lime" onClick={stats.queue.length ? beginReview : () => navigate('create')}>{stats.queue.length ? 'Jetzt lernen' : 'Erste Karten erstellen'}<ArrowRight size={18} /></button><span className="hero-footnote"><Clock3 size={13} />{stats.queue.length ? `Etwa ${Math.max(1, Math.ceil(stats.queue.length * .35))} Minuten für dich` : 'Dein Tempo. Dein Lernrhythmus.'}</span></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="illustration-card card-back" /><div className="illustration-card card-front"><span className="art-label">ANATOMIE · 01</span><div className="art-lines"><i /><i /><i /></div><div className="art-branches"><span /><span /><span /></div><div className="art-mask">?</div><div className="art-caption"><span className="tiny-dot" /> Ein bisschen mehr verstanden.</div></div><span className="floating-check"><Check size={24} /></span><span className="art-star">✳</span></div></section>
        <div className="stats-grid"><Stat icon={<Clock3 size={19} />} label="Jetzt fällig" value={stats.due.length} description="Zeit für eine Wiederholung" /><Stat icon={<BookOpen size={19} />} label="Neue Karten" value={stats.fresh.length} description={`Bis zu ${prefs.newLimit} neue Karten pro Tag`} /><Stat icon={<Check size={19} />} label="Heute gelernt" value={stats.today} description="Jede Wiederholung zählt" /></div></>}
        <div className="section-heading"><div><h2>{root ? selected?.name : 'Deine Ordner'}<span className="count-pill">{root ? `${images.length} ${images.length === 1 ? 'Bild' : 'Bilder'}` : decks.length}</span></h2><p className="muted small">{root ? 'Mit allen Unterordnern. Ein Lernraum für deinen nächsten Schritt.' : 'Ein bisschen Ordnung macht den Kopf frei.'}</p></div><div className="section-actions">{root && <><button className="icon-button" aria-label="Ausgewählten Ordner bearbeiten" onClick={() => setDeckDialog({ deck: selected, parentId: selected?.parentId ?? null })}><MoreHorizontal size={20} /></button><button className="button subtle small-button" onClick={beginReview} disabled={!stats.queue.length}>Lernen<ArrowRight size={15} /></button></>}<button className="text-button" onClick={() => setDeckDialog({ parentId: root })}><FolderPlus size={16} />Neuer Ordner</button></div></div>
        <div className="deck-grid">{decks.filter(d => d.parentId === root).map(d => {
          const { count, ready } = deckStats.get(d.id)!
          return <div className="deck-card" key={d.id}><button className="deck-open" onClick={() => selectDeck(d.id)}><span className="folder-emblem"><Folder size={23} strokeWidth={1.5} /></span><h3>{d.name}</h3><span className="muted small">{count} Karten · {data.decks.filter(child => child.parentId === d.id).length} Unterordner</span><div className="deck-card-footer"><span className={ready ? 'due-badge' : 'quiet-badge'}>{ready ? `${ready} ${ready === 1 ? "Karte bereit" : "Karten bereit"}` : count ? 'Alles im Plan' : 'Platz für neues Wissen'}</span><ChevronRight size={16} /></div></button><button className="icon-button deck-options" aria-label={`${d.name} bearbeiten`} onClick={() => setDeckDialog({ deck: d, parentId: d.parentId })}><Ellipsis size={19} /></button></div>
        })}{!decks.length && <button className="new-folder-card" onClick={() => setDeckDialog({ parentId: null })}><FolderPlus size={24} />Deinen ersten Ordner erstellen</button>}</div>
        <div className="section-heading image-section-heading"><div><h2>{view === 'library' ? 'Alle Bilder' : 'Zuletzt hinzugefügt'}<span className="count-pill">{images.length}</span></h2><p className="muted small">Ein Bild. Viele kleine Aha-Momente.</p></div>{view !== 'library' && images.length > 0 && <button className="text-button" onClick={() => navigate('library')}>Alle ansehen<ArrowRight size={15} /></button>}</div>
        {images.length ? <div className="image-grid">{(view === 'library' ? images : images.slice(0, 6)).map(image => <ImageTile key={image.id} image={image} decks={sortedDecks} count={data.cards.filter(c => c.imageId === image.id).length} onEdit={() => void run(() => editImage(image))} onError={onError} />)}</div> : <UploadArea onUpload={() => fileInput.current?.click()} />}
        <footer className="content-footer"><Leaf size={14} /><span>Dein Wissen wächst. Eine Karte nach der anderen.</span><span className="footer-local">Privat. Lokal. Ohne Ablenkung.</span></footer>
      </>}
      </div>
      {(dragging || processing) && <div className="drop-overlay" role="status"><div><ImagePlus size={44} /><h2>{processing ? 'Dein Bild wird vorbereitet …' : 'Hier loslassen. Gleich loslernen.'}</h2><p>PNG, JPEG oder WebP · bis zu 15 MB</p></div></div>}
    </main>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={20} /> : <Check size={20} />}<span>{toast.message}</span><button className="icon-button" aria-label="Meldung schließen" onClick={() => setToast(null)}><X size={17} /></button></div>}
    {deckDialog && <DeckDialog decks={sortedDecks} initial={deckDialog} onClose={() => setDeckDialog(null)} onError={onError} onSaved={id => { selectDeck(id); setDeckDialog(null) }} />}
  </div>
}

function Stat({ icon, label, value, description }: { icon: ReactNode; label: string; value: number; description: string }) {
  return <div className="stat-card"><div className="stat-label">{label}<span>{icon}</span></div><strong>{value.toString().padStart(2, '0')}</strong><span className="muted small">{description}</span></div>
}
function UploadArea({ onUpload, large }: { onUpload: () => void; large?: boolean }) {
  return <div className={`upload-area ${large ? 'large' : ''}`}><span className="upload-icon"><ImagePlus size={25} strokeWidth={1.5} /></span><div><h3>{large ? 'Dein Screenshot ist der Anfang.' : 'Dein nächster Aha-Moment.'}</h3><p>Screenshot einfügen mit <kbd>⌘ / Strg</kbd> <kbd>V</kbd><span className="upload-alternative"> oder ein Bild hierher ziehen.</span></p></div><button className="button subtle" onClick={onUpload}><Upload size={16} />Datei auswählen</button><span className="upload-formats">PNG, JPEG, WebP · max. 15 MB</span></div>
}
function ImageTile({ image, decks, count, onEdit, onError }: { image: ImageRecord; decks: Deck[]; count: number; onEdit: () => void; onError: (e: unknown) => void }) {
  const asset = useLiveQuery(() => db.assets.get(image.assetHash), [image.assetHash])
  const regions = useLiveQuery(() => db.regions.where('imageId').equals(image.id).toArray(), [image.id])
  const url = useBlobUrl(asset?.blob)
  const [options, setOptions] = useState(false)
  const tile = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const [assetError, setAssetError] = useState('')
  useEffect(() => {
    if (!tile.current) return
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '100px' })
    observer.observe(tile.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || asset || assetError) return
    let cancelled = false
    ensureImageAsset(image.id).catch(() => { if (!cancelled) setAssetError('Bild noch nicht lokal') })
    return () => { cancelled = true }
  }, [visible, asset, assetError, image.id])
  return <article ref={tile} className="image-tile"><button className="image-thumbnail" onClick={onEdit} aria-label={`Bild mit ${count} Karten bearbeiten`}><div className="thumbnail-surface" style={{ aspectRatio: asset ? `${asset.width}/${asset.height}` : '16/10', width: `min(100%, calc(var(--thumb-content-height) * ${asset ? asset.width / asset.height : 1.6}))` }}>{url ? <img src={url} alt="Vorschau des Lernbildes" loading="lazy" /> : <span>{assetError || 'Bild wird geladen …'}</span>}{regions?.map(r => <i key={r.id} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }} />)}</div><span className="image-count"><BookOpen size={12} />{count} Karten</span></button><div className="image-tile-info"><div><strong>{decks.find(d => d.id === image.deckId)?.name}</strong><span>{new Date(image.createdAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })} · {asset ? `${asset.width} × ${asset.height}` : 'Bild fehlt'}</span></div><button className="icon-button" aria-label="Bildoptionen" aria-expanded={options} onClick={() => setOptions(!options)}><MoreHorizontal size={19} /></button></div>{options && <div className="image-options"><label>Verschieben nach<select aria-label="Bild verschieben nach" value={image.deckId} onChange={e => { moveImage(image.id, e.target.value).then(() => setOptions(false)).catch(onError) }}>{decks.map(d => <option key={d.id} value={d.id}>{deckPath(decks, d.id)}</option>)}</select></label><button className="danger text-button" onClick={() => { if (confirm('Bild, alle Masken und deren Lernfortschritt endgültig löschen?')) removeImage(image.id).catch(onError) }}><Trash2 size={15} />Bild löschen</button></div>}</article>
}

function DeckDialog({ decks, initial, onClose, onSaved, onError }: { decks: Deck[]; initial: { deck?: Deck; parentId: string | null }; onClose: () => void; onSaved: (id: string) => void; onError: (e: unknown) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(initial.deck?.name ?? '')
  const [parentId, setParentId] = useState(initial.parentId ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  const excluded = initial.deck ? descendants(decks, initial.deck.id) : new Set()
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); try { const id = await saveDeck(name, parentId || null, initial.deck?.id); onSaved(id) } catch (e) { onError(e) } finally { setBusy(false) } }
  return <dialog ref={dialog} onCancel={onClose} className="dialog"><form onSubmit={e => void submit(e)}><div className="dialog-heading"><span className="folder-emblem"><FolderPlus size={22} /></span><button className="icon-button" type="button" aria-label="Dialog schließen" onClick={onClose}><X size={19} /></button></div><h2>{initial.deck ? 'Ordner bearbeiten' : 'Raum für neues Wissen.'}</h2><p className="muted">{initial.deck ? 'Name und Platz in deiner Ordnerstruktur ändern.' : 'Ein Thema, eine Vorlesung oder ein ganzes Semester.'}</p><label>Name<input name="name" autoFocus required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="z. B. Anatomie" /></label><label>Übergeordneter Ordner<select value={parentId} onChange={e => setParentId(e.target.value)}><option value="">Kein übergeordneter Ordner</option>{decks.filter(d => !excluded.has(d.id)).map(d => <option key={d.id} value={d.id}>{deckPath(decks, d.id)}</option>)}</select></label><div className="dialog-actions">{initial.deck && <button type="button" className="icon-button danger" aria-label="Ordner löschen" disabled={busy} onClick={async () => { if (!confirm('Diesen Ordner mit allen Unterordnern, Bildern, Karten und Lernfortschritten endgültig löschen?')) return; setBusy(true); try { await deleteDeck(initial.deck!.id); onClose() } catch (e) { onError(e); setBusy(false) } }}><Trash2 size={18} /></button>}<button className="button subtle" type="button" onClick={onClose}>Abbrechen</button><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Wird gespeichert …' : initial.deck ? 'Speichern' : 'Ordner erstellen'}</button></div></form></dialog>
}

function Settings({ prefs, run, cloud, onError }: { prefs: typeof defaultPreferences; run: (a: () => Promise<unknown>) => Promise<void>; cloud: CloudState; onError: (e: unknown) => void }) {
  const [storage, setStorage] = useState<string>('')
  const [persistent, setPersistent] = useState<boolean | null>(null)
  useEffect(() => {
    navigator.storage?.estimate?.().then(({ usage, quota }) => setStorage(`${((usage ?? 0) / 1024 / 1024).toFixed(1)} MB von ca. ${((quota ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GB verwendet`)).catch(() => setStorage('Speicherbelegung nicht verfügbar'))
    navigator.storage?.persisted?.().then(setPersistent).catch(() => setPersistent(false))
  }, [])
  return <section className="settings-page"><div className="page-heading"><div><p className="eyebrow">SO LERNST DU</p><h1>Dein Tempo. Deine Routine.</h1><p className="muted">Ein paar Einstellungen, damit es zu dir passt.</p></div></div><div className="settings-card"><h2><BookOpen size={20} />Lernplan</h2><label className="setting-row"><span><strong>Neue Karten pro Tag</strong><small>Gilt für alle Ordner zusammen.</small></span><input aria-label="Neue Karten pro Tag" type="number" min={0} max={500} value={prefs.newLimit} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 500) void run(() => updatePreferences({ newLimit: n })) }} /></label><label className="setting-row"><span><strong>Ein neuer Lerntag beginnt um</strong><small>In deiner lokalen Zeitzone.</small></span><select value={prefs.dayBoundary} onChange={e => void run(() => updatePreferences({ dayBoundary: Number(e.target.value) }))}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00 Uhr</option>)}</select></label></div><div className="settings-card"><h2><Sun size={20} />Darstellung</h2><div className="theme-buttons">{([{ id: 'light', label: 'Hell', Icon: Sun }, { id: 'dark', label: 'Dunkel', Icon: Moon }, { id: 'system', label: 'System', Icon: Settings2 }] as const).map(({ id, label, Icon }) => <button className={`button ${prefs.theme === id ? 'selected' : ''}`} key={id} aria-pressed={prefs.theme === id} onClick={() => void run(() => db.preferences.update('app', { theme: id }))}><Icon size={17} />{label}</button>)}</div></div><CloudSettings cloud={cloud} onError={onError} /><div className="settings-card"><h2><ShieldCheck size={20} />Lokaler Speicher</h2><div className="info-row"><span className="status-dot" /><div><strong>Deine Karten auf diesem Gerät</strong><p>Bilder und Lernereignisse werden in diesem Browser gespeichert. Verbundene Konten synchronisieren Änderungen mit Supabase. Ein vollständiger Offline-Neustart und ein Export sind noch nicht verfügbar.</p></div></div><p className="muted small">{storage || 'Speicherbelegung wird ermittelt …'}</p><p className="muted small">{persistent ? 'Der Browser hat dauerhaften Speicher gewährt.' : 'Browser können Website-Daten löschen. Dauerhafter Speicher ist nicht garantiert.'}</p><button className="button subtle" onClick={() => void run(async () => { if (!navigator.storage?.persist) throw new Error('Dieser Browser unterstützt die Anfrage nach dauerhaftem Speicher nicht.'); setPersistent(await navigator.storage.persist()) })}><ArrowDownToLine size={16} />Dauerhaften Speicher anfragen</button><p className="settings-warning">Bitte bewahre Originalbilder auf und lösche keine Website-Daten, solange Änderungen ausstehen. Cloud-Synchronisierung ersetzt keinen unabhängigen Export. Ein vollständiger Neustart ohne Internet ist noch nicht verfügbar.</p></div></section>
}
