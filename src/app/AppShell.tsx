import { Suspense, lazy, useEffect } from 'react'

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
import { useSaveStore } from '../store/saveStore.ts'
import { useUiStore, type ViewId } from '../store/uiStore.ts'
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

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace(/^#\/?/, '')
      if (VIEWS.some((v) => v.id === id)) setView(id as ViewId)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [setView])

  useEffect(() => {
    if (window.location.hash !== `#/${view}`) window.location.hash = `/${view}`
  }, [view])

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
      <header className="flex h-13 shrink-0 items-center gap-4 border-b border-[var(--color-line)]/60 px-4">
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
          </Suspense>
        </ErrorBoundary>
      </main>

      <CommandPalette index={index} />
      <AboutDialog />
      <ShortcutsDialog />
    </div>
  )
}
