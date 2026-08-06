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

/** Guards against someone dropping a whole SaveGames tree. */
const MAX_DEPTH = 3
const MAX_FILES = 64

interface FileSystemEntryLike {
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

async function walk(
  entry: FileSystemEntryLike,
  out: File[],
  depth: number,
): Promise<void> {
  if (out.length >= MAX_FILES) return

  if (entry.isFile) {
    const file = await entryFile(entry)
    if (file) out.push(file)
    return
  }

  if (entry.isDirectory && depth < MAX_DEPTH) {
    for (const child of await readAll(entry)) {
      if (out.length >= MAX_FILES) return
      await walk(child, out, depth + 1)
    }
  }
}

/**
 * Collects every file from a drop, expanding directories. Falls back to
 * `dataTransfer.files` where the entry API is unavailable.
 */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntryLike[] = []
  for (const item of Array.from(dt.items ?? [])) {
    const entry = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null
      }
    ).webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  if (entries.length === 0)
    return Array.from(dt.files ?? []).slice(0, MAX_FILES)

  const out: File[] = []
  for (const entry of entries) await walk(entry, out, 0)
  return out
}
