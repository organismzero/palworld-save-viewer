/**
 * Reads a raw `.sav` from disk into the GVAS tree the app's readers take.
 *
 * For Node-side tooling — the fixture generator, the benchmarks and the golden
 * tests — which all used to start from a converted `.json` and now start from
 * the same file a user drops.
 */

import { readFileSync } from 'node:fs'

import { decodeSav } from '../src/parse/sav/decode.ts'
import { readGvas } from '../src/parse/sav/gvas.ts'

export async function readSavFile(path: string): Promise<any> {
  const buf = readFileSync(path)
  const result = await decodeSav(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  )
  if (!result.ok) throw new Error(`${path}: ${result.message}`)
  return readGvas(result.gvas)
}

/**
 * `JSON.stringify` replacer for a GVAS tree.
 *
 * The binary reader keeps opaque byte runs as `Uint8Array`, which stringifies
 * as an object keyed by index — megabytes of it. They are written in the
 * converter's form instead, `{"~b": base64}`, which is what the committed
 * fixtures have always held and what the leak guard knows to skip. No reader
 * consumes these blobs, so the form only has to be compact and recognisable.
 */
export function gvasReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { '~b': Buffer.from(value).toString('base64') }
  }
  return value
}
