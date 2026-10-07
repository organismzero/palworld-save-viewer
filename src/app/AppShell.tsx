import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'

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
const BuildsView = lazy(() =>
  import('../views/builds/BuildsView.tsx').then((m) => ({
    default: m.BuildsView,
  })),
)
// Lazy for the same reason the views are: nobody pays for the tray's sheets
// until they open it.
const Tray = lazy(() =>
  import('./tray/Tray.tsx').then((m) => ({ default: m.Tray })),
)
import { useSaveStore } from '../store/saveStore.ts'
import {
  flushSessionWrite,
  rememberPref,
  setRememberPref,
  type RememberPref,
} from '../store/session.ts'
import { runEscape, useUiStore, type ViewId } from '../store/uiStore.ts'
import { parseHash } from './viewParams.ts'
import { cn, tabId } from '../lib/utils.ts'
import { Button, TabBar } from '../components/controls.tsx'
import { KeyHint, PromptBar } from '../components/primitives.tsx'
import { filesFromDrop } from './dropEntries.ts'
import { useFilePicker } from './filePicker.tsx'
import { CommandPalette } from './CommandPalette.tsx'
import { Diagnostics } from './Diagnostics.tsx'
import { AboutDialog, ShortcutsDialog } from './Dialogs.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { HoverCardLayer } from '../components/cards/HoverCardLayer.tsx'

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
  // Last for the same reason Breed is: number keys are positional.
  { id: 'builds', label: 'Builds' },
] as const satisfies readonly { id: ViewId; label: string }[]

/** Ties the tab strip to the one panel it drives, for `aria-controls`. */
const VIEW_TABS = 'view'
const VIEW_PANEL = 'view-panel'

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

      // Read at the keypress rather than subscribed to: a handler rebuilt on
      // every open and close would be re-registered for no gain.
      const { paletteOpen, aboutOpen, shortcutsOpen } = useUiStore.getState()
      // The two native dialogs sit in the top layer and contain focus, so
      // anything opened from a key while one is up opens *behind* it — and a
      // digit used to switch the view underneath, out of sight.
      const modal = aboutOpen || shortcutsOpen

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!modal) setPalette(!paletteOpen)
        return
      }
      // The dialogs and the palette each handle their own Escape.
      if (modal || paletteOpen) return

      // Before the typing guard, deliberately: Escape from a drawer's own
      // search box should still close the drawer.
      if (e.key === 'Escape') {
        if (runEscape()) e.preventDefault()
        return
      }
      if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        setShortcuts(true)
        return
      }
      if (e.key.toLowerCase() === 't') {
        e.preventDefault()
        const ui = useUiStore.getState()
        ui.setTray({ open: !ui.trayOpen })
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

/** Whether a drag is carrying files rather than, say, a text selection. */
function carriesFiles(dt: DataTransfer | null): boolean {
  return dt ? Array.from(dt.types).includes('Files') : false
}

/**
 * Drop handling for a save that is already open.
 *
 * The loaded app is a drop target too, not just the landing screen: `Level.sav`
 * is the only file this app truly needs, and everything else — world metadata,
 * one player save or a whole `Players/` folder, the client's own `LocalData` —
 * is meant to be addable afterwards, in any order. `acceptFiles` has always
 * merged additions onto the open world; until this there was simply no way to
 * hand it anything once `DropZone` had unmounted.
 *
 * A depth *counter* rather than the boolean `DropZone` can afford. The shell has
 * hundreds of descendants, and moving the pointer between two of them fires
 * `dragleave` on the one being left before `dragenter` on the one being entered
 * — so a boolean flickers the overlay off at every internal boundary the cursor
 * crosses. Leaving the window fires the outermost `dragleave` and takes the
 * count to zero, which is the case that has to keep working.
 *
 * The `types` check is what stops dragging a selection of text inside the app
 * from raising an overlay offering to parse it.
 */
function useShellDrop() {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const handlers = {
    onDragEnter: (e: DragEvent<HTMLElement>) => {
      if (!carriesFiles(e.dataTransfer)) return
      depth.current += 1
      setOver(true)
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!carriesFiles(e.dataTransfer)) return
      // Both lines are load-bearing: without `preventDefault` the browser treats
      // the shell as a non-target and shows the no-drop cursor over the entire
      // app, and without `dropEffect` the pointer says "move" while the app is
      // in fact copying nothing anywhere.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      depth.current = 0
      setOver(false)
      void filesFromDrop(e.dataTransfer).then((files) => {
        if (files.length > 0) void useSaveStore.getState().acceptFiles(files)
      })
    },
  }

  return { over, handlers }
}

