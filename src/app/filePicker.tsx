/**
 * A file picker, for the five places that need one.
 *
 * Every surface that can add a file to the open save does the same three things:
 * keep a hidden `<input type="file">`, hold a ref to click it, and hand whatever
 * comes back to `acceptFiles`. That was written out four times before this
 * existed — twice on the landing screen, once for the map's fog affordance, once
 * for a player's missing inventory — and each copy had its own opinion about
 * `accept` and `multiple`.
 *
 * A picker rather than only a drop target, in all of those places, for one
 * reason: somebody who has got as far as wanting a specific file usually wants to
 * *find* it, and a folder full of 32-character filenames is not somewhere you
 * want to be dragging from.
 */

import { useRef, type ReactNode } from 'react'

import { useSaveStore } from '../store/saveStore.ts'

/** Everything this app can read, in the order a file dialog should offer it. */
export const SAVE_ACCEPT = '.sav,.json,application/json'

export interface FilePicker {
  /** Opens the file dialog. */
  open: () => void
  /** Render once, anywhere in the same tree. Hidden. */
  input: ReactNode
}

/**
 * Wires a hidden input to `acceptFiles`.
 *
 * The store decides what each file is by *content*, not by which control it
 * arrived through — a name check cannot tell a player save from a 244 MB DPS
 * storage file — so nothing here filters or routes. `directory` only widens what
 * the dialog will let you select.
 */
export function useFilePicker(
  options: { directory?: boolean; multiple?: boolean } = {},
): FilePicker {
  const { directory = false, multiple = true } = options
  const ref = useRef<HTMLInputElement>(null)
  const acceptFiles = useSaveStore((s) => s.acceptFiles)

  const input = (
    <input
      ref={ref}
      type="file"
      multiple={multiple}
      // Non-standard but supported everywhere this app targets; the File System
      // Access API is Chromium-only.
      {...(directory ? { webkitdirectory: '', directory: '' } : {})}
      accept={directory ? undefined : SAVE_ACCEPT}
      className="hidden"
      onChange={(e) => {
        const files = e.target.files
        if (files && files.length > 0) void acceptFiles(Array.from(files))
        // Cleared so picking the same file twice in a row still fires `change`
        // — which is exactly what someone does after a rejection.
        e.target.value = ''
      }}
    />
  )

  return { open: () => ref.current?.click(), input }
}
