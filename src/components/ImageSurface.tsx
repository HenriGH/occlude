import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import type { Asset, Rect } from '../domain'

export function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) { setUrl(''); return }
    const next = URL.createObjectURL(blob); setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}
type Tool = 'draw' | 'select' | 'pan'
interface Props {
  asset: Asset; regions: Rect[]; onChange?: (regions: Rect[]) => void
  tool?: Tool; selected?: string; onSelect?: (id?: string) => void
  targetId?: string; revealed?: boolean
}

export function ImageSurface({ asset, regions, onChange, tool = 'pan', selected, onSelect, targetId, revealed }: Props) {
  const url = useBlobUrl(asset.blob)
  const surface = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [draft, setDraft] = useState<Rect | null>(null)
  const [fittedWidth, setFittedWidth] = useState<number>()
  const gesture = useRef<{ type: 'draw' | 'move' | 'resize' | 'pan'; x: number; y: number; id?: string; original?: Rect; pan: { x: number; y: number } } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)
  const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))
  const point = (e: { clientX: number; clientY: number }) => {
    const r = surface.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }
  useEffect(() => {
    const el = viewport.current!
    const fit = () => {
      const padding = parseFloat(getComputedStyle(el).paddingLeft) * 2
      setFittedWidth(Math.min(el.clientWidth - padding, (el.clientHeight - padding) * asset.width / asset.height, asset.width))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(el); fit()
    return () => observer.disconnect()
  }, [asset.width, asset.height])
  useEffect(() => {
    const el = viewport.current
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom(z => clamp(z * Math.exp(-event.deltaY * 0.002), 1, 5))
    }
    el?.addEventListener('wheel', wheel, { passive: false })
    return () => el?.removeEventListener('wheel', wheel)
  }, [])
  useEffect(() => { if (zoom === 1) setPan({ x: 0, y: 0 }) }, [zoom])

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom }
      gesture.current = null; setDraft(null); return
    }
    const element = (e.target as HTMLElement).closest<HTMLElement>('[data-region]')
    const id = element?.dataset.region
    const resizing = (e.target as HTMLElement).dataset.resize === 'true'
    const p = point(e)
    if (tool === 'pan' || !onChange) gesture.current = { type: 'pan', x: e.clientX, y: e.clientY, pan }
    else if (id && (tool === 'select' || selected === id && resizing)) {
      onSelect?.(id)
      gesture.current = { type: resizing ? 'resize' : 'move', x: p.x, y: p.y, id, original: regions.find(r => r.id === id), pan }
    } else if (tool === 'draw') {
      const rect = { id: crypto.randomUUID(), x: p.x, y: p.y, width: 0, height: 0 }
      setDraft(rect); gesture.current = { type: 'draw', x: p.x, y: p.y, id: rect.id, pan }; onSelect?.()
    } else onSelect?.()
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      setZoom(clamp(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.distance), 1, 5)); return
    }
    const g = gesture.current
    if (!g) return
    if (g.type === 'pan') { setPan({ x: g.pan.x + e.clientX - g.x, y: g.pan.y + e.clientY - g.y }); return }
    const p = point(e)
    if (g.type === 'draw') setDraft({ id: g.id!, x: Math.min(p.x, g.x), y: Math.min(p.y, g.y), width: Math.abs(p.x - g.x), height: Math.abs(p.y - g.y) })
    else if (g.original) {
      const r = g.original
      setDraft(g.type === 'move'
        ? { ...r, x: clamp(r.x + p.x - g.x, 0, 1 - r.width), y: clamp(r.y + p.y - g.y, 0, 1 - r.height) }
        : { ...r, width: clamp(r.width + p.x - g.x, 0.005, 1 - r.x), height: clamp(r.height + p.y - g.y, 0.005, 1 - r.y) })
    }
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    pinch.current = null
    if (draft && draft.width >= 0.005 && draft.height >= 0.005 && onChange) {
      onChange(regions.some(r => r.id === draft.id) ? regions.map(r => r.id === draft.id ? draft : r) : [...regions, draft])
      onSelect?.(draft.id)
    }
    setDraft(null); gesture.current = null
  }
  const shown = draft ? [...regions.filter(r => r.id !== draft.id), draft] : regions
  return <div className="image-workspace">
    <div className={`image-viewport tool-${tool}`} ref={viewport} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { pointers.current.clear(); pinch.current = null; gesture.current = null; setDraft(null) }} data-testid="image-viewport">
      <div className="image-surface" ref={surface} style={{ aspectRatio: `${asset.width}/${asset.height}`, width: fittedWidth, maxWidth: asset.width, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} data-testid="image-surface">
        {url && <img src={url} alt="Originalbild der Lernkarte" draggable={false} />}
        {shown.map((r, i) => targetId === r.id && revealed ? null : <div key={r.id} data-region={r.id} data-testid={targetId === r.id ? 'target-mask' : 'occlusion-mask'} className={`mask ${targetId ? targetId === r.id ? 'target' : 'other' : 'editing'} ${selected === r.id ? 'selected' : ''}`} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }}>
          {(!targetId || r.id === targetId) && <span className={r.label ? 'mask-label' : undefined} title={r.label || undefined}>{r.label || (targetId ? '?' : String(i + 1).padStart(2, '0'))}</span>}
          {onChange && selected === r.id && tool !== 'pan' && <i data-resize="true" className="resize-handle" />}
        </div>)}
      </div>
    </div>
    <div className="zoom-controls"><button className="icon-button" aria-label="Verkleinern" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - .25))}><Minus size={16} /></button><span>{Math.round(zoom * 100)} %</span><button className="icon-button" aria-label="Vergrößern" disabled={zoom >= 5} onClick={() => setZoom(z => Math.min(5, z + .25))}><Plus size={16} /></button><span className="divider" /><button className="icon-button" aria-label="Ansicht zurücksetzen" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}><Maximize size={15} /></button></div>
  </div>
}
