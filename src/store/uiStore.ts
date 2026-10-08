import { readPrefs } from './prefs.ts'
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
  /** Bases: open the base or world list this structure is in, on it. */
  | { kind: 'structure'; id: Guid }
  /** Map: select and centre whatever has this id, on whichever layer. */
  | { kind: 'map'; id: string }
  /** Pals: every pal of one species, optionally one player's. `label` is its display name. */
  | { kind: 'species'; id: string; label: string; owner?: Guid }
  /** Builds: the Fight purpose, against this species. */
  | { kind: 'fight'; species: string }

export type ViewId =
  'map' | 'pals' | 'bases' | 'guild' | 'breed' | 'summary' | 'builds'

/**
 * Something that happened, said without a dialog.
 *
 * For outcomes the user caused but cannot otherwise see: a file that was
 * turned away, a link that reached the clipboard, a preference the app had to
 * reverse. Not for errors that block — those keep their own screens.
 */
export interface Notice {
  id: number
  text: string
  tone: 'info' | 'warn'
}

/** The utility tray's sheets. */
export type TrayTab = 'passives' | 'paths' | 'types'

const TRAY_TABS: readonly TrayTab[] = ['passives', 'paths', 'types']
const TRAY_KEY = 'psv.tray'

interface TrayPref {
  open: boolean
  pinned: boolean
  tab: TrayTab
}

/**
 * How the tray was left: which sheet, and whether it was docked.
 *
 * A preference about the app's own furniture, with nothing of the save in it,
 * so it is kept without asking — unlike everything in `session.ts`. Storage
 * that throws (private mode, a disabled origin) just means the default.
 */
function readTrayPref(): TrayPref {
  const fallback: TrayPref = { open: false, pinned: false, tab: 'passives' }
  try {
    const raw = localStorage.getItem(TRAY_KEY)
    if (!raw) return fallback
    const v = JSON.parse(raw) as Partial<TrayPref>
    const pinned = v.pinned === true
    return {
      // Only a docked tray comes back open. An overlay left open would cover
      // part of the first screen somebody sees after a reload.
      open: pinned && v.open === true,
      pinned,
      tab: TRAY_TABS.find((t) => t === v.tab) ?? fallback.tab,
    }
  } catch {
    return fallback
  }
}

function writeTrayPref(pref: TrayPref) {
  try {
    localStorage.setItem(TRAY_KEY, JSON.stringify(pref))
  } catch {
    // Not being able to remember this is not worth telling anyone about.
  }
}

const NOTICE_TTL = 5000
let noticeSeq = 0

/**
 * What Escape closes, innermost last.
 *
 * Kept beside the store rather than in it: these are callbacks, and putting
 * functions that change on every render into state would notify every
 * subscriber each time a drawer re-rendered. The store carries only the depth,
 * which is all the footer needs to know.
 */
const escapes: (() => void)[] = []

/** Close the innermost open drawer. False when there was nothing to close. */
export function runEscape(): boolean {
  const top = escapes[escapes.length - 1]
  if (!top) return false
  top()
  return true
}

interface UiState {
  view: ViewId
  focus?: Focus
  /** Open state for the modal surfaces, so shortcuts can reach them. */
  paletteOpen: boolean
  aboutOpen: boolean
  shortcutsOpen: boolean
  settingsOpen: boolean
  /**
   * Counts jumps. A view reads its focus once, as it mounts, so a jump to
   * something in the view already on screen found nobody listening and did
   * nothing. The shell keys the view on this, which mounts it afresh.
   */
  jumpSeq: number
  /**
   * What the tray's passive sheet is searching for. Here and not in the sheet,
   * so the palette can open the sheet on a passive it just found.
   */
  passiveQuery: string

  /**
   * Each view's state as a serialised query string, for `useHashSync` to fold
   * into the hash. Strings rather than objects deliberately: it keeps this
   * store free of every view's private types, and makes "did it change" a
   * string compare instead of a deep one.
   */
  viewParams: Partial<Record<ViewId, string>>
  /**
   * Bumped **only** by a browser navigation — back, forward, or a pasted URL.
   *
   * This is what lets a view tell "I wrote this" from "the user pressed Back".
   * Diffing the query string would look equivalent and is subtly wrong: any
   * round-trip that is not byte-exact reads as a navigation and re-decodes over
   * whatever the user just clicked.
   */
  paramsEpoch: number

  trayOpen: boolean
  trayTab: TrayTab
  /** Docked beside the view rather than floating over its right edge. */
  trayPinned: boolean
  /**
   * The tray was opened by the user in this visit, rather than restored open.
   *
   * Decides whether it takes focus. A docked tray that comes back with the
   * page must not: focus would land in its search box before anything had
   * been pressed, and the number keys would type into it instead of switching
   * view.
   */
  trayOpenedHere: boolean

