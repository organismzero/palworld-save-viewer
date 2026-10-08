/**
 * The two informational surfaces: where the data comes from, and what the
 * keyboard does. Anything that can be changed is in `Settings.tsx`.
 *
 * Both sit in the shared `Modal`, which is still `<dialog>` underneath — a modal
 * needs Escape, a backdrop click and contained focus to be correct, and the
 * platform gives all three, including top-layer stacking that otherwise takes a
 * portal and a z-index argument.
 */

import type { ReactNode } from 'react'

import { useUiStore } from '../store/uiStore.ts'
import { Modal } from '../components/controls.tsx'
import { KeyHint } from '../components/primitives.tsx'

/* -------------------------------------------------------------------------
   Data sources and licence
   ------------------------------------------------------------------------- */

export function AboutDialog() {
  const open = useUiStore((s) => s.aboutOpen)
  const setAbout = useUiStore((s) => s.setAbout)
  const setSettings = useUiStore((s) => s.setSettings)

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
          <h3 className="label mb-2">what this browser keeps</h3>
          <p className="text-[var(--color-muted)]">
            Nothing, unless you ask: a copy of the save you have open, if you
            choose to keep it, and any breeding paths you save. Both stay on
            this machine, and both are listed and deleted in{' '}
            <button
              type="button"
              className="text-[var(--color-signal)] underline"
              onClick={() => {
                setAbout(false)
                setSettings(true)
              }}
            >
              Settings
            </button>
            , along with the cached game data.
          </p>
        </section>

        <section>
          <h3 className="label mb-2">game data and art</h3>
          <p className="text-[var(--color-muted)]">
            Pal names, icons, item tables, breeding combinations, the world map
            and the levelling curve are Pocketpair&rsquo;s, and none of them are
            in this repository. They are fetched on demand from the{' '}
            <Link href="https://github.com/deafdudecomputers/PalworldSaveTools">
              PalworldSaveTools
            </Link>{' '}
            mirror (MIT) via jsDelivr and cached in IndexedDB, so a second visit
            needs no network at all. If that fetch fails the app runs in a
            degraded mode: raw asset ids and a coordinate grid, with every
            position still exact.
          </p>
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
  { keys: ['6'], what: 'Breed' },
  { keys: ['7'], what: 'Builds' },
  { keys: ['T'], what: 'Utility tray' },
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
            className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line-faint)] pb-1.5"
          >
            <dt className="text-sm">{s.what}</dt>
            <dd className="flex shrink-0 gap-1">
              {s.keys.map((k) => (
                <KeyHint key={k}>{k}</KeyHint>
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
