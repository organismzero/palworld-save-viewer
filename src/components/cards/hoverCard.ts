/**
 * Hover cards: the wiring, kept apart from the card bodies.
 *
 * One card on screen at a time, drawn by the single `HoverCardLayer` mounted in
 * the shell. A trigger does not own a floating element or any listeners — it
 * spreads `useHoverCard(desc)` and so costs one attribute and a stable ref,
 * which is what lets a virtualised grid of a thousand pal cards carry one each.
 * Document-level listeners find the trigger under the pointer or focus with
 * `closest`, so the innermost trigger wins and a passive chip inside a pal card
 * shows the passive rather than the pal.
 *
 * These replace native `title` text, which earned its place by being keyboard
 * reachable, never clipped by a scroll container, and free. Each is kept:
 * a trigger opens on `:focus-visible`, the layer is a top-layer popover that no
 * `overflow` can clip, and nothing renders until something is hovered.
 *
 * Touch is ignored on purpose. A tap already selects, and every surface with a
 * card also has a detail panel that says more.
 */

import { useCallback, useLayoutEffect, useRef, type RefCallback } from 'react'
import { create } from 'zustand'

import type { Guid, Pal } from '../../domain/types.ts'

export type CardDescriptor =
  /** `raw` skips reference data, for the summary's deliberately raw lists. */
  | { kind: 'pal'; pal: Pal; raw?: boolean }
  /** A species rather than a pal: no rolls, but its partner skill and stats. */
  | { kind: 'species'; id: string; note?: string }
  /** `note` is a line about this passive *here*, e.g. "Helps here". */
  | { kind: 'passive'; id: string; note?: string }
  /**
   * An item by id, resolved by the card itself so an inventory cell can stay
   * store-free. `dynamicId` names the one instance a weapon or armour piece
   * is; `places` is set on merged rows that total a count across containers.
   */
  | {
      kind: 'item'
      staticId: string
      count?: number
      dynamicId?: Guid
      places?: number
    }
  /**
   * A player, or a guild member with no character in the level. `raw` skips
   * reference data, as for pals; `note` says why this player is named here.
   */
  | { kind: 'player'; uid: Guid; raw?: boolean; note?: string }

interface Box {
  current: CardDescriptor | undefined
}

const registry = new WeakMap<Element, Box>()

export interface HoverCardState {
  open: boolean
  desc?: CardDescriptor
  anchor?: Element
  /**
   * Where along a wide trigger the pointer entered, from its left edge. A card
   * beside a full-width row has nowhere to go but on top of the page; one
   * beside the pointer sits next to what was being looked at.
   */
  pointerX?: number
}

/** Only the layer subscribes; triggers never re-render on hover. */
export const useHoverCardStore = create<HoverCardState>(() => ({
  open: false,
}))

/** The id of the layer's screen-reader twin, for `aria-describedby`. */
export const DESCRIPTION_ID = 'hover-card-description'

export interface HoverTrigger {
  ref: RefCallback<HTMLElement>
  'data-hc'?: ''
}

/**
 * Props that make an element show `desc` on hover and keyboard focus.
 *
 * `undefined` makes the element inert, so a caller can decide per render
 * without breaking the rules of hooks.
 */
export function useHoverCard(desc: CardDescriptor | undefined): HoverTrigger {
  const box = useRef<Box>({ current: desc })
  // Updated after commit rather than during render; the listeners only read
  // it on the next pointer or focus event, which is always later.
  useLayoutEffect(() => {
    box.current.current = desc
  })
  const ref = useCallback((el: HTMLElement | null) => {
    if (el) registry.set(el, box.current)
  }, [])
  return desc ? { ref, 'data-hc': '' } : { ref }
}

/* -------------------------------------------------------------------------
   Behaviour
   ------------------------------------------------------------------------- */

/** Long enough that sweeping the cursor across a grid does not strobe. */
const OPEN_DELAY = 350
/** After a card closes, the next one opens at once — the grid-browsing case. */
const WARM_FOR = 400
/** Crossing the gap between two adjacent cards should swap, not blink. */
const CLOSE_GRACE = 60

let current: Element | undefined
let priorDescribedBy: string | null = null
/** A card dismissed with Escape or a click stays dismissed until you move on. */
let suppressed: Element | undefined
let openedByFocus = false
let warmUntil = 0
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
let describe: ((desc: CardDescriptor) => string) | undefined

function clearTimers() {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  openTimer = closeTimer = undefined
}

function triggerOf(target: EventTarget | null): Element | undefined {
  if (!(target instanceof Element)) return undefined
  const el = target.closest('[data-hc]')
  return el && registry.get(el)?.current ? el : undefined
}

/** Wider than this, a trigger places its card by the pointer. */
const WIDE = 360

/** The last pointer position, for placing a card beside a wide trigger. */
let lastX = 0

