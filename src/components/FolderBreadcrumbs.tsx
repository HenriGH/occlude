import { useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Deck } from '../domain'

export function FolderBreadcrumbs({ decks, selectedId, onSelect }: { decks: Deck[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const path: Deck[] = [], seen = new Set<string>()
  let id = selectedId
  while (id && !seen.has(id)) {
    seen.add(id)
    const deck = decks.find(d => d.id === id)
    if (!deck) break
    path.unshift(deck); id = deck.parentId
  }
  const navigation = useRef<HTMLElement>(null)
  useEffect(() => {
    // Reveal the current folder without scrolling the document or losing the
    // ancestors on narrow screens and long paths.
    const element = navigation.current!
    const reveal = () => { element.scrollLeft = element.scrollWidth }
    const observer = new ResizeObserver(reveal)
    observer.observe(element); reveal()
    return () => observer.disconnect()
  }, [selectedId, path.length])
  return <nav className="mobile-folder-path" aria-label="Ordnerpfad" ref={navigation}>
    <button aria-current={!selectedId ? 'page' : undefined} onClick={() => onSelect(null)}>Alle Ordner</button>
    {path.map(deck => <span key={deck.id}><ChevronRight size={14} aria-hidden="true" /><button title={deck.name} aria-current={deck.id === selectedId ? 'page' : undefined} onClick={() => onSelect(deck.id)}>{deck.name}</button></span>)}
  </nav>
}
