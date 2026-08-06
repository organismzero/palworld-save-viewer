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
    // The outer pass. For `CNK` this is the whole job; `PlZ` is compressed
    // twice, and its `compressedLength` describes the *intermediate* result —
    // which makes it a free integrity check on the first pass.
    let out = await inflate(payload)

    if (container.format === 'PlZ') {
      if (out.length !== container.compressedLength) {
        return {
          ok: false,
          container,
          reason: 'malformed',
          message: `Inner payload is ${out.length} bytes, but the header says ${container.compressedLength}.`,
        }
      }
      out = await inflate(out)
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

/**
 * zlib inflate via the platform.
 *
 * `'deflate'` is the zlib wrapper of RFC 1950, which is what Python's
 * `zlib.compress` emits and therefore what these files contain.
 * `'deflate-raw'` is RFC 1951 and would fail on the two-byte header.
 */
async function inflate(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
