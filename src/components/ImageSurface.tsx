import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
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
type Point = { x: number; y: number }
type View = { zoom: number; pan: Point }

function MaskQuestion({ text }: { text: string }) {
  const label = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = label.current!, mask = element.parentElement!
    const fit = () => {
      let low = 1, high = 14
      // Fit the whole question, since there is no duplicate heading to read it
      // from. Font and line breaks then scale together with the study image.
      while (high - low > .2) {
        const size = (low + high) / 2
        element.style.fontSize = `${size}px`
        if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) low = size
        else high = size
      }
      element.style.fontSize = `${low}px`
    }
    const observer = new ResizeObserver(fit)
    observer.observe(mask); fit()
    return () => observer.disconnect()
  }, [text])
  return <span className="mask-label mask-question" ref={label} title={text}>{text}</span>
}
interface Props {
  asset: Asset; regions: Rect[]; onChange?: (regions: Rect[]) => void
  tool?: Tool; selected?: string; onSelect?: (id?: string) => void
  targetId?: string; revealed?: boolean
}

export function ImageSurface({ asset, regions, onChange, tool = 'pan', selected, onSelect, targetId, revealed }: Props) {
  const url = useBlobUrl(asset.blob)
  const surface = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ zoom: 1, pan: { x: 0, y: 0 } })
  const currentView = useRef(view)
  const { zoom, pan } = view
  const reviewing = !!targetId
  const [draft, setDraft] = useState<Rect | null>(null)
  const [fittedWidth, setFittedWidth] = useState<number>()
  const gesture = useRef<{ type: 'draw' | 'move' | 'resize' | 'pan'; x: number; y: number; id?: string; original?: Rect; pan: { x: number; y: number } } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number; anchor: Point; center: Point } | null>(null)
  const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))
  function applyView(next: View) {
    if (reviewing) {
      const image = surface.current!, frame = viewport.current!
      const size = getComputedStyle(image), bounds = frame.getBoundingClientRect()
      const x = next.zoom === 1 ? 0 : Math.max(0, ((parseFloat(size.width) || image.offsetWidth) * next.zoom - bounds.width) / 2)
      const y = next.zoom === 1 ? 0 : Math.max(0, ((parseFloat(size.height) || image.offsetHeight) * next.zoom - bounds.height) / 2)
      next = { zoom: next.zoom, pan: { x: clamp(next.pan.x, -x, x), y: clamp(next.pan.y, -y, y) } }
    }
    const previous = currentView.current
    if (next.zoom === previous.zoom && next.pan.x === previous.pan.x && next.pan.y === previous.pan.y) return
    currentView.current = next; setView(next)
  }
  function center() {
    const bounds = viewport.current!.getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  }
  function zoomAt(nextZoom: number, focus = center()) {
    const previous = currentView.current, origin = center()
    const next = clamp(nextZoom, 1, 5), scale = next / previous.zoom
    applyView({ zoom: next, pan: next === 1 ? { x: 0, y: 0 } : {
      x: focus.x - origin.x - (focus.x - origin.x - previous.pan.x) * scale,
      y: focus.y - origin.y - (focus.y - origin.y - previous.pan.y) * scale,
    } })
  }
  function beginPinch() {
    const [a, b] = [...pointers.current.values()], origin = center(), previous = currentView.current
    pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: previous.zoom, center: origin, anchor: {
      x: ((a.x + b.x) / 2 - origin.x - previous.pan.x) / previous.zoom,
      y: ((a.y + b.y) / 2 - origin.y - previous.pan.y) / previous.zoom,
    } }
    gesture.current = null; setDraft(null)
  }
  const point = (e: { clientX: number; clientY: number }) => {
    const r = surface.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }
  useEffect(() => {
    const el = viewport.current!
    const fit = () => {
      const style = getComputedStyle(el)
      const horizontal = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      const vertical = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      // The review frame already follows the image's aspect ratio. Fit its exact
      // width so fractional CSS pixels do not leave a narrow letterbox seam.
      setFittedWidth(Math.max(1, reviewing ? el.getBoundingClientRect().width : Math.min(el.clientWidth - horizontal, (el.clientHeight - vertical) * asset.width / asset.height, asset.width)))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(el); fit()
    return () => observer.disconnect()
  }, [asset.width, asset.height, reviewing])
  useLayoutEffect(() => {
    if (!reviewing) return
    pointers.current.clear(); pinch.current = null; gesture.current = null
    applyView(currentView.current)
  }, [fittedWidth, reviewing])
  useEffect(() => {
    const el = viewport.current
    const wheel = (event: WheelEvent) => {
      // Trackpad pinch / Ctrl+wheel zooms a study image; normal scrolling remains
      // available over it. The editor retains its existing wheel controls.
      if (reviewing && !event.ctrlKey) return
      event.preventDefault()
      zoomAt(currentView.current.zoom * Math.exp(-event.deltaY * 0.002), { x: event.clientX, y: event.clientY })
    }
    el?.addEventListener('wheel', wheel, { passive: false })
    return () => el?.removeEventListener('wheel', wheel)
  }, [reviewing])

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) { beginPinch(); return }
    const { pan } = currentView.current
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
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const start = pinch.current
      const next = clamp(start.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, start.distance), 1, 5)
      applyView({ zoom: next, pan: next === 1 ? { x: 0, y: 0 } : {
        x: (a.x + b.x) / 2 - start.center.x - start.anchor.x * next,
        y: (a.y + b.y) / 2 - start.center.y - start.anchor.y * next,
      } }); return
    }
    const g = gesture.current
    if (!g) return
    if (g.type === 'pan') { applyView({ zoom: currentView.current.zoom, pan: { x: g.pan.x + e.clientX - g.x, y: g.pan.y + e.clientY - g.y } }); return }
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
    if (pinch.current) {
      if (pointers.current.size >= 2) beginPinch()
      else {
        pinch.current = null
        const remaining = [...pointers.current.values()][0]
        gesture.current = remaining ? { type: 'pan', ...remaining, pan: currentView.current.pan } : null
      }
      setDraft(null); return
    }
    pinch.current = null
    if (draft && draft.width >= 0.005 && draft.height >= 0.005 && onChange) {
      onChange(regions.some(r => r.id === draft.id) ? regions.map(r => r.id === draft.id ? draft : r) : [...regions, draft])
      onSelect?.(draft.id)
    }
    setDraft(null); gesture.current = null
  }
  const shown = draft ? [...regions.filter(r => r.id !== draft.id), draft] : regions
  return <div className="image-workspace" style={reviewing ? { width: `min(100%, calc(var(--review-max-height, 70svh) * ${asset.width / asset.height}))` } : undefined}>
    <div className={`image-viewport tool-${tool}${zoom > 1 ? ' is-zoomed' : ''}`} style={reviewing ? { aspectRatio: `${asset.width}/${asset.height}` } : undefined} ref={viewport} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { pointers.current.clear(); pinch.current = null; gesture.current = null; setDraft(null) }} data-testid="image-viewport">
      <div className="image-surface" ref={surface} style={{ aspectRatio: `${asset.width}/${asset.height}`, width: fittedWidth, maxWidth: reviewing ? undefined : asset.width, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} data-testid="image-surface">
        {url && <img src={url} alt="Originalbild der Lernkarte" draggable={false} />}
        {shown.map((r, i) => targetId === r.id && revealed ? null : <div key={r.id} data-region={r.id} data-testid={targetId === r.id ? 'target-mask' : 'occlusion-mask'} className={`mask ${targetId ? targetId === r.id ? 'target' : 'other' : 'editing'} ${selected === r.id ? 'selected' : ''}`} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }}>
          {(!targetId || r.id === targetId) && (targetId && r.label ? <MaskQuestion text={r.label} /> : <span className={r.label ? 'mask-label' : undefined} title={r.label || undefined}>{r.label || (targetId ? '?' : String(i + 1).padStart(2, '0'))}</span>)}
          {onChange && selected === r.id && tool !== 'pan' && <i data-resize="true" className="resize-handle" />}
        </div>)}
      </div>
    </div>
    {!reviewing && <div className="zoom-controls"><button className="icon-button" aria-label="Verkleinern" disabled={zoom <= 1} onClick={() => zoomAt(zoom - .25)}><Minus size={16} /></button><span>{Math.round(zoom * 100)} %</span><button className="icon-button" aria-label="Vergrößern" disabled={zoom >= 5} onClick={() => zoomAt(zoom + .25)}><Plus size={16} /></button><span className="divider" /><button className="icon-button" aria-label="Ansicht zurücksetzen" onClick={() => applyView({ zoom: 1, pan: { x: 0, y: 0 } })}><Maximize size={15} /></button></div>}
  </div>
}
