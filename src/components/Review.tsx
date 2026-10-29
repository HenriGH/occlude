import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, Check, Eye } from 'lucide-react'
import { db, rateCard, refreshReviewQueue } from '../db'
import { scheduler, type DailyStreak, type Flashcard, type Grade } from '../domain'
import { prepareCardText } from './CardText'
import { CardFace } from './CardFace'
import { ImageSurface } from './ImageSurface'
import { ensureImageAsset } from '../sync/runtime'

function interval(due: Date, now: Date) {
  const minutes = Math.max(1, Math.round((+due - +now) / 60000))
  if (minutes < 60) return `${minutes} Min.`
  if (minutes < 1440) return `${Math.round(minutes / 60)} Std.`
  return `${Math.round(minutes / 1440)} Tage`
}
export function Review({ ids: initialIds, root, onClose, onError, onStreak }: { ids: string[]; root: string | null; onClose: () => void; onError: (e: unknown) => void; onStreak: (streak: DailyStreak) => void }) {
  const [ids, setIds] = useState(initialIds)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const selectedGrade = useRef<Grade>(3)
  const skipped = useRef(new Set<string>())
  const [assetError, setAssetError] = useState('')
  const result = useLiveQuery(async () => {
    const card = ids[index] ? await db.cards.get(ids[index]) : undefined
    if (!card) return null
    if (card.kind === 'basic') { await prepareCardText(`${card.front}\n${card.back}`); return { card, asset: undefined, regions: [] } }
    const image = await db.images.get(card.imageId)
    const asset = image ? await db.assets.get(image.assetHash) : undefined
    const regions = await db.regions.where('imageId').equals(card.imageId).toArray()
    return { card, asset, regions }
  }, [ids, index])
  const data = result?.card.id === ids[index] ? result : result === null ? null : undefined
  useEffect(() => { setAssetError('') }, [index])
  useEffect(() => {
    if (!data || data.card.kind === 'basic' || data.asset || assetError) return
    let cancelled = false
    ensureImageAsset(data.card.imageId!).catch(e => { if (!cancelled) setAssetError(e instanceof Error ? e.message : 'Das Bild konnte nicht geladen werden.') })
    return () => { cancelled = true }
  }, [data?.card.id, data?.asset, assetError])
  async function rate(grade: Grade) {
    if (locked.current || !revealed || (!data?.asset && data?.card.kind !== 'basic')) return
    locked.current = true; setBusy(true)
    try {
      const streak = await rateCard(data.card.id, grade)
      if (streak) onStreak(streak)
      await advance()
    } catch (e) { onError(e) }
    finally { locked.current = false; setBusy(false) }
  }
  async function advance() {
    const pending = ids.slice(index + 1)
    // A failed refresh must never offer the already saved rating a second time.
    let next = pending
    try { next = await refreshReviewQueue(pending, root, skipped.current) }
    catch (e) { onError(e) }
    setIds([...ids.slice(0, index + 1), ...next])
    selectedGrade.current = 3
    setRevealed(false); setIndex(index + 1)
  }
  async function skip() {
    if (locked.current) return
    locked.current = true; setBusy(true)
    skipped.current.add(ids[index])
    try { await advance() }
    finally { locked.current = false; setBusy(false) }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || target?.closest('input, select, textarea, [contenteditable="true"]')) return
      if (target?.closest('button, a') && !target.closest('.rating-buttons')) return
      if (e.repeat) { if (e.code === 'Space' || /^[1-4]$/.test(e.key)) e.preventDefault(); return }
      if (e.code === 'Space' && (data?.asset || data?.card.kind === 'basic')) { e.preventDefault(); if (revealed) void rate(selectedGrade.current); else setRevealed(true) }
      if (revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); void rate(Number(e.key) as Grade) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })
  const complete = index >= ids.length
  const question = data?.card.kind === 'basic' ? undefined : data?.regions.find(r => r.id === data.card.regionId)?.label
  return <section className={`review-page${question ? ' has-question' : ''}`}>
    <div className="review-header"><button className="icon-button" aria-label="Lernen beenden" onClick={onClose}><ArrowLeft size={20} /></button><div className="review-progress" role="progressbar" aria-label="Lernfortschritt" aria-valuemin={0} aria-valuemax={ids.length} aria-valuenow={index}><div style={{ width: `${ids.length ? index / ids.length * 100 : 100}%` }} /></div></div>
    {complete ? <div className="session-complete"><span className="success-emblem"><Check size={40} /></span><h1>Fertig für jetzt</h1><p className="muted">{index - skipped.current.size} {index - skipped.current.size === 1 ? 'Karte wiederholt' : 'Karten wiederholt'}.</p><button className="button primary" onClick={onClose}>Zur Übersicht <ArrowRight size={17} /></button></div> : <>
      <div className="review-stage">
      {data === undefined ? <p role="status">Karte wird geladen …</p> : data?.card.kind === 'basic' ? <div role="region" aria-label={revealed ? 'Antwort' : 'Frage'} tabIndex={0} className={`review-basic${revealed ? ' revealed' : ''}`} key={`${index}:${data.card.id}`}><CardFace text={revealed ? data.card.back : data.card.front} svg={revealed ? data.card.backSvg : data.card.frontSvg} label={revealed ? 'Antwort' : 'Frage'} /></div> : !data?.asset ? <div className="empty-panel"><h2>{data ? 'Bild auf diesem Gerät nicht verfügbar' : 'Diese Karte wurde gelöscht'}</h2><p>{assetError || (data ? 'Das Originalbild wird geladen …' : 'Die Karte kann gerade nicht bewertet werden.')}</p>{data && assetError && <button className="button" onClick={() => setAssetError('')}>Bild erneut laden</button>}<button className="button" disabled={busy} onClick={() => void skip()}>Überspringen</button></div> : <div className={`review-image ${revealed ? 'revealed' : ''}`}><ImageSurface key={`${index}:${data.card.id}`} asset={data.asset} regions={data.regions} targetId={data.card.regionId} revealed={revealed} /></div>}
      </div>
      <div className="review-actions">{revealed && question && <p className="review-question">{question}</p>}{(data?.asset || data?.card.kind === 'basic') && (revealed ? <RatingButtons card={data.card} busy={busy} onRate={rate} onSelect={grade => { selectedGrade.current = grade }} /> : <button className="button primary reveal-button" disabled={busy} onClick={() => setRevealed(true)}><Eye size={19} /> Antwort zeigen <kbd>Leertaste</kbd></button>)}</div>
    </>}
  </section>
}

