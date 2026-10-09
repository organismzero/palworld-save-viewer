/**
 * Extracts files from a drag-and-drop, including whole directories.
 *
 * Dragging a `Players/` folder yields a *directory entry*, not files, so
 * `dataTransfer.files` alone silently drops everything in it. The recursive
 * walk below is what makes "drag your save folder in" actually work.
 *
 * Uses `webkitGetAsEntry` rather than the File System Access API: despite the
 * prefix it is supported in Chrome, Firefox and Safari, whereas
 * `showDirectoryPicker` is Chromium-only — and "works in your browser" is this
 * project's entire premise.
 */

import { notePath } from '../parse/sniff.ts'

/**
 * Guards against someone dropping a whole SaveGames tree.
 *
 * 256 rather than the 64 this used to be: a busy dedicated server's `Players/`
 * folder holds a save per player who ever joined, and 64 was fewer than some
 * real ones — which were then read partly, and silently.
 */
const MAX_DEPTH = 3
export const MAX_FILES = 256

/** Whether a drag is carrying files rather than, say, a text selection. */
export function carriesFiles(dt: DataTransfer | null): boolean {
  return dt ? Array.from(dt.types).includes('Files') : false
}

export interface Dropped {
  files: File[]
  /** The cap was reached, so there may be files that were not read. */
  truncated: boolean
}

/** What to say when a drop was cut short. One wording, both drop targets. */
export const TRUNCATED_NOTICE = `Stopped after ${MAX_FILES} files, so some of what was dropped was not read. Drop the rest separately.`

interface FileSystemEntryLike {
  /** From the root of the drop, with a leading slash. */
  fullPath?: string
  isFile: boolean
  isDirectory: boolean
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void
  createReader?: () => {
    readEntries: (
      cb: (entries: FileSystemEntryLike[]) => void,
      err: (e: unknown) => void,
    ) => void
  }
}

function entryFile(entry: FileSystemEntryLike): Promise<File | undefined> {
  return new Promise((resolve) => {
    if (!entry.file) return resolve(undefined)
    entry.file(
      (f) => resolve(f),
      () => resolve(undefined),
    )
  })
}

/** `readEntries` returns at most ~100 per call and must be drained. */
function readAll(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader?.()
  if (!reader) return Promise.resolve([])

  return new Promise((resolve) => {
    const all: FileSystemEntryLike[] = []
    const next = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) return resolve(all)
          all.push(...batch)
          next()
        },
        () => resolve(all),
      )
    }
    next()
  })
}

/** Returns true when it stopped because the cap was reached. */
async function walk(
  entry: FileSystemEntryLike,
  out: File[],
  depth: number,
): Promise<boolean> {
  if (out.length >= MAX_FILES) return true

  if (entry.isFile) {
    const file = await entryFile(entry)
    if (file) {
      // Where it sat, which is how a live save is told from its own backups.
      if (entry.fullPath) notePath(file, entry.fullPath)
      out.push(file)
    }
    return false
  }

  if (entry.isDirectory && depth < MAX_DEPTH) {
    for (const child of await readAll(entry)) {
      if (await walk(child, out, depth + 1)) return true
    }
  }
  return false
}

/**
 * Collects every file from a drop, expanding directories. Falls back to
 * `dataTransfer.files` where the entry API is unavailable.
 *
 * Says when it stopped short. The cap used to be applied without a word, and a
 * folder read partly looks exactly like a folder read whole.
 */
export async function filesFromDrop(dt: DataTransfer): Promise<Dropped> {
  const entries: FileSystemEntryLike[] = []
  for (const item of Array.from(dt.items ?? [])) {
    const entry = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null
      }
    ).webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  if (entries.length === 0) {
    const all = Array.from(dt.files ?? [])
    return {
      files: all.slice(0, MAX_FILES),
      truncated: all.length > MAX_FILES,
    }
  }

  const files: File[] = []
  let truncated = false
  for (const entry of entries) {
    if (await walk(entry, files, 0)) {
      truncated = true
      break
    }
  }
  return { files, truncated }
}
