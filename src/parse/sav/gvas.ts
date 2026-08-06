/**
 * A decompressed GVAS archive → the same tree `Level.json` parses to.
 *
 * The output is deliberately interchangeable with `JSON.parse(levelJson)`:
 * `buildIndexes` takes either without knowing which it got, which is what
 * makes the two paths verifiable against each other rather than merely
 * similar.
 */

import { FArchiveReader } from './farchive.ts'
import { readHeader, type GvasHeader } from './gvasHeader.ts'
import { CUSTOM_PROPERTIES } from './rawdata.ts'
import { TYPE_HINTS } from './typeHints.ts'

export interface GvasFile {
  header: GvasHeader
  properties: Record<string, unknown>
  /** Whatever follows the properties. Always four zero bytes in practice. */
  trailer: Uint8Array
}

export function readGvas(bytes: Uint8Array): GvasFile {
  const reader = new FArchiveReader(bytes, TYPE_HINTS, CUSTOM_PROPERTIES)
  const header = readHeader(reader)
  const properties = reader.propertiesUntilEnd()
  return { header, properties, trailer: reader.readToEnd() }
}