/**
 * What a drag over the loaded app is offering to do.
 *
 * `pointer-events-none` so the drop lands on whatever is underneath and bubbles
 * to the shell's own handler — an overlay that appears under the cursor and then
 * swallows the `drop` event is a drop target that rejects every drop.
 */
function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[rgb(3_9_13/0.72)] p-8 backdrop-blur-sm">
      <div className="corner-ticks relative isolate max-w-md border border-dashed border-[var(--color-signal)] bg-[var(--color-signal)]/[0.06] px-10 py-9 text-center [--tick-color:var(--color-signal)]">
        <div className="label">add to this save</div>
        <div className="mt-3 text-lg">Drop to add these files</div>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          <span className="num">LevelMeta.sav</span>, your{' '}
          <span className="num">Players</span> folder or single player saves,
          and <span className="num">LocalData.sav</span> all merge into the
          world already open. Another <span className="num">Level.sav</span>{' '}
          replaces it.
        </p>
      </div>
    </div>
  )
}

export function AppShell({ index }: { index: SaveIndex }) {
  const view = useHashSync()
  useShortcuts()

  const { fileName, reset } = useSaveStore()
  const setPalette = useUiStore((s) => s.setPalette)
  const setAbout = useUiStore((s) => s.setAbout)
  const trayOpen = useUiStore((s) => s.trayOpen)
  const setTray = useUiStore((s) => s.setTray)
  const add = useFilePicker()
  const drop = useShellDrop()

  return (
    <div className="flex h-dvh flex-col" {...drop.handlers}>
      <header className="flex h-[var(--header-height)] shrink-0 items-center gap-5 border-b border-[var(--color-line)] bg-[rgb(5_13_19/0.8)] px-4">
        {/*
          The wordmark is the one thing here that does nothing, so it is what
          gives way: the row holds seven tabs and eight controls, and below
          1600px there is not room for those and a title.
        */}
        <span className="hidden font-display text-lg font-[200] tracking-[0.12em] whitespace-nowrap uppercase min-[1600px]:inline">
          Palworld Save Viewer
        </span>

        {/*
          A real tablist, not a nav of links: `aria-controls` points at the one
          panel below, which is labelled back by the active tab. Arrow keys move
          focus without switching view — see `useTabKeys` — because every view is
          a separate lazy chunk and one of them starts Pixi.
        */}
        <TabBar
          name={VIEW_TABS}
          panelId={VIEW_PANEL}
          tabs={VIEWS.map((v, i) => ({
            id: v.id,
            label: v.label,
            hint: i + 1,
          }))}
          value={view}
          onChange={(id) => useUiStore.getState().setView(id as ViewId)}
          className="max-w-3xl flex-1"
        />

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            keyHint="⌘K"
            onClick={() => setPalette(true)}
            aria-label="Search this save"
            className="hidden sm:inline-flex"
          >
            Search
          </Button>

          {/*
            The address bar already holds a link to exactly this — view, filters,
            selection, breeding target — and nothing else in the app says so.
          */}
          <Button
            size="sm"
            onClick={copyLink}
            title="Copy a link to this view as it is now. It opens the same way for anyone with the same save."
            className="hidden xl:inline-flex"
          >
            Copy link
          </Button>

          <Button
            size="sm"
            keyHint="T"
            aria-expanded={trayOpen}
            onClick={() => setTray({ open: !trayOpen })}
            title="Reference sheets and saved breeding paths"
          >
            Tray
          </Button>

          <span className="label hidden max-w-40 truncate lg:inline">
            {fileName}
          </span>

          <Diagnostics index={index} />

          <Button
            size="sm"
            onClick={() => setAbout(true)}
            title="Data sources and licence"
          >
            About
          </Button>

          {/*
            A picker as well as the window-wide drop target, for the same reason
            the landing screen has one: the file somebody wants next is usually a
            specific one, and `Players/` is a folder of 32-character names that
            nobody enjoys dragging out of.
          */}
          <Button
            size="sm"
            onClick={add.open}
            title="Add LevelMeta.sav, player saves or LocalData.sav to this world"
          >
            Add files
          </Button>

          <Button
            size="sm"
            onClick={() => {
              reset()
              // The params described the world being closed. Left in place, the
              // next save would open on this one's filters, selections and
              // breeding target, most of which name things it does not contain.
              useUiStore.getState().clearViewParams()
              history.replaceState(
                null,
                '',
                window.location.pathname + window.location.search,
              )
            }}
          >
            Load another
          </Button>
          {add.input}
        </div>
      </header>

      <RememberOffer />

      {/*
        The view and the tray share this row. `relative` is for the tray when it
        floats: it is positioned against this box rather than the window, which
        is what keeps it between the header and the prompt row in both modes.
      */}
      <div className="relative flex min-h-0 flex-1">
        <main
          id={VIEW_PANEL}
          role="tabpanel"
          aria-labelledby={tabId(VIEW_TABS, view)}
          className="min-h-0 min-w-0 flex-1"
        >
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
              {view === 'builds' && <BuildsView index={index} />}
            </Suspense>
          </ErrorBoundary>
        </main>

        {trayOpen && (
          <Suspense fallback={null}>
            <Tray index={index} />
          </Suspense>
        )}
      </div>

      <Notices />
      <Prompts />

      {drop.over && <DropOverlay />}

      <CommandPalette index={index} />
      <HoverCardLayer index={index} />
      <AboutDialog />
      <ShortcutsDialog />
    </div>
  )
}

