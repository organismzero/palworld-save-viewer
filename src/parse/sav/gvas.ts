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

/**
 * A Dimensional Pal Storage file writes all 9,600 of its slots, filled or not,
 * and an empty one is a whole record of defaults. Kept, they make a file
 * holding a few dozen pals into a third of a gigabyte of tree.
 */
const ELEMENT_FILTERS = {
  '.SaveParameterArray': (slot: any) => {
    const species: unknown = slot?.SaveParameter?.value?.CharacterID?.value
    return typeof species === 'string' && species !== '' && species !== 'None'
  },
}

export function readGvas(
  bytes: Uint8Array,
  /** Bytes read so far and bytes in all, a few dozen times over the read. */
  onProgress?: (offset: number, size: number) => void,
): GvasFile {
  const reader = new FArchiveReader(bytes, TYPE_HINTS, CUSTOM_PROPERTIES)
  reader.onProgress = onProgress
  reader.elementFilters = ELEMENT_FILTERS
  const header = readHeader(reader)
  const properties = reader.propertiesUntilEnd()
  return { header, properties, trailer: reader.readToEnd() }
}
