import { create } from 'zustand'

import type { Guid } from '../domain/types.ts'

/**
 * Cross-view navigation state.
 *
 * The command palette can find a pal, an item stack or a player, but the view
 * that can *show* it is somewhere else. Rather than lifting every view's local
 * state into a global store, a jump publishes a one-shot **focus request**
 * here and switches view; the destination view consumes it on mount and clears
 * it.
 *
 * Consumed rather than merely read, deliberately. A focus that lingered would
 * re-apply every time the user returned to the view, silently overriding
 * filters they had set since — which reads as the app fighting them.
 */
export type Focus =
  | { kind: 'pal'; id: Guid; label: string }
  | { kind: 'player'; id: Guid }
  | { kind: 'container'; id: Guid }
  | { kind: 'base'; id: Guid }
  | { kind: 'item'; staticId: string; label: string }

export type ViewId = 'map' | 'pals' | 'bases' | 'guild' | 'summary'

interface UiState {
  view: ViewId
  focus?: Focus
  /** Open state for the modal surfaces, so shortcuts can reach them. */
  paletteOpen: boolean
  aboutOpen: boolean
  shortcutsOpen: boolean

  setView: (view: ViewId) => void
  /** Switch view and hand it something to select. */
  jump: (view: ViewId, focus: Focus) => void
  /**
   * Drop the pending focus once a view has acted on it.
   *
   * Deliberately **not** a `takeFocus()` that reads and clears in one call: a
   * view derives its initial state from `focus` during render, and a combined
   * read-and-clear would then be writing to a store mid-render — which React
   * reports as "cannot update a component while rendering a different
   * component". Reading during render and clearing in an effect keeps the
   * render pure.
   */
  clearFocus: () => void
  setPalette: (open: boolean) => void
  setAbout: (open: boolean) => void
  setShortcuts: (open: boolean) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  view: 'map',
  paletteOpen: false,
  aboutOpen: false,
  shortcutsOpen: false,

  setView: (view) => set({ view }),
  jump: (view, focus) => set({ view, focus, paletteOpen: false }),
  clearFocus: () => {
    // Guarded so a view mounting without a pending focus does not notify every
    // subscriber for a no-op.
    if (get().focus) set({ focus: undefined })
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setAbout: (aboutOpen) => set({ aboutOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
}))
