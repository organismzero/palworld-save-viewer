import { Suspense, lazy, useEffect, useRef, useState } from 'react'

import type { SaveIndex } from '../domain/types.ts'
import { SaveSummary } from './SaveSummary.tsx'
// Lazily loaded so the drop zone and summary never pay for Pixi (~537 KB) or
// the virtualiser. The map is the default view, but nothing loads until a save
// has actually been parsed.
const MapView = lazy(() =>
  import('../views/map/MapView.tsx').then((m) => ({ default: m.MapView })),
)
const PalsView = lazy(() =>
  import('../views/pals/PalsView.tsx').then((m) => ({ default: m.PalsView })),
)
const BasesView = lazy(() =>
  import('../views/bases/BasesView.tsx').then((m) => ({
    default: m.BasesView,
  })),
)
const GuildView = lazy(() =>
  import('../views/guild/GuildView.tsx').then((m) => ({
    default: m.GuildView,
  })),
)
const BreedView = lazy(() =>
  import('../views/breed/BreedView.tsx').then((m) => ({
    default: m.BreedView,
  })),
)
import { useSaveStore } from '../store/saveStore.ts'
import {
  flushSessionWrite,
  rememberPref,
  setRememberPref,
  type RememberPref,
} from '../store/session.ts'
import { useUiStore, type ViewId } from '../store/uiStore.ts'
import { parseHash } from './viewParams.ts'
import { cn } from '../lib/utils.ts'
import { CommandPalette } from './CommandPalette.tsx'
import { Diagnostics } from './Diagnostics.tsx'
import { AboutDialog, ShortcutsDialog } from './Dialogs.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

const VIEWS = [
  { id: 'map', label: 'Map' },
  { id: 'pals', label: 'Pals' },
  { id: 'bases', label: 'Bases' },
  { id: 'guild', label: 'Guild' },
  { id: 'summary', label: 'Summary' },
  // Appended rather than slotted in next to Guild where it arguably belongs:
  // `useShortcuts` maps number keys positionally, so inserting it would move
  // Summary from 5 to 6 and break the one habit every existing user has. Last
  // place costs nothing and renumbers nothing.
  { id: 'breed', label: 'Breed' },
] as const satisfies readonly { id: ViewId; label: string }[]

/**
 * No router. The parsed index lives in memory and cannot survive a reload, so
 * deep links would be meaningless — but the back button should still work, so
 * the active view mirrors into the hash. This also sidesteps the GitHub Pages
 * SPA-404 problem entirely.
 *
 * The hash is a *mirror* of the store rather than the source of truth, because
 * the command palette also drives the view and needs to set focus in the same
 * commit.
 */
function useHashSync() {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const qs = useUiStore((s) => s.viewParams[s.view])

  /**
   * Seed from the address bar during the **first render**, not in an effect.
   *
   * Views are lazily loaded, so on a cold deep link the shell commits before
   * any of them mounts. If the writer effect below runs first against an empty
   * `viewParams`, it replaces `#/pals?q=…&sel=…` with a bare `#/pals` and the
   * link is gone before anything could read it. Warm navigation hides this
   * completely; every cold load fails.
   */
  useState(() => {
    const { view: id, qs } = parseHash(window.location.hash)
    if (!VIEWS.some((v) => v.id === id)) return null
    const store = useUiStore.getState()
    store.setView(id as ViewId)
    if (qs) store.adoptHashParams(id as ViewId, qs)
    return null
  })

  useEffect(() => {
    const fromHash = () => {
      const { view: id, qs } = parseHash(window.location.hash)
      if (!VIEWS.some((v) => v.id === id)) return
      setView(id as ViewId)
      // Always adopt, even when empty: navigating back to a bare `#/pals`
      // means "clear the filters", and skipping it would strand them.
      useUiStore.getState().adoptHashParams(id as ViewId, qs)
    }
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [setView])

  /**
   * The single writer.
   *
   * Two rules, both learned from what happens without them:
   *
   * - A **view change pushes** (`location.hash =`), a **params-only change
   *   replaces** (`history.replaceState`). Otherwise every keystroke in a
   *   filter box is a history entry and leaving the view takes forty presses of
   *   Back. `replaceState` also does not fire `hashchange`, which conveniently
   *   removes the read-back loop.
   * - **Throttled, trailing.** Safari throws `SecurityError` past roughly 100
   *   `replaceState` calls in 30 seconds, and typing a pal's name is easily ten.
   */
  const lastView = useRef<ViewId | undefined>(undefined)
  const pending = useRef<number | undefined>(undefined)

  useEffect(() => {
    const target = qs ? `#/${view}?${qs}` : `#/${view}`
    if (window.location.hash === target) {
      lastView.current = view
      return
    }

    const viewChanged = lastView.current !== view
    lastView.current = view

    if (viewChanged) {
      window.location.hash = target.slice(1)
      return
    }

    if (pending.current !== undefined) clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = undefined
      history.replaceState(null, '', target)
    }, 400)

    return () => {
      if (pending.current !== undefined) clearTimeout(pending.current)
      pending.current = undefined
    }
  }, [view, qs])

  return view
}

