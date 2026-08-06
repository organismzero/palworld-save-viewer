/**
 * The `.sav` container header.
 *
 * Every Palworld save is a small header followed by a compressed payload:
 *
 * ```
 * u32  uncompressedLength   // size of the GVAS archive once fully decoded
 * u32  compressedLength     // size of the payload after the *outer* pass
 * char magic[3]             // "PlZ" | "PlM" | "CNK"
 * u8   type                 // 0x32 PLZ | 0x31 PLM | 0x30 CNK
 * ...  payload
 * ```
 *
 * With one wrinkle that a one-line summary of the format will get wrong: a
 * `CNK` file carries a **second header** immediately after the first, and it
 * is the inner one that describes the payload. Ported from PalworldSaveTools
 * `src/palsav/palsav/compressor/__init__.py::_parse_sav_header`.
 *
 * This module is deliberately free of any decompression: reading the header is
 * cheap, synchronous and always possible, which is what lets the app say
 * exactly what a file is even when it cannot decode it.
 */

export type SavFormat = 'PlZ' | 'PlM' | 'CNK'

export interface SavContainer {
  format: SavFormat
  /** Length of the GVAS archive once fully decompressed. */
  uncompressedLength: number
  /** Length after the outer decompression pass — a checksum, not the payload size. */
  compressedLength: number
  /** The `type` byte. Normally agrees with the magic; kept separately because
   *  a disagreement is exactly the kind of drift worth seeing. */
  type: number
  /** Where the compressed payload starts. 12 normally, 24 for `CNK`. */
  dataOffset: number
  /** True when the magic and the type byte disagree about the format. */
  mismatched: boolean
}

const MAGIC_BY_TYPE: Record<number, SavFormat> = {
  0x30: 'CNK',
  0x31: 'PlM',
  0x32: 'PlZ',
}

/** Smallest file that could contain a header — a CNK needs two of them. */
export const MIN_SAV_BYTES = 24

export class NotASavError extends Error {}

/**
 * Reads the header. Throws {@link NotASavError} for anything that is not a
 * Palworld container, which is a normal outcome rather than a bug: users drop
 * all sorts of things.
 */
export function readContainer(bytes: Uint8Array): SavContainer {
  if (bytes.length < MIN_SAV_BYTES) {
    throw new NotASavError(
      `Too small to be a Palworld save (${bytes.length} bytes).`,
    )
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let uncompressedLength = view.getUint32(0, true)
  let compressedLength = view.getUint32(4, true)
  let magic = magicAt(bytes, 8)
  let type = view.getUint8(11)
  let dataOffset = 12

  // A chunked save's outer header is a wrapper; the real one follows it.
  if (magic === 'CNK') {
    uncompressedLength = view.getUint32(12, true)
    compressedLength = view.getUint32(16, true)
    magic = magicAt(bytes, 20)
    type = view.getUint8(23)
    dataOffset = 24
  }

  if (!magic) {
    throw new NotASavError(
      'No Palworld container magic — expected PlZ, PlM or CNK at offset 8.',
    )
  }

  return {
    format: magic,
    uncompressedLength,
    compressedLength,
    type,
    dataOffset,
    mismatched: MAGIC_BY_TYPE[type] !== magic,
  }
}

function magicAt(bytes: Uint8Array, offset: number): SavFormat | undefined {
  const magic = String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
  )
  return magic === 'PlZ' || magic === 'PlM' || magic === 'CNK'
    ? magic
    : undefined
}

/** Reads the header from just the first bytes of a file, without loading it. */
export async function readContainerOf(file: Blob): Promise<SavContainer> {
  const head = new Uint8Array(await file.slice(0, MIN_SAV_BYTES).arrayBuffer())
  return readContainer(head)
}

/**
 * Whether this project can decode a container of this format.
 *
 * `PlM` is Oodle Kraken, which has no browser-native decompressor and no
 * clean-licensed WebAssembly build this project is willing to vendor. Every
 * save in the reference set — level, player, and DPS storage — is `PlM`, so
 * this is the common case rather than an edge one, and the app is built to say
 * so clearly rather than to fail vaguely.
 */
export function isDecodable(format: SavFormat): boolean {
  return format === 'PlZ' || format === 'CNK'
}
