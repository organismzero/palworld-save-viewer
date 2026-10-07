/**
 * A decompressed GVAS archive → the tree every reader takes.
 *
 * The shape is PalworldSaveTools' JSON export, which this app once read
 * directly. The `.json` path is gone, but the shape stays: the readers, the
 * committed test fixtures and the property accessors in `parse/gvas.ts` are all
 * written against it.
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