function RatingButtons({ card, busy, onRate, onSelect }: { card: Flashcard; busy: boolean; onRate: (g: Grade) => Promise<void>; onSelect: (g: Grade) => void }) {
  const group = useRef<HTMLDivElement>(null)
  useEffect(() => { group.current?.querySelectorAll('button')[2]?.focus({ preventScroll: true }) }, [card.id])
  function keyboard(event: ReactKeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const buttons = [...(group.current?.querySelectorAll('button') ?? [])]
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat && !busy) void onRate(index + 1 as Grade); return }
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0
    if (step || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? 3 : Math.max(0, Math.min(3, index + step))]?.focus({ preventScroll: true })
    }
  }
  const now = new Date()
  return <div className="rating-buttons" role="group" aria-label="Bewertung" ref={group} onKeyDown={keyboard}>{(['Nochmal', 'Schwer', 'Gut', 'Einfach'] as const).map((label, i) => {
    const grade = i + 1 as Grade
    return <button key={label} className={`rating rating-${grade}`} disabled={busy} onFocus={() => onSelect(grade)} onClick={() => void onRate(grade)}><span>{label}<kbd>{grade}</kbd></span><small>{interval(scheduler.next(card.schedule, now, grade).card.due, now)}</small></button>
  })}</div>
}