  notices: Notice[]
  /** How many drawers Escape could close right now. */
  escapeDepth: number

  setView: (view: ViewId) => void
  /** From a view, on every state change. Never triggers a re-decode. */
  publishParams: (view: ViewId, qs: string) => void
  /** From `hashchange`. Bumps the epoch so views re-read. */
  adoptHashParams: (view: ViewId, qs: string) => void
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
  setSettings: (open: boolean) => void
  setPassiveQuery: (query: string) => void
  setShortcuts: (open: boolean) => void
  /**
   * Forget every view's params, for when the world they described is gone.
   *
   * The view itself stays: which tab somebody was on says nothing about the
   * save, and landing back on it with the next one is what they would expect.
   */
  clearViewParams: () => void
  /** Open, close or change the tray. Omitted fields keep their value. */
  setTray: (next: { open?: boolean; tab?: TrayTab; pinned?: boolean }) => void
  notify: (text: string, opts?: { tone?: Notice['tone']; ttl?: number }) => void
  dismiss: (id: number) => void
  /** Register something for Escape to close. Returns the unregister. */
  pushEscape: (close: () => void) => () => void
}

const TRAY = readTrayPref()

export const useUiStore = create<UiState>((set, get) => ({
  // Where the app opens when the address names no view. An address that
  // names one is adopted by the shell a moment later and wins.
  view: readPrefs().defaultView ?? 'map',
  trayOpen: TRAY.open,
  trayTab: TRAY.tab,
  trayPinned: TRAY.pinned,
  trayOpenedHere: false,
  paletteOpen: false,
  aboutOpen: false,
  shortcutsOpen: false,
  settingsOpen: false,
  jumpSeq: 0,
  passiveQuery: '',
  viewParams: {},
  paramsEpoch: 0,
  notices: [],
  escapeDepth: 0,

  setView: (view) => set({ view }),

  publishParams: (view, qs) => {
    // Guarded: a view re-publishing an unchanged string must not notify the
    // shell, or the hash writer runs on every render.
    if (get().viewParams[view] === qs) return
    set((s) => ({ viewParams: { ...s.viewParams, [view]: qs } }))
  },

  adoptHashParams: (view, qs) => {
    set((s) => ({
      viewParams: { ...s.viewParams, [view]: qs },
      paramsEpoch: s.paramsEpoch + 1,
    }))
  },

  jump: (view, focus) =>
    // The destination's stored params are dropped: a jump is a fresh intent,
    // and leaving them would have the view's seed and its hash state fighting.
    set((s) => ({
      view,
      focus,
      jumpSeq: s.jumpSeq + 1,
      paletteOpen: false,
      viewParams: { ...s.viewParams, [view]: undefined },
    })),
  clearFocus: () => {
    // Guarded so a view mounting without a pending focus does not notify every
    // subscriber for a no-op.
    if (get().focus) set({ focus: undefined })
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setAbout: (aboutOpen) => set({ aboutOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setPassiveQuery: (passiveQuery) => set({ passiveQuery }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),

  clearViewParams: () => set({ viewParams: {}, focus: undefined }),

  setTray: (next) => {
    const s = get()
    const pref = {
      open: next.open ?? s.trayOpen,
      tab: next.tab ?? s.trayTab,
      pinned: next.pinned ?? s.trayPinned,
    }
    set({
      trayOpen: pref.open,
      trayTab: pref.tab,
      trayPinned: pref.pinned,
      trayOpenedHere: pref.open && (s.trayOpenedHere || !s.trayOpen),
    })
    writeTrayPref(pref)
  },

  notify: (text, opts) => {
    // Saying the same thing twice at once is noise, and React's strict mode
    // runs a mount effect twice in development.
    if (get().notices.some((n) => n.text === text)) return
    const id = ++noticeSeq
    set((s) => ({
      notices: [...s.notices, { id, text, tone: opts?.tone ?? 'info' }],
    }))
    setTimeout(() => get().dismiss(id), opts?.ttl ?? NOTICE_TTL)
  },
  dismiss: (id) => {
    if (!get().notices.some((n) => n.id === id)) return
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
  },

  pushEscape: (close) => {
    escapes.push(close)
    set({ escapeDepth: escapes.length })
    return () => {
      const i = escapes.lastIndexOf(close)
      if (i !== -1) escapes.splice(i, 1)
      set({ escapeDepth: escapes.length })
    }
  },
}))
