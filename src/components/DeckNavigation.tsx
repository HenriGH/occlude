import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Folder, Plus } from 'lucide-react'
import type { Deck } from '../domain'

const storageKey = 'occlude-collapsed-decks'
function savedCollapsed(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
  } catch { return new Set() }
}

export function DeckNavigation({ decks, selectedId, onSelect, onCreate }: {
  decks: Deck[]; selectedId: string | null; onSelect: (id: string | null) => void; onCreate: () => void
}) {
  const [collapsed, setCollapsed] = useState(savedCollapsed)
  const byId = new Map(decks.map(deck => [deck.id, deck]))
  const children = new Map<string | null, Deck[]>()
  for (const deck of decks) {
    const siblings = children.get(deck.parentId) ?? []
    siblings.push(deck); children.set(deck.parentId, siblings)
  }
  const ancestors: string[] = []
  const seen = new Set<string>()
  let parent = selectedId ? byId.get(selectedId)?.parentId : null
  while (parent && !seen.has(parent)) {
    seen.add(parent); ancestors.push(parent); parent = byId.get(parent)?.parentId
  }
  const ancestorPath = ancestors.join('/')
  const locationKey = `${selectedId ?? ''}:${ancestorPath}`
  const previousLocation = useRef(locationKey)
  // Reveal folders reached from the dashboard, creation dialog or a move. This
  // runs on a changed selection/path, so manually collapsing its parent works.
  useEffect(() => {
    if (previousLocation.current === locationKey) return
    previousLocation.current = locationKey
    const ids = ancestorPath ? ancestorPath.split('/') : []
    setCollapsed(current => {
      if (!ids.some(id => current.has(id))) return current
      const next = new Set(current); ids.forEach(id => next.delete(id)); return next
    })
  }, [locationKey, ancestorPath])
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify([...collapsed])) } catch { /* View preferences must not block local use. */ }
  }, [collapsed])
  function toggle(id: string) {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function branch(parentId: string | null, depth = 0) {
    return <ul>{children.get(parentId)?.map(deck => {
      const expandable = !!children.get(deck.id)?.length
      const open = !collapsed.has(deck.id)
      const path = [deck.name]
      let parent = deck.parentId
      const seen = new Set([deck.id])
      while (parent && !seen.has(parent)) {
        seen.add(parent); const ancestor = byId.get(parent); if (!ancestor) break
        path.unshift(ancestor.name); parent = ancestor.parentId
      }
      return <li key={deck.id}>
        <div className={`deck-row ${selectedId === deck.id ? 'selected' : ''}`} style={{ paddingLeft: 5 + Math.min(5, depth) * 13 }}>
          {expandable ? <button className="deck-toggle" aria-label={`${deck.name} ${open ? 'einklappen' : 'ausklappen'}`} aria-expanded={open} onClick={() => toggle(deck.id)}><ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} /></button> : <span className="deck-leaf-icon" aria-hidden="true"><Folder size={14} /></span>}
          <button className="deck-name" title={path.join(' / ')} aria-current={selectedId === deck.id ? 'page' : undefined} onClick={() => onSelect(deck.id)}><span>{deck.name}</span></button>
        </div>
        {expandable && open && branch(deck.id, depth + 1)}
      </li>
    })}</ul>
  }
  return <nav className="deck-nav" aria-label="Ordner">
    <button className={!selectedId ? 'selected' : ''} aria-current={!selectedId ? 'page' : undefined} onClick={() => onSelect(null)}><Folder size={16} /><span>Alle Ordner</span></button>
    <div className="deck-tree">{branch(null)}</div>
    <button className="new-deck-link" onClick={onCreate}><Plus size={15} />Neuer Ordner</button>
  </nav>
}
