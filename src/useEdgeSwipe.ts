import { useEffect } from 'react'

const mobileLayout = '(max-width: 680px), (max-width: 960px) and (pointer: coarse)'

/** Recognize an intentional, single-finger swipe without covering page controls. */
export function useEdgeSwipe(enabled: boolean, onOpen: () => void) {
  useEffect(() => {
    if (!enabled) return
    const media = matchMedia(mobileLayout)
    let gesture: { id: number; x: number; y: number; claimed: boolean } | null = null

    const reset = () => {
      gesture = null
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', reset)
    }
    const start = (event: TouchEvent) => {
      reset()
      if (!media.matches || event.defaultPrevented || event.touches.length !== 1 || document.querySelector('dialog[open], [aria-modal="true"]')) return
      // The canvas owns drawing, dragging and pinch-to-zoom. Text fields own
      // cursor movement and selection, even when they extend to the edge.
      if (!(event.target instanceof Element) || event.target.closest('.image-viewport, input, textarea, select, [contenteditable]')) return
      const touch = event.touches[0]
      if (touch.clientX > 32) return
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, claimed: false }
      // Only a potential edge swipe needs a blocking listener. Ordinary page
      // scrolling stays on the browser's passive touch path.
      document.addEventListener('touchmove', move, { passive: false })
      document.addEventListener('touchend', end, { passive: false })
      document.addEventListener('touchcancel', reset, { passive: true })
    }
    const move = (event: TouchEvent) => {
      if (!gesture) return
      if (event.touches.length !== 1 || !event.cancelable || !media.matches) { reset(); return }
      const touch = event.touches[0]
      if (touch.identifier !== gesture.id) { reset(); return }
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y
      if (!gesture.claimed) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return
        // Once scrolling or moving left, never turn this contact into a swipe.
        if (dx < Math.abs(dy) * 1.5) { reset(); return }
        gesture.claimed = true
      }
      event.preventDefault()
    }
    const end = (event: TouchEvent) => {
      const completed = gesture
      reset()
      if (!completed || event.touches.length || !completed.claimed || !media.matches) return
      const touch = [...event.changedTouches].find(t => t.identifier === completed.id)
      if (!touch) return
      const dx = touch.clientX - completed.x, dy = touch.clientY - completed.y
      if (dx >= 56 && dx >= Math.abs(dy) * 1.5) {
        if (event.cancelable) event.preventDefault()
        onOpen()
      }
    }
    document.addEventListener('touchstart', start, { passive: true })
    window.addEventListener('blur', reset)
    return () => {
      reset()
      document.removeEventListener('touchstart', start)
      window.removeEventListener('blur', reset)
    }
  }, [enabled, onOpen])
}
