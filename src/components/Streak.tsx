import { useId } from 'react'
import type { DailyStreak } from '../domain'

function StreakFlame({ active }: { active: boolean }) {
  const id = useId()
  return <svg className="streak-flame" viewBox="0 0 40 48" fill="none" aria-hidden="true">
    {active && <defs>
      <linearGradient id={`${id}-outer`} x1="13" y1="3" x2="28" y2="45" gradientUnits="userSpaceOnUse"><stop stopColor="#ffd782" /><stop offset=".48" stopColor="#ff9d45" /><stop offset="1" stopColor="#ed622b" /></linearGradient>
      <linearGradient id={`${id}-inner`} x1="20" y1="23" x2="21" y2="44" gradientUnits="userSpaceOnUse"><stop stopColor="#fff5c6" /><stop offset="1" stopColor="#ffd16f" /></linearGradient>
    </defs>}
    <path className="streak-flame-outer" d="M22 2C25 12 14 15 17 25C11 22 10 17 11 13C4 20 2 26 3 32C4 41 10 46 20 46C30 46 37 39 37 30C37 22 31 16 28 13C30 21 26 25 24 26C29 15 23 10 22 2Z" fill={active ? `url(#${id}-outer)` : 'currentColor'} />
    {active && <path className="streak-flame-core" d="M21 23C23 29 16 31 17 36C14 35 13 33 13 31C9 39 14 44 20 44C27 44 31 37 27 31C27 35 24 37 23 37C25 31 22 28 21 23Z" fill={`url(#${id}-inner)`} />}
  </svg>
}

export function StreakBadge({ streak }: { streak: DailyStreak }) {
  const label = `Streak: ${streak.count} ${streak.count === 1 ? 'Tag' : 'Tage'} in Folge. ${streak.active ? 'Heute aktiv.' : 'Lerne eine Karte, um deine Streak heute zu aktivieren.'}`
  return <span className={`streak-badge${streak.active ? ' active' : ''}`} role="img" aria-label={label} title={`${label} Eine bewertete Karte pro Kalendertag zählt.`}>
    <StreakFlame active={streak.active} /><strong aria-hidden="true">{streak.count}</strong>
  </span>
}

export function StreakCelebration({ streak }: { streak: DailyStreak }) {
  return <div className="streak-celebration" role="status" aria-atomic="true">
    <div className="streak-ignite" aria-hidden="true"><span className="streak-sparks">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</span><StreakFlame active /></div>
    <div><strong>{streak.count} {streak.count === 1 ? 'Tag' : 'Tage'}</strong><span>{streak.count === 1 ? 'Streak gestartet' : 'Streak verlängert'}</span></div>
  </div>
}
