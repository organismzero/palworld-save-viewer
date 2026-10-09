/**
 * One bad Oodle header must not break the decoder for the files after it.
 *
 * In a file of its own: handed to Oodle, such a header corrupts the WASM heap,
 * and every later decode in the same module instance fails with it. Vitest
 * gives each test file its own instance, which keeps a regression here away
 * from the rest of the suite.
 *
 * Self-skips without `data/`.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { decodeSav } from '@/parse/sav/decode.ts'
import { LEVEL_SAV, hasLevel } from './load.ts'

describe.skipIf(!hasLevel)('a save whose header lies about its size', () => {
  it('is refused, and the next save still decodes', async () => {
    const real = new Uint8Array(readFileSync(LEVEL_SAV))

    const bad = real.slice()
    // Close enough to 2^32 that `size + 64` wraps to a tiny allocation.
    new DataView(bad.buffer).setUint32(0, 0xffff_fff0, true)
    const refused = await decodeSav(bad.buffer)
    expect(refused.ok).toBe(false)

    const after = await decodeSav(real.slice().buffer)
    expect(after.ok).toBe(true)
  })
})
