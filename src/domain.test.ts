import { describe, expect, it } from 'vitest'
import { createEmptyCard, Rating } from 'ts-fsrs'
import { defaultPreferences } from './db'
import { descendants, replay, reviewDay, reviewQueue, SCHEDULER_VERSION, validRect, validateParent, type Deck, type Flashcard, type ReviewEvent } from './domain'

const decks: Deck[] = [
  { id: 'parent', parentId: null, name: 'Semester', createdAt: 0, updatedAt: 0 },
  { id: 'a', parentId: 'parent', name: 'Anatomie', createdAt: 0, updatedAt: 0 },
  { id: 'b', parentId: 'parent', name: 'Physiologie', createdAt: 0, updatedAt: 0 },
  { id: 'other', parentId: null, name: 'Anderes', createdAt: 0, updatedAt: 0 },
]
const created = +new Date('2026-10-01T10:00:00Z')
const event = (id: string, reviewedAt: number, rating: ReviewEvent['rating']): ReviewEvent => ({ id, cardId: 'card', rating, reviewedAt, schedulerVersion: SCHEDULER_VERSION })

describe('deck hierarchy', () => {
  it('includes descendants once and excludes unrelated decks', () => expect([...descendants(decks, 'parent')]).toEqual(['parent', 'a', 'b']))
  it('rejects self-parenting, cycles, and missing parents', () => {
    for (const parent of ['parent', 'a', 'missing']) expect(() => validateParent(decks, 'parent', parent)).toThrow()
    expect(() => validateParent(decks, 'a', 'b')).not.toThrow()
  })
})
describe('normalized geometry', () => {
  it('rejects out-of-bounds, negative, empty, and non-finite rectangles', () => {
    const r = { id: 'r', x: .1, y: .2, width: .3, height: .4 }
    expect(validRect(r)).toBe(true)
    for (const bad of [{ x: -1 }, { width: 0 }, { height: -1 }, { y: NaN }, { x: .9 }]) expect(validRect({ ...r, ...bad })).toBe(false)
  })
})
describe('canonical FSRS replay', () => {
  it('preserves concurrent events, deduplicates retries, and converges in both arrival orders', () => {
    const a = event('a', created + 60000, Rating.Good)
    const b = event('b', created + 60000, Rating.Again)
    const later = event('c', created + 86400000, Rating.Easy)
    const state = replay(created, [a, b, later])
    expect(replay(created, [later, b, a, a])).toEqual(state)
    expect(state.reps).toBe(3)
    expect(state.last_review).toEqual(new Date(later.reviewedAt))
    expect(state.stability).toBeGreaterThan(0)
  })
  it('rejects unknown scheduler versions and conflicting event IDs', () => {
    expect(() => replay(created, [{ ...event('a', created, Rating.Good), schedulerVersion: 'future' }])).toThrow('Scheduler')
    expect(() => replay(created, [event('a', created, Rating.Good), event('a', created, Rating.Easy)])).toThrow('Ereignis-ID')
  })
})
describe('review day and daily new limit', () => {
  it('uses yesterday before the boundary and the current day afterward', () => {
    const early = new Date(2026, 9, 17, 3, 59)
    const { start, end } = reviewDay(early, 4)
    expect(new Date(start).getDate()).toBe(16)
    expect(new Date(end).getHours()).toBe(4)
    expect(reviewDay(new Date(2026, 9, 17, 4), 4).start).toBe(end)
  })
  it('uses calendar days across daylight saving when the test timezone supports it', () => {
    const day = new Date(2026, 2, 29, 12)
    const { start, end } = reviewDay(day, 0)
    const offsetChange = new Date(start).getTimezoneOffset() - new Date(end).getTimezoneOffset()
    expect(end - start).toBe((24 * 60 - offsetChange) * 60000)
  })
  it('aggregates a parent without duplicates and counts new introductions globally', () => {
    const now = new Date(2026, 9, 17, 12)
    const images = ['a', 'b', 'other'].map(id => ({ id, deckId: id, assetHash: id, createdAt: +now, updatedAt: +now }))
    const cards: Flashcard[] = ['a', 'b', 'other'].map(id => ({ id, regionId: id, imageId: id, createdAt: +now, schedule: createEmptyCard(now) }))
    const reviews = [{ ...event('r', +now - 60000, Rating.Good), cardId: 'other' }]
    const result = reviewQueue(cards, images, decks, reviews, { ...defaultPreferences, newLimit: 2 }, 'parent', now)
    expect(result.fresh).toHaveLength(1)
    expect(result.queue.map(c => c.id)).toEqual(['a'])
    expect(result.introduced).toBe(1)
    expect(result.today).toBe(1)
    cards[1].schedule.reps = 1; cards[1].schedule.due = new Date(+now - 1)
    expect(reviewQueue(cards, images, decks, reviews, { ...defaultPreferences, newLimit: 0 }, 'parent', now).due.map(c => c.id)).toEqual(['b'])
  })
})
