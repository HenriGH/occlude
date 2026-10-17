import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Ellipsis, Folder, FolderPlus, ImagePlus, LayoutDashboard, Menu, Moon, MoreHorizontal, Plus, Settings2, ShieldCheck, Sun, Trash2, X } from 'lucide-react'
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
import { StudySummary } from './components/StudySummary'
import { BrandMark } from './components/BrandMark'
import { applyAppearance } from './appearance'
import { StartupScreen } from './components/StartupScreen'
import { DeckNavigation } from './components/DeckNavigation'

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
  const data = useLiveQuery(() => db.transaction('r', [db.decks, db.images, db.cards, db.reviews, db.preferences], async () => {
    const [decks, images, cards, reviews, preferences] = await Promise.all([db.decks.toArray(), db.images.toArray(), db.cards.toArray(), db.reviews.toArray(), db.preferences.get('app')])
    // Do not expose actions against an empty pre-initialization snapshot. Read
    // the seed folder and its preferences atomically, without waiting on Auth.
    if (!preferences) return undefined
    return { decks: decks.sort((a, b) => b.updatedAt - a.updatedAt), images, cards, reviews, prefs: preferences }
  }))
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
    const scopedImageIds = new Set(images.map(i => i.id))
    const sortedDecks = [...decks].sort((a, b) => deckPath(decks, a.id).localeCompare(deckPath(decks, b.id), 'de'))
    const deckStats = new Map(decks.map(d => {
      const ids = descendants(decks, d.id)
      const imageIds = new Set((data?.images ?? []).filter(i => ids.has(i.deckId)).map(i => i.id))
      return [d.id, { count: (data?.cards ?? []).filter(c => imageIds.has(c.imageId)).length, ready: reviewQueue(data?.cards ?? [], data?.images ?? [], decks, data?.reviews ?? [], prefs, d.id, new Date(clock)).queue.length }]
    }))
    return { stats, images, sortedDecks, deckStats, inFolder: (data?.cards ?? []).filter(c => scopedImageIds.has(c.imageId)).length }
  }, [data, root, clock])
  const { stats, images, sortedDecks, deckStats, inFolder } = library
  const selectDeck = (id: string | null) => { void run(() => db.preferences.update('app', { selectedDeckId: id })); setMenuOpen(false) }
  const navigate = (next: View) => { setView(next); setMenuOpen(false) }
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000)
    const connectivity = () => { setOnline(navigator.onLine); setClock(Date.now()) }
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); window.addEventListener('focus', connectivity)
    return () => { clearInterval(timer); window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity); window.removeEventListener('focus', connectivity) }
  }, [])
  useEffect(() => {
    if (!data) return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => applyAppearance(prefs.theme)
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [data?.prefs.theme])
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
  if (bootError) return <StartupScreen error />
  if (!data || !cloud.loaded) return <StartupScreen />
  if (cloud.blocked) return <main className="cloud-lock"><h1>Dein Lernraum ist gesperrt.</h1><p className="muted">Melde dich mit dem verbundenen Konto an, um auf diesem Gerät weiterzulernen.</p><CloudSettings cloud={cloud} onError={onError} />{toast?.error && <p role="alert" className="cloud-error">{toast.message}</p>}</main>
  const cloudLabel = cloud.connection ? !online ? 'Offline' : cloud.status?.error ? 'Cloud prüfen' : cloud.status?.running ? 'Synchronisiert …' : cloud.pending?.length ? `${cloud.pending.length} ausstehend` : cloud.status?.lastSuccess ? 'Synchronisiert' : 'Cloud verbunden' : 'Lokal gespeichert'
  const awaitingCloud = !cloud.authReady || !!cloud.session && !cloud.connection || !!cloud.connection && !cloud.status?.lastSuccess
  const restoring = awaitingCloud && !data.cards.length
  const cloudMessage = !cloud.authReady ? 'Anmeldung wird geprüft …' : !online ? 'Verbinde dich mit dem Internet, um deine Karten zu laden.' : cloud.status?.error ? 'Deine Karten konnten noch nicht geladen werden.' : !cloud.session && cloud.connection ? 'Melde dich an, um deine Karten zu laden.' : !cloud.connection ? 'Verbinde dieses Gerät, um deine Karten zu laden.' : 'Karten werden synchronisiert …'

  return <div className={`app-shell ${session ? 'review-shell' : ''}`}>
    {!session && <><div className={`sidebar-scrim ${menuOpen ? 'visible' : ''}`} onClick={() => setMenuOpen(false)} /><aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); if (!draft || confirm('Ungespeicherten Entwurf schließen?')) { setDraft(null); navigate('dashboard') } }}><BrandMark />occlude<span className="brand-dot">.</span></a>
      <nav className="primary-nav" aria-label="Hauptnavigation"><button className={view === 'dashboard' && !draft ? 'active' : ''} onClick={() => { if (draft && !confirm('Ungespeicherten Entwurf schließen?')) return; setDraft(null); navigate('dashboard') }}><LayoutDashboard size={18} />Übersicht</button><button className={view === 'library' && !draft ? 'active' : ''} onClick={() => { if (draft && !confirm('Ungespeicherten Entwurf schließen?')) return; setDraft(null); navigate('library') }}><BookOpen size={18} />Bibliothek<span className="nav-count">{data.cards.length}</span></button></nav>
      <div className="sidebar-section-heading"><span>Ordner</span><button className="icon-button" aria-label="Ordner erstellen" onClick={() => setDeckDialog({ parentId: root })}><Plus size={16} /></button></div>
      <DeckNavigation decks={sortedDecks} selectedId={root} onSelect={selectDeck} onCreate={() => setDeckDialog({ parentId: root })} />
      <div className="sidebar-bottom"><button className={`settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => { if (draft && !confirm('Ungespeicherten Entwurf schließen?')) return; setDraft(null); navigate('settings') }}><Settings2 size={18} />Einstellungen<ChevronRight size={15} /></button></div>
    </aside></>}
    <main className="main-panel" onDragOver={e => { if (e.dataTransfer.types.includes('Files') && !session) { e.preventDefault(); setDragging(true) } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }} onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !deckDialog) void acceptFile(f) }}>
      {!session && <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Menü öffnen" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={22} /></button><span className="topbar-brand"><BrandMark />occlude<span>.</span></span><strong className="desktop-view-name">{draft ? 'Editor' : ({ dashboard: 'Übersicht', library: 'Bibliothek', create: 'Neue Karte', settings: 'Einstellungen' })[view]}</strong></div><button className="sync-indicator" onClick={() => { if (draft && !confirm('Ungespeicherten Entwurf schließen?')) return; setDraft(null); navigate('settings') }} aria-label={`Cloud-Status: ${cloudLabel}`} title={cloudLabel}><span className="status-dot" /><span>{cloudLabel}</span></button></header>}
      <input ref={fileInput} type="file" className="sr-only" aria-label="Bild hochladen" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void acceptFile(file); e.target.value = '' }} />
      <div className={`main-content ${session ? 'session-content' : ''}`}>
      {session ? <Review ids={session.ids} deckName={session.name} onClose={() => { setSession(null); setClock(Date.now()) }} onError={onError} /> : draft ? <Editor key={draftVersion} draft={draft} decks={sortedDecks} onClose={() => setDraft(null)} onError={onError} onSaved={id => { selectDeck(id); setDraft(null); setView('library'); setToast({ message: 'Gespeichert', error: false }) }} /> : view === 'settings' ? <Settings prefs={prefs} run={run} cloud={cloud} onError={onError} /> : view === 'create' ? <><div className="page-heading"><h1>Neue Karte</h1></div><UploadArea onUpload={() => fileInput.current?.click()} large /></> : <>
        <div className="page-heading"><h1>{view === 'library' ? 'Bibliothek' : 'Übersicht'}</h1><button className="button primary create-top" onClick={() => navigate('create')}><Plus size={18} />Karte erstellen</button></div>
        {view === 'dashboard' && <>
          <StudySummary ready={stats.queue.length} total={data.cards.length} inFolder={inFolder} awaitingCloud={awaitingCloud} cloudMessage={cloudMessage} onReview={beginReview} onLibrary={() => { selectDeck(null); navigate('library') }} onCloud={() => navigate('settings')} />
          {data.cards.length > 0 && <div className="stats-grid"><Stat label="Fällig" value={stats.due.length} /><Stat label="Neu" value={stats.fresh.length} /><Stat label="Heute gelernt" value={stats.today} /></div>}
        </>}
        {!restoring && <>
        <div className="section-heading"><div><h2>{root ? selected?.name : 'Ordner'}<span className="count-pill">{root ? `${images.length} ${images.length === 1 ? 'Bild' : 'Bilder'}` : decks.length}</span></h2></div><div className="section-actions">{root && <><button className="icon-button" aria-label="Ausgewählten Ordner bearbeiten" onClick={() => setDeckDialog({ deck: selected, parentId: selected?.parentId ?? null })}><MoreHorizontal size={20} /></button>{stats.queue.length > 0 && <button className="button subtle small-button" onClick={beginReview}>Lernen<ArrowRight size={15} /></button>}</>}<button className="text-button" onClick={() => setDeckDialog({ parentId: root })}><FolderPlus size={16} />Neuer Ordner</button></div></div>
        <div className="deck-grid">{decks.filter(d => d.parentId === root).map(d => {
          const { count, ready } = deckStats.get(d.id)!
          return <div className="deck-card" key={d.id}><button className="deck-open" onClick={() => selectDeck(d.id)}><span className="folder-emblem"><Folder size={23} strokeWidth={1.5} /></span><h3>{d.name}</h3><span className="muted small">{count} Karten</span><div className="deck-card-footer"><span className={ready ? 'due-badge' : 'quiet-badge'}>{ready ? `${ready} ${ready === 1 ? "Karte bereit" : "Karten bereit"}` : count ? 'Nichts fällig' : 'Leer'}</span><ChevronRight size={16} /></div></button><button className="icon-button deck-options" aria-label={`${d.name} bearbeiten`} onClick={() => setDeckDialog({ deck: d, parentId: d.parentId })}><Ellipsis size={19} /></button></div>
        })}</div>
        <div className="section-heading image-section-heading"><div><h2>{view === 'library' ? 'Alle Bilder' : 'Zuletzt hinzugefügt'}<span className="count-pill">{images.length}</span></h2></div>{view !== 'library' && images.length > 0 && <button className="text-button" onClick={() => navigate('library')}>Alle ansehen<ArrowRight size={15} /></button>}</div>
        {images.length ? <div className="image-grid">{(view === 'library' ? images : images.slice(0, 6)).map(image => <ImageTile key={image.id} image={image} decks={sortedDecks} count={data.cards.filter(c => c.imageId === image.id).length} onEdit={() => void run(() => editImage(image))} onError={onError} />)}</div> : <UploadArea onUpload={() => fileInput.current?.click()} />}
        </>}
        {restoring && view === 'library' && <div className="library-placeholder" role="status">{cloudMessage}<button className="text-button" onClick={() => navigate('settings')}>Cloud öffnen<ArrowRight size={16} /></button></div>}
      </>}
      </div>
      {(dragging || processing) && <div className="drop-overlay" role="status"><div><ImagePlus size={44} /><h2>{processing ? 'Dein Bild wird vorbereitet …' : 'Hier loslassen. Gleich loslernen.'}</h2><p>PNG, JPEG oder WebP · bis zu 15 MB</p></div></div>}
    </main>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={20} /> : <Check size={20} />}<span>{toast.message}</span><button className="icon-button" aria-label="Meldung schließen" onClick={() => setToast(null)}><X size={17} /></button></div>}
    {deckDialog && <DeckDialog decks={sortedDecks} initial={deckDialog} onClose={() => setDeckDialog(null)} onError={onError} onSaved={id => { selectDeck(id); setDeckDialog(null) }} />}
  </div>
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat-card"><strong>{value}</strong><span>{label}</span></div>
}
function UploadArea({ onUpload, large }: { onUpload: () => void; large?: boolean }) {
  return <div className={`upload-area ${large ? 'large' : ''}`}><span className="upload-icon"><ImagePlus size={26} strokeWidth={1.5} /></span><div><h3>Bild hinzufügen</h3><p>Einfügen, hierher ziehen oder auswählen.</p></div><button className="button subtle" onClick={onUpload}><Plus size={17} />Bild auswählen</button><span className="upload-formats">PNG, JPEG, WebP · bis 15 MB</span></div>
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
  return <dialog ref={dialog} onCancel={onClose} className="dialog"><form onSubmit={e => void submit(e)}><div className="dialog-heading"><span className="folder-emblem"><FolderPlus size={22} /></span><button className="icon-button" type="button" aria-label="Dialog schließen" onClick={onClose}><X size={19} /></button></div><h2>{initial.deck ? 'Ordner bearbeiten' : 'Neuer Ordner'}</h2><label>Name<input name="name" autoFocus required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="z. B. Anatomie" /></label><label>Übergeordneter Ordner<select value={parentId} onChange={e => setParentId(e.target.value)}><option value="">Kein übergeordneter Ordner</option>{decks.filter(d => !excluded.has(d.id)).map(d => <option key={d.id} value={d.id}>{deckPath(decks, d.id)}</option>)}</select></label><div className="dialog-actions">{initial.deck && <button type="button" className="icon-button danger" aria-label="Ordner löschen" disabled={busy} onClick={async () => { if (!confirm('Diesen Ordner mit allen Unterordnern, Bildern, Karten und Lernfortschritten endgültig löschen?')) return; setBusy(true); try { await deleteDeck(initial.deck!.id); onClose() } catch (e) { onError(e); setBusy(false) } }}><Trash2 size={18} /></button>}<button className="button subtle" type="button" onClick={onClose}>Abbrechen</button><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Wird gespeichert …' : initial.deck ? 'Speichern' : 'Ordner erstellen'}</button></div></form></dialog>
}

function Settings({ prefs, run, cloud, onError }: { prefs: typeof defaultPreferences; run: (a: () => Promise<unknown>) => Promise<void>; cloud: CloudState; onError: (e: unknown) => void }) {
  const [storage, setStorage] = useState<string>('')
  const [persistent, setPersistent] = useState<boolean | null>(null)
  useEffect(() => {
    navigator.storage?.estimate?.().then(({ usage, quota }) => setStorage(`${((usage ?? 0) / 1024 / 1024).toFixed(1)} MB von ca. ${((quota ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GB verwendet`)).catch(() => setStorage('Speicherbelegung nicht verfügbar'))
    navigator.storage?.persisted?.().then(setPersistent).catch(() => setPersistent(false))
  }, [])
  return <section className="settings-page"><div className="page-heading"><h1>Einstellungen</h1></div><div className="settings-card"><h2><BookOpen size={20} />Lernplan</h2><label className="setting-row"><span><strong>Neue Karten pro Tag</strong><small>Alle Ordner</small></span><input aria-label="Neue Karten pro Tag" type="number" min={0} max={500} value={prefs.newLimit} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 500) void run(() => updatePreferences({ newLimit: n })) }} /></label><label className="setting-row"><span><strong>Tagesbeginn</strong><small>Lokale Uhrzeit</small></span><select value={prefs.dayBoundary} onChange={e => void run(() => updatePreferences({ dayBoundary: Number(e.target.value) }))}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00 Uhr</option>)}</select></label></div><div className="settings-card"><h2><Sun size={20} />Darstellung</h2><div className="theme-buttons">{([{ id: 'light', label: 'Hell', Icon: Sun }, { id: 'dark', label: 'Dunkel', Icon: Moon }, { id: 'system', label: 'System', Icon: Settings2 }] as const).map(({ id, label, Icon }) => <button className={`button ${prefs.theme === id ? 'selected' : ''}`} key={id} aria-pressed={prefs.theme === id} onClick={() => void run(() => db.preferences.update('app', { theme: id }))}><Icon size={17} />{label}</button>)}</div></div><CloudSettings cloud={cloud} onError={onError} /><div className="settings-card"><h2><ShieldCheck size={20} />Lokaler Speicher</h2><p className="muted small">{storage || 'Speicherbelegung wird ermittelt …'}</p><p className="muted small">{persistent ? 'Der Browser hat dauerhaften Speicher gewährt.' : 'Browser können Website-Daten löschen. Dauerhafter Speicher ist nicht garantiert.'}</p><button className="button subtle" onClick={() => void run(async () => { if (!navigator.storage?.persist) throw new Error('Dieser Browser unterstützt die Anfrage nach dauerhaftem Speicher nicht.'); setPersistent(await navigator.storage.persist()) })}><ArrowDownToLine size={16} />Dauerhaften Speicher anfragen</button><p className="settings-warning">Website-Daten erst löschen, wenn alle Änderungen synchronisiert sind. Offline-Neustart und Export sind noch nicht verfügbar.</p></div></section>
}
