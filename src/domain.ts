import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs'

export const SCHEDULER_VERSION = 'ts-fsrs@5.4.2/default/fuzz-off'
export const scheduler = fsrs({ enable_fuzz: false })
export type Grade = Rating.Again | Rating.Hard | Rating.Good | Rating.Easy
export const MAX_MASK_LABEL_LENGTH = 200
export interface Rect { id: string; x: number; y: number; width: number; height: number; label?: string }
export interface Deck { id: string; parentId: string | null; name: string; createdAt: number; updatedAt: number }
export interface Asset { hash: string; blob: Blob; width: number; height: number; mimeType: string }
export interface ImageRecord { id: string; deckId: string; assetHash: string; createdAt: number; updatedAt: number; width?: number; height?: number; mimeType?: string }
export interface Region extends Rect { imageId: string }
interface CardBase { id: string; createdAt: number; schedule: Card }
export interface OcclusionCard extends CardBase { kind?: 'occlusion'; regionId: string; imageId: string }
export interface BasicCard extends CardBase { kind: 'basic'; deckId: string; front: string; back: string; updatedAt: number; imageId?: never; regionId?: never }
export type Flashcard = OcclusionCard | BasicCard
export const MAX_CARD_TEXT_LENGTH = 10000
export function isBasicCard(card: Flashcard): card is BasicCard { return card.kind === 'basic' }
export function cardInScope(card: Flashcard, scope: Set<string>, images: ImageRecord[]) {
  return isBasicCard(card) ? scope.has(card.deckId) : images.some(image => image.id === card.imageId && scope.has(image.deckId))
}
export function validBasicText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_CARD_TEXT_LENGTH }
export interface ReviewEvent { id: string; cardId: string; rating: Grade; reviewedAt: number; schedulerVersion: string }
export interface Preferences { id: 'app'; selectedDeckId: string | null; newLimit: number; dayBoundary: number; theme: 'light' | 'dark' | 'system' }

export function descendants(decks: Deck[], root: string | null): Set<string> {
  if (!root) return new Set(decks.map(d => d.id))
  const ids = new Set([root])
  const queue = [root]
  while (queue.length) {
    const parent = queue.shift()
    for (const deck of decks) if (deck.parentId === parent && !ids.has(deck.id)) {
      ids.add(deck.id); queue.push(deck.id)
    }
  }
  return ids
}

export function validateParent(decks: Deck[], id: string, parentId: string | null) {
  if (parentId && (!decks.some(d => d.id === parentId) || descendants(decks, id).has(parentId)))
    throw new Error('Dieser Ordner würde einen Kreis bilden oder existiert nicht.')
}

export function validRect(rect: Rect) {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 &&
    rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001
}

export function replay(createdAt: number, events: ReviewEvent[]): Card {
  let card = createEmptyCard(new Date(createdAt))
  const seen = new Map<string, ReviewEvent>()
  const sorted = [...events].sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const event of sorted) {
    const previous = seen.get(event.id)
    if (previous) {
      if (previous.cardId !== event.cardId || previous.rating !== event.rating || previous.reviewedAt !== event.reviewedAt || previous.schedulerVersion !== event.schedulerVersion) throw new Error('Widersprüchliche Ereignis-ID.')
      continue
    }
    seen.set(event.id, event)
    if (![1, 2, 3, 4].includes(event.rating) || !Number.isFinite(event.reviewedAt)) throw new Error('Ungültiges Review-Ereignis.')
    if (event.schedulerVersion !== SCHEDULER_VERSION) throw new Error('Unbekannte Scheduler-Version.')
    card = scheduler.next(card, new Date(Math.max(createdAt, event.reviewedAt)), event.rating).card
  }
  return card
}

// Calendar setters preserve the chosen local boundary across daylight-saving changes.
export function reviewDay(now: Date, boundary: number) {
  const start = new Date(now)
  start.setHours(boundary, 0, 0, 0)
  if (start > now) start.setDate(start.getDate() - 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: +start, end: +end }
}

export interface DailyStreak { count: number; active: boolean }

// Use calendar dates, rather than 24-hour intervals, across DST and month/year
// boundaries. Device histories merge as review events, never as competing counters.
export function dailyStreak(events: ReviewEvent[], now = new Date()): DailyStreak {
  const calendarDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  const today = calendarDay(now)
  const days = new Set(events.filter(event => Number.isFinite(event.reviewedAt) && event.reviewedAt <= +now).map(event => calendarDay(new Date(event.reviewedAt))))
  const active = days.has(today)
  let day = active ? today : today - 1
  let count = 0
  while (days.has(day)) { count++; day-- }
  return { count, active }
}

export function reviewQueue(cards: Flashcard[], images: ImageRecord[], decks: Deck[], events: ReviewEvent[], prefs: Preferences, root: string | null, now = new Date()) {
  const scope = descendants(decks, root)
  const imageIds = new Set(images.filter(i => scope.has(i.deckId)).map(i => i.id))
  const { start, end } = reviewDay(now, prefs.dayBoundary)
  const firstReviews = new Map<string, number>()
  for (const event of events) firstReviews.set(event.cardId, Math.min(firstReviews.get(event.cardId) ?? Infinity, event.reviewedAt))
  const introduced = [...firstReviews.values()].filter(t => t >= start && t < end).length
  const available = cards.filter(c => isBasicCard(c) ? scope.has(c.deckId) : imageIds.has(c.imageId))
  const due = available.filter(c => c.schedule.reps > 0 && +c.schedule.due <= +now).sort((a, b) => +a.schedule.due - +b.schedule.due || a.id.localeCompare(b.id))
  const fresh = available.filter(c => c.schedule.reps === 0).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, Math.max(0, prefs.newLimit - introduced))
  return { due, fresh, queue: [...due, ...fresh], today: events.filter(e => e.reviewedAt >= start && e.reviewedAt < end).length, introduced }
}
