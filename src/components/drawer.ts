/**
 * What every drawer does besides draw itself: close on Escape, and hand focus
 * back where it found it.
 *
 * Both were being reinvented per drawer, or more often not at all — the
 * diagnostics popover had its own `keydown` listener and nothing else closed on
 * Escape, though the footer has always promised that Escape closes whatever is
 * open.
 */

import { useEffect, useRef, type RefObject } from 'react'

import { useUiStore } from '../store/uiStore.ts'

/**
 * Put `onClose` on the Escape stack while `active`.
 *
 * The shell's key handler calls the innermost entry, so a drawer opened from
 * inside another closes first. The callback is read through a ref: callers pass
 * a fresh closure every render, and re-registering each time would shuffle the
 * drawer to the top of the stack whenever it re-rendered.
 */
export function useEscape(active: boolean, onClose: () => void) {
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })

  useEffect(() => {
    if (!active) return
    return useUiStore.getState().pushEscape(() => latest.current())
  }, [active])
}

/**
 * Move focus into a drawer when it opens, and back out when it closes.
 *
 * Focus lands on the drawer element itself, which therefore needs
 * `tabIndex={-1}`: a keyboard user's next Tab is then the drawer's first
 * control, without the drawer having to nominate one. On close it returns to
 * whatever had it at open time, if that is still on the page — the pal card
 * that was clicked, the header button that was pressed.
 */
export function useDrawerFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
) {
  useEffect(() => {
    if (!open) return
    const before = document.activeElement
    ref.current?.focus({ preventScroll: true })
    return () => {
      if (before instanceof HTMLElement && before.isConnected) {
        before.focus({ preventScroll: true })
      }
    }
  }, [ref, open])
}
