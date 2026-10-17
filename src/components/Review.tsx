import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, Check, Eye, Layers } from 'lucide-react'
import { db, rateCard } from '../db'
import { scheduler, type Flashcard, type Grade } from '../domain'
import { ImageSurface } from './ImageSurface'
import { ensureImageAsset } from '../sync/runtime'

function interval(due: Date, now: Date) {
  const minutes = Math.max(1, Math.round((+due - +now) / 60000))
  if (minutes < 60) return `${minutes} Min.`
  if (minutes < 1440) return `${Math.round(minutes / 60)} Std.`
  return `${Math.round(minutes / 1440)} Tage`
}
export function Review({ ids, deckName, onClose, onError }: { ids: string[]; deckName: string; onClose: () => void; onError: (e: unknown) => void }) {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [assetError, setAssetError] = useState('')
  const data = useLiveQuery(async () => {
    const card = ids[index] ? await db.cards.get(ids[index]) : undefined
    if (!card) return null
    const image = await db.images.get(card.imageId)
    const asset = image ? await db.assets.get(image.assetHash) : undefined
    const regions = await db.regions.where('imageId').equals(card.imageId).toArray()
    return { card, asset, regions }
  }, [ids, index])
  useEffect(() => { setAssetError('') }, [index])
  useEffect(() => {
    if (!data || data.asset || assetError) return
    let cancelled = false
    ensureImageAsset(data.card.imageId).catch(e => { if (!cancelled) setAssetError(e instanceof Error ? e.message : 'Das Bild konnte nicht geladen werden.') })
    return () => { cancelled = true }
  }, [data?.card.id, data?.asset, assetError])
  async function rate(grade: Grade) {
    if (locked.current || !revealed || !data?.asset) return
    locked.current = true; setBusy(true)
    try { await rateCard(data.card.id, grade); setRevealed(false); setIndex(i => i + 1) }
    catch (e) { onError(e) }
    finally { locked.current = false; setBusy(false) }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement).matches('input, select, textarea, button')) return
      if (e.code === 'Space' && data?.asset) { e.preventDefault(); setRevealed(true) }
      if (revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); void rate(Number(e.key) as Grade) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })
  const complete = index >= ids.length
  const question = data?.regions.find(r => r.id === data.card.regionId)?.label
  return <section className="review-page">
    <div className="review-header"><button className="back-link" onClick={onClose}><ArrowLeft size={17} /> Lernen beenden</button><span className="review-deck"><Layers size={15} />{deckName}</span><span className="mono">{Math.min(index + 1, ids.length)} / {ids.length}</span></div>
    <div className="review-progress"><div style={{ width: `${ids.length ? index / ids.length * 100 : 100}%` }} /></div>
    {complete ? <div className="session-complete"><span className="success-emblem"><Check size={40} /></span><h1>Fertig für jetzt</h1><p className="muted">{index} {index === 1 ? 'Karte wiederholt' : 'Karten wiederholt'}. Lokal gespeichert.</p><button className="button primary" onClick={onClose}>Zur Übersicht <ArrowRight size={17} /></button></div> : <>
      <div className="review-instruction"><h1>{revealed ? 'Wie gut wusstest du es?' : question || 'Was ist verdeckt?'}</h1>{revealed && question && <p>{question}</p>}</div>
      {data === undefined ? <p role="status">Karte wird geladen …</p> : !data?.asset ? <div className="empty-panel"><h2>{data ? 'Bild auf diesem Gerät nicht verfügbar' : 'Diese Karte wurde gelöscht'}</h2><p>{assetError || (data ? 'Das Originalbild wird geladen …' : 'Die Karte kann gerade nicht bewertet werden.')}</p>{data && assetError && <button className="button" onClick={() => setAssetError('')}>Bild erneut laden</button>}<button className="button" onClick={() => { setIndex(i => i + 1); setRevealed(false) }}>Überspringen</button></div> : <>
        <div className={`review-image ${revealed ? 'revealed' : ''}`}><ImageSurface key={data.card.id} asset={data.asset} regions={data.regions} targetId={data.card.regionId} revealed={revealed} /></div>
        <div className="review-actions">{revealed ? <RatingButtons card={data.card} busy={busy} onRate={rate} /> : <><button className="button primary reveal-button" onClick={() => setRevealed(true)}><Eye size={19} /> Antwort zeigen <kbd>Leertaste</kbd></button></>}</div>
      </>}
    </>}
  </section>
}

function RatingButtons({ card, busy, onRate }: { card: Flashcard; busy: boolean; onRate: (g: Grade) => Promise<void> }) {
  const now = new Date()
  return <div className="rating-buttons">{(['Nochmal', 'Schwer', 'Gut', 'Einfach'] as const).map((label, i) => {
    const grade = i + 1 as Grade
    return <button key={label} className={`rating rating-${grade}`} disabled={busy} onClick={() => void onRate(grade)}><span>{label}<kbd>{grade}</kbd></span><small>{interval(scheduler.next(card.schedule, now, grade).card.due, now)}</small></button>
  })}</div>
}