function show(el: Element, byFocus: boolean) {
  clearTimers()
  const desc = registry.get(el)?.current
  if (!desc) return
  if (current !== el) release()
  current = el
  openedByFocus = byFocus

  // Written synchronously, before the store update, so a screen reader that
  // reads the description on focus finds it already there.
  const twin = document.getElementById(DESCRIPTION_ID)
  if (twin && describe) twin.textContent = describe(desc)
  priorDescribedBy = el.getAttribute('aria-describedby')
  el.setAttribute(
    'aria-describedby',
    priorDescribedBy ? `${priorDescribedBy} ${DESCRIPTION_ID}` : DESCRIPTION_ID,
  )

  const rect = el.getBoundingClientRect()
  const pointerX =
    !byFocus && rect.width > WIDE
      ? Math.max(0, Math.min(rect.width, lastX - rect.left))
      : undefined
  useHoverCardStore.setState({ open: true, desc, anchor: el, pointerX })
}

/** Gives the anchor back its own `aria-describedby`. */
function release() {
  if (!current) return
  if (priorDescribedBy)
    current.setAttribute('aria-describedby', priorDescribedBy)
  else current.removeAttribute('aria-describedby')
  priorDescribedBy = null
  current = undefined
}

/** Closes whatever card is open. Safe to call when none is. */
export function hideHoverCard() {
  clearTimers()
  if (useHoverCardStore.getState().open)
    warmUntil = performance.now() + WARM_FOR
  release()
  useHoverCardStore.setState({
    open: false,
    desc: undefined,
    anchor: undefined,
    pointerX: undefined,
  })
}

function onPointerMove(e: PointerEvent) {
  lastX = e.clientX
}

function onPointerOver(e: PointerEvent) {
  if (e.pointerType === 'touch') return
  lastX = e.clientX
  const el = triggerOf(e.target)
  if (!el) return
  if (el === current) {
    clearTimeout(closeTimer)
    return
  }
  if (el === suppressed) return
  suppressed = undefined
  clearTimers()
  const warm =
    useHoverCardStore.getState().open || performance.now() < warmUntil
  if (warm) show(el, false)
  else openTimer = setTimeout(() => show(el, false), OPEN_DELAY)
}

function onPointerOut(e: PointerEvent) {
  if (e.pointerType === 'touch') return
  // Moving onto another trigger is handled by its own `pointerover`.
  if (triggerOf(e.relatedTarget)) return
  if (suppressed && !suppressed.contains(e.relatedTarget as Node | null)) {
    suppressed = undefined
  }
  clearTimeout(openTimer)
  if (current && !openedByFocus) {
    clearTimeout(closeTimer)
    closeTimer = setTimeout(hideHoverCard, CLOSE_GRACE)
  }
}

function onFocusIn(e: FocusEvent) {
  const el = triggerOf(e.target)
  // Only keyboard focus: a mouse click also focuses a button, and a card
  // popping up under the cursor on every click would be noise.
  if (!el || !(e.target as Element).matches(':focus-visible')) return
  suppressed = undefined
  show(el, true)
}

function onFocusOut() {
  if (openedByFocus) hideHoverCard()
}

function onPointerDown() {
  if (!current) {
    clearTimers()
    return
  }
  suppressed = current
  hideHoverCard()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !current) return
  suppressed = current
  hideHoverCard()
}

/**
 * Attaches the document listeners. Returns the teardown.
 *
 * `text` builds the screen-reader twin of a card, and is passed in rather than
 * imported so this module stays free of the card bodies and their data.
 */
export function installHoverCards(
  text: (desc: CardDescriptor) => string,
): () => void {
  describe = text
  const opts = { capture: true, passive: true } as const
  document.addEventListener('pointerover', onPointerOver, opts)
  document.addEventListener('pointermove', onPointerMove, opts)
  document.addEventListener('pointerout', onPointerOut, opts)
  document.addEventListener('pointerdown', onPointerDown, opts)
  document.addEventListener('focusin', onFocusIn, opts)
  document.addEventListener('focusout', onFocusOut, opts)
  document.addEventListener('keydown', onKeyDown, opts)
  // Any scroll: a virtualised grid recycles the hovered cell under a still
  // cursor, and a card left pointing at the recycled one would be wrong.
  document.addEventListener('scroll', hideHoverCard, opts)
  return () => {
    hideHoverCard()
    describe = undefined
    document.removeEventListener('pointerover', onPointerOver, opts)
    document.removeEventListener('pointermove', onPointerMove, opts)
    document.removeEventListener('pointerout', onPointerOut, opts)
    document.removeEventListener('pointerdown', onPointerDown, opts)
    document.removeEventListener('focusin', onFocusIn, opts)
    document.removeEventListener('focusout', onFocusOut, opts)
    document.removeEventListener('keydown', onKeyDown, opts)
    document.removeEventListener('scroll', hideHoverCard, opts)
  }
}
