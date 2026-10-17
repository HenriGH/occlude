// IndexedDB upgrades can be blocked by an older browser tab. Keep this signal
// outside the pending database so the startup UI can still explain the wait.
let blocked = false
const listeners = new Set<() => void>()
export const isStorageBlocked = () => blocked
export function subscribeStorage(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setStorageBlocked(next: boolean) {
  if (blocked === next) return
  blocked = next
  listeners.forEach(listener => listener())
}
