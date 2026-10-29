import { useMemo } from 'react'
import { validCardSvg } from '../cardSvg'
import { CardText } from './CardText'

export function CardFace({ text, svg, label }: { text: string; svg?: string; label: string }) {
  const source = useMemo(() => svg && validCardSvg(svg) ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '', [svg])
  return <div className="card-face"><CardText text={text} />{svg && (source ? <img className="card-artwork" src={source} alt={`Grafik zur ${label}`} draggable={false} /> : <p className="muted small" role="status">Diese Grafik kann nicht angezeigt werden.</p>)}</div>
}
