import type { Preferences } from './domain'

export function applyAppearance(theme: Preferences['theme']) {
  const dark = theme === 'dark' || theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches
  const color = dark ? '#000000' : '#f5f5f7'
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.documentElement.style.backgroundColor = color
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', dark ? 'black-translucent' : 'default')
  // This display hint lets the next launch paint the right background before
  // IndexedDB/React load. The actual preference stays in the local database.
  try { localStorage.setItem('occlude-appearance', theme) } catch { /* Storage can be restricted. */ }
}