/**
 * Global keys.
 *
 * The guard on `isTyping` is the whole reason this is not three lines: without
 * it, typing "3" into the level filter would throw the user into the Bases
 * view. Modifier combinations are exempt because ⌘K has to work from inside a
 * search box — that is where people are when they want it.
 */
function useShortcuts() {
  const setView = useUiStore((s) => s.setView)
  const setPalette = useUiStore((s) => s.setPalette)
  const setShortcuts = useUiStore((s) => s.setShortcuts)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping =
        target?.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(true)
        return
      }
      if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        setShortcuts(true)
        return
      }
      const i = Number(e.key)
      const view = VIEWS[i - 1]
      if (view && i >= 1 && i <= VIEWS.length) {
        e.preventDefault()
        setView(view.id)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, setPalette, setShortcuts])
}

export function AppShell({ index }: { index: SaveIndex }) {
  const view = useHashSync()
  useShortcuts()

  const { fileName, reset } = useSaveStore()
  const setPalette = useUiStore((s) => s.setPalette)
  const setAbout = useUiStore((s) => s.setAbout)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-13 shrink-0 items-center gap-4 border-b border-[var(--color-line)] px-4">
        <span className="font-display text-sm tracking-tight">
          Palworld Save Viewer
        </span>

        <nav aria-label="Views" className="flex gap-1">
          {VIEWS.map((v, i) => (
            <button
              key={v.id}
              type="button"
              onClick={() => useUiStore.getState().setView(v.id)}
              aria-current={view === v.id ? 'page' : undefined}
              title={`${v.label} (${i + 1})`}
              className={cn(
                'rounded-[6px] px-3 py-1.5 text-sm transition-colors',
                view === v.id
                  ? 'bg-[var(--color-raised)] text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
              )}
            >
              {v.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPalette(true)}
            aria-label="Search this save"
            className="hidden items-center gap-2 rounded-[6px] border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-signal)] sm:flex"
          >
            Search
            <kbd className="num rounded-[3px] border border-[var(--color-line)] px-1 text-[10px]">
              ⌘K
            </kbd>
          </button>

          <span className="label hidden max-w-40 truncate lg:inline">
            {fileName}
          </span>

          <Diagnostics index={index} />

          <button
            type="button"
            onClick={() => setAbout(true)}
            aria-label="Data sources and licence"
            title="Data sources and licence"
            className="rounded-[6px] border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-signal)]"
          >
            About
          </button>

          <button
            type="button"
            onClick={reset}
            className="rounded-[6px] border border-[var(--color-line)] px-2.5 py-1 text-xs transition-colors hover:border-[var(--color-signal)]"
          >
            Load another
          </button>
        </div>
      </header>

      <RememberOffer />

      <main className="flex-1">
        {/* Keyed on the view so switching tabs clears a view's crash. */}
        <ErrorBoundary key={view} what={`the ${view} view`}>
          <Suspense
            fallback={
              <div className="label flex h-64 items-center justify-center">
                loading view
              </div>
            }
          >
            {view === 'map' && <MapView index={index} />}
            {view === 'pals' && <PalsView index={index} />}
            {view === 'bases' && <BasesView index={index} />}
            {view === 'guild' && <GuildView index={index} />}
            {view === 'summary' && <SaveSummary index={index} />}
            {view === 'breed' && <BreedView index={index} />}
          </Suspense>
        </ErrorBoundary>
      </main>

      <CommandPalette index={index} />
      <AboutDialog />
      <ShortcutsDialog />
    </div>
  )
}

/**
 * The one-time "shall I keep this?" ask.
 *
 * A bar under the header rather than a modal, and rather than something in the
 * header itself — that row already carries the title, five nav buttons, search,
 * the filename, diagnostics, About and "Load another", and is tight before this
 * is added. A modal at the moment somebody finally gets to see their world is
 * an interruption; a bar is not.
 *
 * Neither answer can be deferred. There is no dismiss, because an X that leaves
 * the preference unset means the bar returns on the next load, which is
 * nagging rather than asking.
 */
function RememberOffer() {
  const status = useSaveStore((s) => s.status)
  const restoredFrom = useSaveStore((s) => s.restoredFrom)
  const [pref, setPref] = useState<RememberPref>(() => rememberPref())

  // A restored world came *from* storage, so the question is already answered.
  if (pref !== 'unset' || status !== 'ready' || restoredFrom !== undefined) {
    return null
  }

  const answer = (on: boolean) => {
    setPref(on ? 'on' : 'off')
    void setRememberPref(on).then(() => {
      // The world was already loaded when the question was asked, so no store
      // change follows and the subscription has nothing to react to. Without
      // this, saying yes stores nothing until the next player-save merge —
      // which for most people never comes.
      if (on) void flushSessionWrite()
    })
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm">
      <span>Keep this save in this browser?</span>
      <span className="text-[var(--color-muted)]">
        It stays on this machine and is never uploaded — it just means you do
        not have to find the file again after a reload.
      </span>
      <span className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={() => answer(true)}
          className="rounded-[6px] border border-[var(--color-signal)]/60 px-3 py-1 text-xs transition-colors hover:border-[var(--color-signal)]"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={() => answer(false)}
          className="rounded-[6px] border border-[var(--color-line)] px-3 py-1 text-xs transition-colors hover:border-[var(--color-muted)]"
        >
          No thanks
        </button>
      </span>
    </div>
  )
}
