import { useState } from 'react'

import { useSaveStore } from '../store/saveStore.ts'
import { bytes, relativeTime } from '../lib/format.ts'
import {
  rememberPref,
  restoreSession,
  sessionDescriptor,
} from '../store/session.ts'
import { filesFromDrop } from './dropEntries.ts'
import { Button } from '../components/controls.tsx'
import { useFilePicker } from './filePicker.tsx'
import { ScreenTitle } from '../components/primitives.tsx'
import { cn } from '../lib/utils.ts'

/**
 * Full-window drop target. Also accepts a click, because a surprising number
 * of people never try dragging.
 */
export function DropZone() {
  const acceptFiles = useSaveStore((s) => s.acceptFiles)
  const error = useSaveStore((s) => s.error)
  const [dragging, setDragging] = useState(false)
  const files = useFilePicker()
  const folder = useFilePicker({ directory: true })

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void filesFromDrop(e.dataTransfer).then((dropped) => {
          if (dropped.length > 0) void acceptFiles(dropped)
        })
      }}
      className="flex min-h-dvh flex-col items-center justify-center gap-7 p-8"
    >
      <div className="text-center">
        <ScreenTitle>Palworld Save Viewer</ScreenTitle>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Everything is parsed in your browser. Your save never leaves this
          machine.
        </p>
      </div>

      <button
        type="button"
        onClick={files.open}
        className={cn(
          'corner-ticks relative isolate w-full max-w-xl border border-dashed px-8 py-14 transition-colors',
          dragging
            ? 'border-[var(--color-signal)] bg-[var(--color-signal)]/[0.06] [--tick-color:var(--color-signal)]'
            : 'border-[var(--color-line-strong)] hover:border-[var(--color-muted)]',
        )}
      >
        <div className="label">drop a save</div>
        <div className="mt-3 text-lg">
          Drop <span className="num">Level.sav</span> here
        </div>
        <div className="mt-1 text-sm text-[var(--color-muted)]">
          Raw saves and converted <span className="num">.json</span> both work.
          Add your <span className="num">Players</span> folder too for exact
          inventories, real positions and paldex progress
        </div>
      </button>

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <Button onClick={files.open}>Choose files</Button>
        <Button onClick={folder.open}>Choose a folder</Button>
        <ReopenButton />
      </div>

      {files.input}
      {folder.input}

      {error && (
        <p className="max-w-xl text-center text-sm text-[var(--color-el-fire)]">
          {error}
        </p>
      )}

      <details className="max-w-xl text-sm text-[var(--color-muted)]">
        <summary className="cursor-pointer">Where do I find my save?</summary>
        <div className="mt-3 space-y-2">
          <p>
            On Steam, saves live under{' '}
            <code className="num text-xs">
              %LOCALAPPDATA%\Pal\Saved\SaveGames\&lt;steamid&gt;\&lt;worldid&gt;\
            </code>
          </p>
          <p>
            Drop <span className="num">Level.sav</span> straight in — it is
            decompressed and read here, in your browser. A typical world is{' '}
            {bytes(861_000)} compressed and takes well under a second.
          </p>
          <p>
            JSON exported by{' '}
            <a
              className="text-[var(--color-signal)] underline"
              href="https://github.com/deafdudecomputers/PalworldSaveTools"
              target="_blank"
              rel="noreferrer noopener"
            >
              PalworldSaveTools
            </a>{' '}
            works too, and both produce identical results.
          </p>
        </div>
      </details>
    </div>
  )
}

/**
 * "Reopen Level.sav — 4 minutes ago", when there is something to reopen.
 *
 * Reads the descriptor from `localStorage` synchronously so this renders on the
 * first frame or not at all. Doing the IndexedDB read here instead would pop
 * the button in a frame late, on the landing screen, which is the worst place
 * in the app for a layout shift.
 *
 * The real read happens on click, and can legitimately come back empty — the
 * browser may have evicted the snapshot since. That is reported in place
 * rather than as a failure, because nothing has gone wrong.
 */
function ReopenButton() {
  const [descriptor, setDescriptor] = useState(() =>
    rememberPref() === 'on' ? sessionDescriptor() : undefined,
  )
  const [gone, setGone] = useState(false)

  if (gone) {
    return (
      <span className="text-xs text-[var(--color-muted)]">
        That saved session is no longer available.
      </span>
    )
  }
  if (!descriptor) return null

  return (
    <Button
      tone="signal"
      onClick={() => {
        void restoreSession().then((ok) => {
          if (ok) return
          setDescriptor(undefined)
          setGone(true)
        })
      }}
      title="Reopens the copy kept in this browser. Nothing is re-read from disk."
    >
      Reopen <span className="num">{descriptor.fileName}</span>
      <span className="text-xs text-[var(--color-muted)]">
        {relativeTime(new Date(descriptor.savedAt))}
      </span>
    </Button>
  )
}
