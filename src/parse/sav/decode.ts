/**
 * Decompressing a `.sav` down to its GVAS archive.
 *
 * ## What works, and what does not
 *
 * `PlZ` and `CNK` are zlib, which every browser can do natively through
 * `DecompressionStream`. `PlM` is Oodle Kraken, which none can — and **every
 * save in the reference set is `PlM`**, including the per-player files that
 * were the last hope of a partial win. So the realistic outcome of dropping a
 * modern save here is a precise refusal, and this module is built to produce
 * one: a structured result naming the format and its sizes, not a thrown
 * string.
 *
 * ## Why this file is dynamically imported
 *
 * Nothing here is needed unless a `.sav` is actually dropped. Keeping it out
 * of the entry chunk costs one `await import()` at the call site and keeps the
 * empty state small.
 */

import {
  NotASavError,
  isDecodable,
  readContainer,
  type SavContainer,
} from './container.ts'

export type DecodeResult =
  | { ok: true; container: SavContainer; gvas: Uint8Array }
  | {
      ok: false
      container?: SavContainer
      /** `oodle` — needs a decompressor we do not ship. `malformed` — the
       *  bytes disagree with the header. `not-a-sav` — not a container. */
      reason: 'unsupported' | 'malformed' | 'not-a-sav'
      message: string
    }

/**
 * The largest archive a header may claim.
 *
 * The biggest real file measured is a 244 MB dimensional-storage save, so this
 * is generous. It exists because both sizes in the header are a stranger's
 * word: Oodle's allocator is handed `uncompressedLength + 64` as a u32, and a
 * value near 2^32 wraps to a tiny buffer that the decoder then writes far past.
 */
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024

export async function decodeSav(buf: ArrayBuffer): Promise<DecodeResult> {
  const bytes = new Uint8Array(buf)

  let container: SavContainer
  try {
    container = readContainer(bytes)
  } catch (err) {
    return {
      ok: false,
      reason: 'not-a-sav',
      message: err instanceof NotASavError ? err.message : String(err),
    }
  }

  if (
    container.uncompressedLength > MAX_ARCHIVE_BYTES ||
    container.compressedLength > MAX_ARCHIVE_BYTES
  ) {
    return {
      ok: false,
      container,
      reason: 'malformed',
      message: `The header claims ${Math.max(container.uncompressedLength, container.compressedLength)} bytes, which is larger than any real save. The file is damaged, or is not a save.`,
    }
  }

  const payload = bytes.subarray(container.dataOffset)

  if (container.format === 'PlM') {
    try {
      // One whole-buffer call — Palworld does no per-block framing of its own,
      // so the container's `uncompressedLength` is the exact output size and
      // `Kraken_Decompress` verifies it for us.
      const { oodleDecompress } = await import('./oodle.ts')
      const gvas = await oodleDecompress(payload, container.uncompressedLength)
      return { ok: true, container, gvas }
    } catch (err) {
      return {
        ok: false,
        container,
        reason: 'malformed',
        message: `Oodle decompression failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }
    }
  }

  if (!isDecodable(container.format)) {
    return {
      ok: false,
      container,
      reason: 'unsupported',
      message: `Unsupported container format ${container.format}.`,
    }
  }

  try {
    // Keyed on the type byte, as the reference tool does, not on the magic: a
    // `PlZ` whose type is 0x31 was compressed once. For a twice-compressed file
    // `compressedLength` describes the *intermediate* result, which makes it a
    // free integrity check on the first pass.
    const twice = container.type === DOUBLE_ZLIB

    // Each pass is told how much it is expected to produce and stops as soon
    // as it has more than that, so a few hundred bytes cannot ask for gigabytes.
    const first = await inflate(
      payload,
      twice ? container.compressedLength : container.uncompressedLength,
    )
    let out = first.bytes

    if (twice) {
      if (first.overran || out.length !== container.compressedLength) {
        return {
          ok: false,
          container,
          reason: 'malformed',
          message: `Inner payload is ${sizeOf(first)} bytes, but the header says ${container.compressedLength}.`,
        }
      }
      const second = await inflate(out, container.uncompressedLength)
      if (second.overran) return tooLong(container, second)
      out = second.bytes
    } else if (first.overran) {
      return tooLong(container, first)
    }

    if (out.length !== container.uncompressedLength) {
      return {
        ok: false,
        container,
        reason: 'malformed',
        message: `Decompressed to ${out.length} bytes, but the header says ${container.uncompressedLength}.`,
      }
    }

    return { ok: true, container, gvas: out }
  } catch (err) {
    return {
      ok: false,
      container,
      reason: 'malformed',
      message: `Payload is not valid zlib: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }
}

/** The type byte of a save that was run through zlib twice. */
const DOUBLE_ZLIB = 0x32

interface Inflated {
  bytes: Uint8Array
  /** How much was produced before stopping; more than the limit if `overran`. */
  produced: number
  overran: boolean
}

const sizeOf = (r: Inflated) =>
  r.overran ? `more than ${r.produced - 1}` : String(r.produced)

function tooLong(container: SavContainer, r: Inflated): DecodeResult {
  return {
    ok: false,
    container,
    reason: 'malformed',
    message: `Decompressed to ${sizeOf(r)} bytes, but the header says ${container.uncompressedLength}.`,
  }
}

/**
 * zlib inflate via the platform, stopping once it has produced more than
 * `limit` bytes.
 *
 * `'deflate'` is the zlib wrapper of RFC 1950, which is what Python's
 * `zlib.compress` emits and therefore what these files contain.
 * `'deflate-raw'` is RFC 1951 and would fail on the two-byte header.
 *
 * Read a chunk at a time rather than buffered whole: zlib manages about a
 * thousand to one, and checking the length only afterwards means having
 * already allocated whatever the file asked for.
 */
export async function inflate(
  input: Uint8Array,
  limit: number,
): Promise<Inflated> {
  const reader = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader()

  const chunks: Uint8Array[] = []
  let produced = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    produced += value.length
    if (produced > limit) {
      await reader.cancel()
      return { bytes: new Uint8Array(0), produced, overran: true }
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(produced)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return { bytes, produced, overran: false }
}
