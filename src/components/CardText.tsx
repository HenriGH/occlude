import { useEffect, useState } from 'react'
import type katex from 'katex'
import 'katex/dist/katex.min.css'

// Text remains React-escaped. Only KaTeX's own HTML is inserted; trust:false
// rejects HTML/link commands, and expansion/size limits bound untrusted formulas.
let mathRenderer: typeof katex | undefined
let mathLoader: Promise<typeof katex | undefined> | undefined
const mathPattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$[^$\n]+?(?<!\\)\$)/g
export async function prepareCardText(text: string) {
  if (text.split(mathPattern).length === 1) return undefined
  mathLoader ??= import('katex').then(async module => {
    mathRenderer = module.default
    if (typeof document !== 'undefined' && document.fonts) await Promise.allSettled(['1em KaTeX_Main', 'italic 1em KaTeX_Math', '1em KaTeX_Size1'].map(font => document.fonts.load(font)))
    return mathRenderer
  }).catch(() => { mathLoader = undefined; return undefined })
  return mathLoader
}
export function CardText({ text }: { text: string }) {
  const [renderer, setRenderer] = useState<typeof katex | undefined>(() => mathRenderer)
  const parts = text.split(mathPattern)
  useEffect(() => {
    if (renderer) return
    let live = true
    void prepareCardText(text).then(value => { if (live && value) setRenderer(value) })
    return () => { live = false }
  }, [text, renderer])
  return <span className="card-text">{parts.map((part, index) => {
    const display = part.startsWith('$$') || part.startsWith('\\[')
    const math = display || part.startsWith('\\(') || part.startsWith('$') && part.endsWith('$') && part.length > 2
    if (!math || !renderer) return <span key={index}>{part}</span>
    const source = part.slice(display || part.startsWith('\\(') ? 2 : 1, display || part.startsWith('\\(') ? -2 : -1)
    return <span key={index} className={`card-math${display ? ' display' : ''}`} dangerouslySetInnerHTML={{ __html: renderer.renderToString(source, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 15 }) }} />
  })}</span>
}
