import { useRef, useState } from 'react'

import { useSaveStore } from '../store/saveStore.ts'
import { bytes } from '../lib/format.ts'
import { filesFromDrop } from './dropEntries.ts'

/**
 * Full-window drop target. Also accepts a click, because a surprising number
 * of people never try dragging.
 */
export function DropZone() {
  const acceptFiles = useSaveStore((s) => s.acceptFiles)
  const error = useSaveStore((s) => s.error)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  // Classification happens in the store, by file *content* — a name check
  // cannot tell a player save from a 244 MB DPS-storage file.
  const accept = (files: FileList | File[] | null) => {
    if (!files) return
    void acceptFiles(Array.from(files))
  }

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
        void filesFromDrop(e.dataTransfer).then(accept)
      }}
      className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8"
    >
      <div className="text-center">
        <h1 className="font-display text-4xl tracking-tight">
          Palworld Save Viewer
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Everything is parsed in your browser. Your save never leaves this
          machine.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`raised-edge w-full max-w-xl rounded-[10px] border border-dashed px-8 py-14 transition-colors ${
          dragging
            ? 'border-[var(--color-signal)] bg-[var(--color-surface)]'
            : 'border-[var(--color-line)] hover:border-[var(--color-muted)]'
        }`}
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

      <div className="flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-[6px] border border-[var(--color-line)] px-3 py-1.5 hover:border-[var(--color-signal)]"
        >
          Choose files
        </button>
        <button
          type="button"
          onClick={() => folderRef.current?.click()}
          className="rounded-[6px] border border-[var(--color-line)] px-3 py-1.5 hover:border-[var(--color-signal)]"
        >
          Choose a folder
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".sav,.json,application/json"
        className="hidden"
        onChange={(e) => accept(e.target.files)}
      />
      <input
        ref={folderRef}
        type="file"
        // Non-standard but supported everywhere this app targets; the
        // File System Access API is Chromium-only.
        {...{ webkitdirectory: '', directory: '' }}
        className="hidden"
        onChange={(e) => accept(e.target.files)}
      />

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
