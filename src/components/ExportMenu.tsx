/**
 * The export control, in the two formats worth having.
 *
 * One component for all three placements so the filename convention and the
 * CSV/JSON equivalence are decided once. Both formats are built from the same
 * {@link Column} list, so a JSON export is exactly the CSV with its headers as
 * keys — there is no "richer" format that quietly carries different fields.
 *
 * Sized and styled as a pair of small bordered buttons rather than a dropdown:
 * a menu for two options costs a click and some state to save nothing.
 */

import {
  CSV_MIME,
  JSON_MIME,
  download,
  exportName,
  toCsv,
  type Column,
} from '../lib/export.ts'
import { useSaveStore } from '../store/saveStore.ts'
import { useUiStore } from '../store/uiStore.ts'
import { Button } from './controls.tsx'

export function ExportMenu<T>({
  rows,
  count,
  columns,
  kind,
  title,
}: {
  /**
   * The rows, or a function that builds them when a button is pressed.
   *
   * The function is for rows that cost something to make: resolving where
   * every stack in a base is, on each render of the view around this, to feed
   * two buttons that are almost never pressed.
   */
  rows: readonly T[] | (() => readonly T[])
  /**
   * With a function, how many rows it will build, for the tooltip and for
   * disabling the buttons when there are none. Left out, the buttons stay
   * enabled and say no number.
   */
  count?: number
  columns: readonly Column<T>[]
  /** Goes in the filename: `Level-pals-412.csv`. */
  kind: string
  /** Hover text, for saying *what* is being exported — filtered or all. */
  title?: string
}) {
  const fileName = useSaveStore((s) => s.fileName)
  const expected = typeof rows === 'function' ? count : rows.length
  const disabled = expected === 0

  const save = (ext: 'csv' | 'json') => {
    const built = typeof rows === 'function' ? rows() : rows
    // Only reachable through a `count` that was an overestimate.
    if (built.length === 0) {
      useUiStore.getState().notify('Nothing to export')
      return
    }
    const name = exportName(fileName, kind, built.length, ext)
    // The browser's own download shelf is easy to miss, and is hidden entirely
    // in some configurations.
    useUiStore.getState().notify(`Saved ${name}`)
    if (ext === 'csv') {
      download(name, toCsv(built, columns), CSV_MIME)
      return
    }
    // Same columns, so the two formats cannot drift apart.
    const objects = built.map((row) =>
      Object.fromEntries(columns.map((c) => [c.header, c.value(row) ?? null])),
    )
    download(name, JSON.stringify(objects, null, 2), JSON_MIME)
  }

  return (
    <span className="flex items-center gap-1" title={title}>
      <span className="label">export</span>
      {(['csv', 'json'] as const).map((ext) => (
        <Button
          key={ext}
          size="sm"
          disabled={disabled}
          onClick={() => save(ext)}
          title={
            disabled
              ? 'Nothing to export'
              : expected === undefined
                ? `Download as ${ext.toUpperCase()}`
                : `Download ${expected.toLocaleString()} rows as ${ext.toUpperCase()}`
          }
          className="uppercase"
        >
          {ext}
        </Button>
      ))}
    </span>
  )
}
