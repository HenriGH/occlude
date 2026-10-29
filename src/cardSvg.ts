import { SaxesParser } from 'saxes'

export const MAX_CARD_SVG_LENGTH = 100000
// A deliberately passive subset for diagrams. No HTML, scripts, CSS, external
// resources, animation, reuse/href or embedded images. The same XML parser runs
// at the MCP boundary and before rendering; SVG is displayed only as an <img>.
const tags = new Set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop marker clipPath'.split(' '))
const attributes = new Set('xmlns viewBox preserveAspectRatio width height x y x1 y1 x2 y2 cx cy r rx ry fx fy d points fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit opacity transform id font-family font-size font-weight font-style text-anchor dominant-baseline dx dy textLength lengthAdjust marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity clip-path clip-rule clipPathUnits'.split(' '))
const localPaint = /^(?:url\(#[A-Za-z_][\w.-]*\))$/

export function validCardSvg(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_CARD_SVG_LENGTH) return false
  if (value === '') return true
  if (!value.trim().startsWith('<svg') || /<!|<\?/.test(value)) return false
  let depth = 0, count = 0, roots = 0
  const reject = () => { throw new Error('Unsupported SVG') }
  try {
    const parser = new SaxesParser({ xmlns: false })
    parser.on('error', reject)
    parser.on('doctype', reject)
    parser.on('processinginstruction', reject)
    parser.on('opentag', node => {
      if (++count > 2000 || ++depth > 32 || !tags.has(node.name)) reject()
      if (depth === 1) {
        roots++
        if (node.name !== 'svg' || node.attributes.xmlns !== 'http://www.w3.org/2000/svg') reject()
        const box = String(node.attributes.viewBox ?? '').trim().split(/[\s,]+/).map(Number)
        if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0 || box.some(n => Math.abs(n) > 20000)) reject()
      } else if (node.name === 'svg') reject()
      for (const [name, content] of Object.entries(node.attributes)) {
        const value = String(content)
        if (!attributes.has(name) || name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') reject()
        if (name !== 'xmlns' && /url\s*\(|(?:https?|data|javascript):|\/\//i.test(value) && !localPaint.test(value)) reject()
      }
    })
    parser.on('closetag', () => { depth-- })
    parser.write(value).close()
    return roots === 1 && depth === 0
  } catch { return false }
}
