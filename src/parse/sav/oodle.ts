/**
 * Oodle Kraken decompression, via `ooz-wasm`.
 *
 * ## Why this is a separate, dynamically imported module
 *
 * `ooz-wasm` instantiates its WebAssembly module with a **top-level await** at
 * import time. Importing it eagerly would make every module that transitively
 * depends on it async, and would pay for the WASM instantiation on page load
 * for a format most users never drop. Isolating it here means the cost lands
 * only when a `PlM` save is actually opened.
 *
 * ## Licence
 *
 * `ooz-wasm` is GPL-3.0-or-later, which is why this project is too. See
 * SOURCES.md.
 */

/**
 * Decompresses a Kraken payload to exactly `rawSize` bytes.
 *
 * `rawSize` is not a hint — it comes from the container header, the decoder
 * writes exactly that many bytes, and `ooz-wasm` throws if the result differs.
 * That makes a truncated or corrupt payload a caught error rather than a
 * silently short buffer.
 *
 * The returned array is copied out of WASM memory: `decompressUnsafe` hands
 * back a view that the next call invalidates, and this data outlives that.
 */
export async function oodleDecompress(
  payload: Uint8Array,
  rawSize: number,
): Promise<Uint8Array> {
  const { decompress } = await import('ooz-wasm')
  return decompress(payload, rawSize)
}