/**
 * Put a link to the current view on the clipboard.
 *
 * Built from the store rather than read from `location`: the hash is written on
 * a trailing throttle, so for a moment after any change the address bar is one
 * step behind what is on screen.
 */
function copyLink() {
  const { view, viewParams, notify } = useUiStore.getState()
  const qs = viewParams[view]
  const { origin, pathname, search } = window.location
  const link = `${origin}${pathname}${search}#/${view}${qs ? `?${qs}` : ''}`
  void navigator.clipboard.writeText(link).then(
    () => notify('Link copied'),
    () => notify('Could not reach the clipboard.', { tone: 'warn' }),
  )
}

/**
 * The footer prompt row the game ends every screen with.
 *
 * Only keys that do something get printed. The design system's own row offers
 * `E Marker` and `R Snap to base`; this app never writes to a save and has no
 * marker to place, and the two map keys belong to the map's own row rather than
 * to every screen. `Esc` appears only while there is something for it to close.
 */
function Prompts() {
  const anyOpen = useUiStore(
    (s) => s.paletteOpen || s.aboutOpen || s.shortcutsOpen || s.escapeDepth > 0,
  )

  return (
    <PromptBar className="shrink-0 border-t border-[var(--color-line-faint)] bg-[rgb(5_13_19/0.7)]">
      <Prompt keys="⌘K">Search</Prompt>
      <Prompt keys="1–7">Switch view</Prompt>
      <Prompt keys="T">Tray</Prompt>
      <Prompt keys="?">Shortcuts</Prompt>
      {anyOpen && <Prompt keys="Esc">Close</Prompt>}
    </PromptBar>
  )
}

/**
 * Things that happened, stacked above the footer.
 *
 * Positioned over the view rather than in the column, so a notice arriving does
 * not shove the map up by its own height and back down five seconds later.
 * `role="status"` on the stack, not on each row: a live region has to exist
 * before its content changes for the change to be announced.
 */
function Notices() {
  const notices = useUiStore((s) => s.notices)
  const dismiss = useUiStore((s) => s.dismiss)

  return (
    <div className="relative shrink-0">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute right-4 bottom-2 z-40 flex flex-col items-end gap-1.5"
      >
        {notices.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => dismiss(n.id)}
            title="Dismiss"
            className={cn(
              'pointer-events-auto max-w-md animate-[pw-panel-in_var(--dur-fast)_var(--ease-out)] rounded-panel border bg-[var(--color-panel-solid)] px-3 py-1.5 text-left text-sm',
              n.tone === 'warn'
                ? 'border-[var(--color-gold)]/60 text-[var(--color-gold)]'
                : 'border-[var(--color-line-strong)]',
            )}
          >
            {n.text}
          </button>
        ))}
      </div>
    </div>
  )
}

function Prompt({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[var(--color-muted)]">
      <KeyHint>{keys}</KeyHint>
      {children}
    </span>
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
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-2 text-sm">
      <span>Keep this save in this browser?</span>
      <span className="text-[var(--color-muted)]">
        It stays on this machine and is never uploaded — it just means you do
        not have to find the file again after a reload.
      </span>
      <span className="ml-auto flex gap-2">
        <Button size="sm" tone="signal" onClick={() => answer(true)}>
          Keep it
        </Button>
        <Button size="sm" onClick={() => answer(false)}>
          No thanks
        </Button>
      </span>
    </div>
  )
}
