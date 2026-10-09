/**
 * The saved breeding paths, and the two things done with one: keep it, open it.
 *
 * Kept in `localStorage` rather than beside the session snapshot in IndexedDB,
 * and not behind the "keep this save" preference. That preference guards the
 * app writing a copy of somebody's world without being asked. This is the
 * opposite case — nothing is stored until a Save button is pressed, what is
 * stored is a link's worth of text, and the About dialog deletes it.
 *
 * It lives with the Breed view rather than in `src/store/` because it is that
 * view's state: `SavedPath` is its type and `breedCodec` its format, and the
 * stores there are deliberately kept free of any one view's private types.
 */

import { create } from 'zustand'

import type { SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { useUiStore } from '../../store/uiStore.ts'
import type { BreedParams } from './params.ts'
import { passiveText } from './passiveText.ts'
import {
  MAX_PATHS,
  canonicalPath,
  defaultName,
  parseStored,
  serialiseStored,
  type PathSummary,
  type SavedPath,
} from './savedPaths.ts'
import { speciesText } from './speciesText.ts'

const KEY = 'psv.paths'

function read() {
  try {
    return parseStored(localStorage.getItem(KEY))
  } catch {
    // Storage that throws on read will throw on write too.
    return { paths: [], writable: false }
  }
}

interface PathsState {
  paths: SavedPath[]
  /** False when storage is unusable or holds a newer version's paths. */
  writable: boolean
  /**
   * The path last saved or opened, for offering "update" once it has drifted.
   * Not stored: after a reload nothing has been opened yet.
   */
  activeId?: string

  add: (path: Omit<SavedPath, 'id' | 'createdAt'>) => SavedPath | undefined
  rename: (id: string, name: string) => void
  /** Point an existing path at different params, keeping its name. */
  repoint: (id: string, to: Pick<SavedPath, 'qs' | 'playerUid'>) => void
  /** Record how a path's route stands, and drop ticks for steps now gone. */
  setProgress: (id: string, summary: PathSummary, ticks: string[]) => void
  /** Tick a step off, or back on. */
  tick: (id: string, key: string, done: boolean) => void
  remove: (id: string) => void
  /** Delete every path, including any this version could not read. */
  clear: () => void
  setActive: (id: string | undefined) => void
}

const START = read()

// Another tab saved, renamed or deleted a path. Every write here is the whole
// list, so a tab still holding the list it loaded with would put that back
// over the other's change the next time it wrote anything at all — and it
// writes when it merely opens one of its own paths.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    // A null key is `localStorage.clear()`.
    if (e.key === KEY || e.key === null) usePathsStore.setState(read())
  })
}

export const usePathsStore = create<PathsState>((set, get) => {
  const commit = (paths: SavedPath[]) => {
    if (!get().writable) return
    set({ paths })
    try {
      localStorage.setItem(KEY, serialiseStored(paths))
    } catch {
      // Out of room, most likely. The list still works for this visit, which
      // beats refusing to hold what the user just asked to keep.
      useUiStore
        .getState()
        .notify('Could not store that. It will last until this tab closes.', {
          tone: 'warn',
        })
    }
  }

  return {
    paths: START.paths,
    writable: START.writable,

    add: (path) => {
      const { paths, writable } = get()
      if (!writable || paths.length >= MAX_PATHS) return undefined
      const saved: SavedPath = {
        ...path,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      }
      // Newest first: the one just saved is the one being worked on.
      commit([saved, ...paths])
      set({ activeId: saved.id })
      return saved
    },

    rename: (id, name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      commit(
        get().paths.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
      )
    },

    repoint: (id, to) =>
      commit(get().paths.map((p) => (p.id === id ? { ...p, ...to } : p))),

    setProgress: (id, summary, ticks) => {
      const path = get().paths.find((p) => p.id === id)
      if (!path) return
      // Compared as text because this is called from an effect on every
      // settled plan, and writing an unchanged summary would be a storage
      // write and a render of the whole list for nothing.
      const same =
        JSON.stringify(path.summary) === JSON.stringify(summary) &&
        JSON.stringify(path.ticks ?? []) === JSON.stringify(ticks)
      if (same) return
      commit(
        get().paths.map((p) => (p.id === id ? { ...p, summary, ticks } : p)),
      )
    },

    tick: (id, key, done) =>
      commit(
        get().paths.map((p) => {
          if (p.id !== id) return p
          const rest = (p.ticks ?? []).filter((t) => t !== key)
          return { ...p, ticks: done ? [...rest, key] : rest }
        }),
      ),

    remove: (id) => {
      commit(get().paths.filter((p) => p.id !== id))
      if (get().activeId === id) set({ activeId: undefined })
    },

    clear: () => {
      try {
        localStorage.removeItem(KEY)
        set({ paths: [], writable: true, activeId: undefined })
      } catch {
        set({ paths: [], activeId: undefined })
      }
    },

    setActive: (activeId) => {
      if (get().activeId !== activeId) set({ activeId })
    },
  }
})

/**
 * Keep the path the Breed view is showing.
 *
 * Saying which of the three things happened matters more than usual here: the
 * button is pressed from the view, and the list it changes is in a tray that
 * may well be shut.
 */
export function saveCurrentPath(
  params: BreedParams,
  index: SaveIndex,
  data: Refdata | undefined,
): SavedPath | undefined {
  const { notify } = useUiStore.getState()
  const store = usePathsStore.getState()
  const current = canonicalPath(params, index)
  if (!current) return undefined

  const existing = store.paths.find((p) => p.qs === current.qs)
  if (existing) {
    store.setActive(existing.id)
    notify(`Already saved as “${existing.name}”`)
    return existing
  }
  if (!store.writable) {
    notify('Saved paths cannot be stored in this browser.', { tone: 'warn' })
    return undefined
  }
  if (store.paths.length >= MAX_PATHS) {
    notify(`That is the limit of ${MAX_PATHS} saved paths. Delete one first.`, {
      tone: 'warn',
    })
    return undefined
  }

  const name = defaultName(params, index, speciesText(data), passiveText(data))
  const saved = store.add({ name, ...current })
  if (saved) notify(`Saved “${saved.name}”`)
  return saved
}

/**
 * Show a saved path in the Breed view.
 *
 * Adopted the way a browser navigation is, so the view re-reads its params —
 * the same door the Builds view's "breed →" link comes through. From inside
 * the Breed view it also leaves a history entry first, so Back returns to
 * whatever was being looked at: switching paths is a navigation, and one that
 * could not be undone would make trying another path a risk.
 */
export function openPath(path: SavedPath) {
  const ui = useUiStore.getState()
  usePathsStore.getState().setActive(path.id)
  if (ui.view === 'breed') {
    history.pushState(null, '', `#/breed?${path.qs}`)
    ui.adoptHashParams('breed', path.qs)
    return
  }
  // The shell's hash writer pushes on a view change, so no entry is needed.
  ui.adoptHashParams('breed', path.qs)
  ui.setView('breed')
}

/** The full address of a path, for the clipboard. */
export function pathLink(path: SavedPath): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}#/breed?${path.qs}`
}
