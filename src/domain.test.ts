import { describe, expect, it } from 'vitest'
import { createEmptyCard, Rating } from 'ts-fsrs'
import { defaultPreferences } from './db'
import { dailyStreak, descendants, replay, reviewDay, reviewQueue, SCHEDULER_VERSION, validRect, validateParent, type Deck, type Flashcard, type ReviewEvent } from './domain'

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


describe('daily study streak', () => {
  const at = (year: number, month: number, day: number, hour = 12, minute = 0) => +new Date(year, month - 1, day, hour, minute)
  const review = (time: number, id = crypto.randomUUID()): ReviewEvent => event(id, time, Rating.Good)
  it('counts only days with reviews, ignores duplicate attempts and future events', () => {
    const now = new Date(2026, 9, 19, 12)
    expect(dailyStreak([], now)).toEqual({ count: 0, active: false })
    const first = review(at(2026, 10, 19, 8))
    expect(dailyStreak([first, first, review(at(2026, 10, 19, 9)), review(at(2026, 10, 20))], now)).toEqual({ count: 1, active: true })
    expect(dailyStreak([review(at(2026, 10, 19, 13))], now)).toEqual({ count: 0, active: false })
  })
  it("preserves yesterday's count while inactive today, and resets after a missed day", () => {
    const reviews = [17, 18].map(day => review(at(2026, 10, day)))
    expect(dailyStreak(reviews, new Date(2026, 9, 19, 12))).toEqual({ count: 2, active: false })
    expect(dailyStreak(reviews, new Date(2026, 9, 20, 12))).toEqual({ count: 0, active: false })
    expect(dailyStreak([...reviews, review(at(2026, 10, 20))], new Date(2026, 9, 20, 12))).toEqual({ count: 1, active: true })
  })
  it('merges interleaved device histories and backfilled offline days without summing counters', () => {
    const laptop = [review(at(2026, 10, 17)), review(at(2026, 10, 19))]
    const phone = [review(at(2026, 10, 18)), review(at(2026, 10, 19))]
    const now = new Date(2026, 9, 19, 15)
    expect(dailyStreak(laptop, now).count).toBe(1)
    expect(dailyStreak([...phone, ...laptop, ...phone], now)).toEqual({ count: 3, active: true })
    expect(dailyStreak([...laptop, ...phone], now)).toEqual(dailyStreak([...phone, ...laptop], now))
  })
  it('changes at local midnight, independently of the FSRS learning-day boundary', () => {
    const reviews = [review(at(2026, 10, 18, 23, 59)), review(at(2026, 10, 19, 0, 0))]
    expect(dailyStreak(reviews, new Date(2026, 9, 19, 0, 0))).toEqual({ count: 2, active: true })
    expect(dailyStreak(reviews.slice(0, 1), new Date(2026, 9, 19, 0, 0))).toEqual({ count: 1, active: false })
  })
  it('crosses year, leap-day and daylight-saving changes using calendar dates', () => {
    for (const [year, month, day] of [[2027, 1, 1], [2028, 3, 1], [2026, 3, 30], [2026, 10, 26]]) {
      const now = new Date(year, month - 1, day, 12)
      const days = Array.from({ length: 4 }, (_, i) => { const date = new Date(now); date.setDate(date.getDate() - i); return review(+date) })
      expect(dailyStreak(days.reverse(), now)).toEqual({ count: 4, active: true })
    }
  })
})


it('mixes basic and image cards in the same scoped queue and shares the daily introduction limit', () => {
  const now = new Date(2026, 9, 20, 12)
  const images = [{ id: 'image', deckId: 'a', assetHash: 'hash', createdAt: +now, updatedAt: +now }]
  const cards: Flashcard[] = [
    { id: 'image-card', regionId: 'region', imageId: 'image', createdAt: +now - 10, schedule: createEmptyCard(now) },
    { id: 'basic', kind: 'basic', deckId: 'b', front: 'Q', back: 'A', createdAt: +now, updatedAt: +now, schedule: createEmptyCard(now) },
    { id: 'outside', kind: 'basic', deckId: 'other', front: 'Other Q', back: 'Other A', createdAt: +now, updatedAt: +now, schedule: createEmptyCard(now) },
  ]
  expect(reviewQueue(cards, images, decks, [], defaultPreferences, 'parent', now).queue.map(c => c.id)).toEqual(['image-card', 'basic'])
  const reviewed = [{ ...event('previous', +now - 1, Rating.Good), cardId: 'outside' }]
  expect(reviewQueue(cards, images, decks, reviewed, { ...defaultPreferences, newLimit: 2 }, 'parent', now).fresh.map(c => c.id)).toEqual(['image-card'])
})
