/**
 * Getting data back out — CSV and JSON, with no dependencies.
 *
 * The app reads a save and shows it; until now nothing came out the other end.
 * Spreadsheets are where people actually compare rosters and plan condensing,
 * so CSV is the format that matters and JSON is the escape hatch for anyone
 * scripting against it.
 *
 * Deliberately dependency-free: RFC 4180 is four rules, and a CSV library
 * would be a larger download than the whole of this module for the privilege
 * of getting those four rules right in a way we cannot test as directly.
 */

/**
 * A column: a header and a way to get one cell out of a row.
 *
 * `undefined` and `null` become the empty string rather than the text
 * `"undefined"`, which is the single most common way an exported sheet ends up
 * with a column of garbage.
 */
export interface Column<T> {
  header: string
  value: (row: T) => string | number | boolean | undefined | null
}

/** True when a value has to be quoted per RFC 4180 §2.6. */
function needsQuoting(s: string): boolean {
  return (
    s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
  )
}

function cell(raw: string | number | boolean | undefined | null): string {
  if (raw === undefined || raw === null) return ''
  const s = String(raw)
  // Embedded quotes are doubled, and only then is the whole field wrapped.
  return needsQuoting(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/**
 * Rows to RFC 4180 CSV.
 *
 * CRLF line endings, because that is what the spec says and what Excel expects
 * on Windows; every other reader accepts them. No BOM — it corrupts the header
 * of the first column in anything that does not special-case it, and the
 * content here is ASCII except for pal nicknames, which UTF-8 handles unaided
 * in every spreadsheet still shipping.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly Column<T>[]) {
  const lines = [columns.map((c) => cell(c.header)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(','))
  }
  return lines.join('\r\n')
}

/**
 * Hands a string to the browser as a file.
 *
 * The object URL is revoked on the next task rather than immediately: Safari
 * has historically cancelled the download if the URL dies in the same tick as
 * the click, and a single leaked blob URL for one frame costs nothing.
 */
export function download(filename: string, data: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  downloadUrl(filename, url)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** As {@link download}, for callers that already have a Blob — e.g. a PNG. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  downloadUrl(filename, url)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadUrl(filename: string, url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Firefox will not follow a click on an element outside the document.
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export const CSV_MIME = 'text/csv;charset=utf-8'
export const JSON_MIME = 'application/json'

/**
 * Builds an export filename from the loaded save's name.
 *
 * `Level.sav` + `pals` + 412 → `Level-pals-412.csv`. The count is in the name
 * because these land in a downloads folder alongside each other and "which one
 * was the filtered one" is otherwise unanswerable.
 */
export function exportName(
  saveFileName: string | undefined,
  kind: string,
  count: number,
  ext: string,
): string {
  const base = (saveFileName ?? 'save').replace(/\.[^.]+$/, '')
  return `${sanitise(base)}-${kind}-${count}.${ext}`
}

/** Strips what no filesystem will take, rather than trusting the save's name. */
function sanitise(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 64) || 'save'
}
