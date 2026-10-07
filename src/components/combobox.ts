/**
 * A text field with a list of matches under it, usable from the keyboard.
 *
 * The app had three of these — the map's search, the Bases item search and the
 * Breed passive picker — and each was a text input above a pile of buttons:
 * reachable only by tabbing through every match, and announced to a screen
 * reader as an unrelated field and an unrelated list. This is the one behaviour
 * all three now share.
 *
 * Focus never leaves the input. The arrow keys move a highlight through the
 * list and `aria-activedescendant` tells assistive technology which option that
 * is, which is the pattern a combobox is defined by: typing keeps working while
 * the list is being walked.
 *
 * The key handling is a pure function so it can be tested without a DOM; the
 * repository runs no component tests.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'

export interface ComboboxState {
  /** The highlighted option, or -1 for none. */
  active: number
  /** How many options are on offer. */
  count: number
  /** Whether the list is showing at all. */
  open: boolean
}

export type ComboboxAction =
  /** Move the highlight. */
  | { kind: 'move'; active: number }
  /** Choose an option. */
  | { kind: 'pick'; index: number }
  /** Dismiss the list. */
  | { kind: 'close' }

/**
 * What a key press means, or nothing when the key is not the list's to take.
 *
 * Returning nothing matters as much as the rest: Home, End and the horizontal
 * arrows belong to the text caret, and Escape on a closed list belongs to
 * whatever is open behind it.
 */
export function comboboxKey(
  { active, count, open }: ComboboxState,
  key: string,
): ComboboxAction | undefined {
  if (!open) return undefined
  switch (key) {
    case 'ArrowDown':
      if (count === 0) return undefined
      return { kind: 'move', active: active >= count - 1 ? 0 : active + 1 }
    case 'ArrowUp':
      if (count === 0) return undefined
      return { kind: 'move', active: active <= 0 ? count - 1 : active - 1 }
    case 'Enter':
      if (count === 0) return undefined
      // With nothing highlighted, Enter takes the best match: the list is
      // ranked, and typing a name and pressing Enter is the fast path.
      return { kind: 'pick', index: active === -1 ? 0 : active }
    case 'Escape':
      return { kind: 'close' }
    default:
      return undefined
  }
}

export interface ComboboxOptions {
  /** How many options are showing. */
  count: number
  /** Whether the list is showing. Usually "the query is not empty". */
  open: boolean
  onPick: (index: number) => void
  /** Escape, or a press outside. Usually clears the query. */
  onClose: () => void
  /**
   * Changes whenever the options do — the query, in practice. The highlight
   * belongs to one set of options and is dropped when this changes.
   */
  resetKey: string
  /**
   * The element wrapping the input and the list; a press outside it closes the
   * list. Owned by the caller and passed in, rather than made here and handed
   * back, because the returned object is spread into JSX during render and the
   * linter will not have a ref travel that way.
   */
  rootRef: RefObject<HTMLElement | null>
}

export interface Combobox {
  active: number
  inputProps: {
    role: 'combobox'
    'aria-expanded': boolean
    'aria-controls': string
    'aria-autocomplete': 'list'
    'aria-activedescendant': string | undefined
    autoComplete: 'off'
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  }
  listProps: { id: string; role: 'listbox' }
  optionProps: (index: number) => {
    id: string
    role: 'option'
    'aria-selected': boolean
    /** Options are reached with the arrow keys, not by tabbing through them. */
    tabIndex: -1
  }
}

export function useCombobox({
  count,
  open,
  onPick,
  onClose,
  resetKey,
  rootRef,
}: ComboboxOptions): Combobox {
  const id = useId()
  const optionId = (i: number) => `${id}-opt-${i}`

  // The highlight remembers which options it was for, so a new query starts
  // with none without an effect having to reset it.
  const [mark, setMark] = useState({ active: -1, for: resetKey })
  const active = mark.for === resetKey && mark.active < count ? mark.active : -1

  const activeId = active === -1 ? undefined : optionId(active)
  useEffect(() => {
    if (activeId) {
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeId])

  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      closeRef.current()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, rootRef])

  return {
    active,
    inputProps: {
      role: 'combobox',
      'aria-expanded': open,
      'aria-controls': `${id}-list`,
      'aria-autocomplete': 'list',
      'aria-activedescendant': activeId,
      autoComplete: 'off',
      onKeyDown: (e) => {
        const action = comboboxKey({ active, count, open }, e.key)
        if (!action) return
        e.preventDefault()
        // Escape closed this list; it should not also close the drawer behind.
        e.stopPropagation()
        if (action.kind === 'move') {
          setMark({ active: action.active, for: resetKey })
        } else if (action.kind === 'pick') onPick(action.index)
        else onClose()
      },
    },
    listProps: { id: `${id}-list`, role: 'listbox' },
    optionProps: (index) => ({
      id: optionId(index),
      role: 'option',
      'aria-selected': index === active,
      tabIndex: -1,
    }),
  }
}

/** The highlight for an option, shared so the three lists read alike. */
export const OPTION_ACTIVE =
  'aria-selected:bg-[var(--color-signal)]/[0.14] aria-selected:shadow-[inset_2px_0_0_var(--color-signal)]'
