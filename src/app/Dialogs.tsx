/**
 * The two informational surfaces: where the data comes from, and what the
 * keyboard does.
 *
 * Hand-rolled rather than pulled from a component library. A modal needs three
 * things to be correct — Escape closes it, a backdrop click closes it, and
 * focus does not escape behind it — and `<dialog>` gives all three natively,
 * including the top-layer stacking that otherwise takes a portal and a
 * z-index argument.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { clearCache } from '../refdata/refdata.ts'
import { bytes, relativeTime } from '../lib/format.ts'
import {
  flushSessionWrite,
  forgetSession,
  rememberPref,
  sessionDescriptor,
  setRememberPref,
} from '../store/session.ts'
import { useUiStore } from '../store/uiStore.ts'

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // `showModal` is what puts the element in the top layer and traps focus;
    // toggling the `open` attribute directly does neither.
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // The backdrop is part of the dialog element, so a click landing on
        // the element itself rather than its contents is a backdrop click.
        if (e.target === ref.current) onClose()
      }}
      className="raised-edge m-auto w-full max-w-2xl rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] p-0 text-[var(--color-text)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[var(--color-line)]/60 px-5 py-3">
        <h2 className="font-display text-lg">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          ×
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  )
}

/* -------------------------------------------------------------------------
   Data sources and licence
   ------------------------------------------------------------------------- */

export function AboutDialog() {
  const open = useUiStore((s) => s.aboutOpen)
  const setAbout = useUiStore((s) => s.setAbout)
  const [cleared, setCleared] = useState<number>()

  return (
    <Modal
      open={open}
      onClose={() => setAbout(false)}
      title="Data sources and licence"
    >
      <div className="space-y-5 text-sm leading-relaxed">
        <section>
          <h3 className="label mb-2">your save</h3>
          <p className="text-[var(--color-muted)]">
            Decompressed and parsed entirely in this browser, in a worker — raw{' '}
            <span className="num">.sav</span> files included. It is never
            uploaded, and there is no server, no account and no analytics in
            this app.
          </p>
        </section>

        <section>
          <h3 className="label mb-2">saved sessions</h3>
          <SessionControls />
        </section>

        <section>
          <h3 className="label mb-2">game data and art</h3>
          <p className="text-[var(--color-muted)]">
            Pal names, icons, item tables, the world map and the levelling curve
            are Pocketpair&rsquo;s, and none of them are in this repository.
            They are fetched on demand from the{' '}
            <Link href="https://github.com/deafdudecomputers/PalworldSaveTools">
              PalworldSaveTools
            </Link>{' '}
            mirror (MIT) via jsDelivr and cached in IndexedDB, so a second visit
            needs no network at all. If that fetch fails the app runs in a
            degraded mode: raw asset ids and a coordinate grid, with every
            position still exact.
          </p>
          <CacheButton onCleared={setCleared} cleared={cleared} />
        </section>

        <section>
          <h3 className="label mb-2">licence</h3>
          <p className="text-[var(--color-muted)]">
            <strong className="text-[var(--color-text)]">
              GPL-3.0-or-later
            </strong>
            . Raw <span className="num">.sav</span> files are Oodle-compressed,
            and the decompressor that makes them readable in a browser (&thinsp;
            <span className="num">ooz-wasm</span>&thinsp;) is GPL-3.0, so this
            project is too. See{' '}
            <Link href="https://github.com/organismzero/palworld-save-viewer/blob/main/SOURCES.md">
              SOURCES.md
            </Link>{' '}
            for the full reasoning and credits.
          </p>
        </section>

        <section>
          <h3 className="label mb-2">not affiliated</h3>
          <p className="text-[var(--color-muted)]">
            Palworld is © Pocketpair, Inc. This project is not affiliated with
            or endorsed by Pocketpair.
          </p>
        </section>
      </div>
    </Modal>
  )
}

