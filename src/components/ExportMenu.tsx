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
import { Button } from './controls.tsx'

export function ExportMenu<T>({
  rows,
  columns,
  kind,
  title,
}: {
  rows: readonly T[]
  columns: readonly Column<T>[]
  /** Goes in the filename: `Level-pals-412.csv`. */
  kind: string
  /** Hover text, for saying *what* is being exported — filtered or all. */
  title?: string
}) {
  const fileName = useSaveStore((s) => s.fileName)
  const disabled = rows.length === 0

  const save = (ext: 'csv' | 'json') => {
    const name = exportName(fileName, kind, rows.length, ext)
    if (ext === 'csv') {
      download(name, toCsv(rows, columns), CSV_MIME)
      return
    }
    // Same columns, so the two formats cannot drift apart.
    const objects = rows.map((row) =>
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
              : `Download ${rows.length.toLocaleString()} rows as ${ext.toUpperCase()}`
          }
          className="uppercase"
        >
          {ext}
        </Button>
      ))}
    </span>
  )
}