function CacheButton({
  cleared,
  onCleared,
}: {
  cleared?: number
  onCleared: (n: number) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void clearCache()
            .then(onCleared)
            .finally(() => setBusy(false))
        }}
        className="rounded-[6px] border border-[var(--color-line)] px-3 py-1.5 text-xs transition-colors hover:border-[var(--color-signal)] disabled:opacity-50"
      >
        {busy ? 'Clearing…' : 'Clear cached game data'}
      </button>
      {cleared !== undefined && (
        <span className="label">
          freed {bytes(cleared)} · reload to refetch
        </span>
      )}
    </div>
  )
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[var(--color-signal)] underline"
    >
      {children}
    </a>
  )
}

/* -------------------------------------------------------------------------
   Keyboard shortcuts
   ------------------------------------------------------------------------- */

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['⌘', 'K'], what: 'Search everything' },
  { keys: ['1'], what: 'Map' },
  { keys: ['2'], what: 'Pals' },
  { keys: ['3'], what: 'Bases' },
  { keys: ['4'], what: 'Guild' },
  { keys: ['5'], what: 'Summary' },
  { keys: ['?'], what: 'This list' },
  { keys: ['Esc'], what: 'Close whatever is open' },
]

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen)
  const setShortcuts = useUiStore((s) => s.setShortcuts)

  return (
    <Modal
      open={open}
      onClose={() => setShortcuts(false)}
      title="Keyboard shortcuts"
    >
      <dl className="grid gap-2 sm:grid-cols-2">
        {SHORTCUTS.map((s) => (
          <div
            key={s.what}
            className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)]/30 pb-1.5"
          >
            <dt className="text-sm">{s.what}</dt>
            <dd className="flex shrink-0 gap-1">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="num rounded-[4px] border border-[var(--color-line)] px-1.5 py-0.5 text-[11px]"
                >
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="label mt-4">
        ⌘ is Ctrl on Windows and Linux. Number keys are ignored while a text
        field has focus.
      </p>
    </Modal>
  )
}

/**
 * The saved-session controls.
 *
 * Sits above the game-data section, and is worded so the two buttons cannot be
 * confused: one deletes a copy of *your world*, the other deletes downloaded
 * *Pocketpair art*. Both used to be one vague idea of "cached data".
 *
 * Turning the toggle off deletes the snapshot there and then rather than
 * merely stopping future writes — "stop remembering my saves" that leaves
 * three megabytes of parsed world on disk is the failure this whole feature is
 * negotiating around.
 */
function SessionControls() {
  const [pref, setPref] = useState(() => rememberPref())
  const [descriptor, setDescriptor] = useState(() => sessionDescriptor())

  const toggle = (on: boolean) => {
    setPref(on ? 'on' : 'off')
    void setRememberPref(on)
      // Turning it on with a save already open should have a visible effect
      // now, rather than at some later merge that may never happen.
      .then(() => (on ? flushSessionWrite() : undefined))
      .then(() => setDescriptor(sessionDescriptor()))
  }

  return (
    <>
      <label className="flex cursor-pointer items-start gap-2 text-[var(--color-muted)]">
        <input
          type="checkbox"
          checked={pref === 'on'}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-1 accent-[var(--color-signal)]"
        />
        <span>
          Keep the save I have open in this browser, so it comes back after a
          reload. It is stored on this machine only and still never uploaded.
          Only the most recent save is kept.{' '}
          <span className="text-[var(--color-text)]">
            Turning this off deletes what is stored.
          </span>
        </span>
      </label>

      {descriptor && pref === 'on' && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void forgetSession().then(() =>
                setDescriptor(sessionDescriptor()),
              )
            }}
            className="rounded-[6px] border border-[var(--color-line)] px-3 py-1.5 text-xs transition-colors hover:border-[var(--color-signal)]"
          >
            Forget this save
          </button>
          <span className="label">
            <span className="num">{descriptor.fileName}</span> ·{' '}
            {bytes(descriptor.fileBytes)} ·{' '}
            {relativeTime(new Date(descriptor.savedAt))}
          </span>
        </div>
      )}
    </>
  )
}
