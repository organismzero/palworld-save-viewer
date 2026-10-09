/**
 * `.sav` container parsing and decompression.
 *
 * No real `.sav` is needed for most of this: the container format is small
 * enough to build by hand, which lets the zlib paths be tested properly even
 * though every save in the reference set is Oodle and exercises none of them.
 * The golden suite covers the real files.
 */

import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import {
  MIN_SAV_BYTES,
  NotASavError,
  isDecodable,
  readContainer,
} from '@/parse/sav/container.ts'
import { decodeSav, inflate } from '@/parse/sav/decode.ts'

/**
 * Builds a container by hand.
 *
 * `PlZ` is compressed twice and its `compressedLength` field describes the
 * intermediate result, which is the detail most likely to be got wrong — so
 * the helper reproduces it exactly rather than approximating.
 */
function buildSav(
  payload: Uint8Array,
  format: 'PlZ' | 'PlM' | 'CNK',
  { corruptInner = false } = {},
): ArrayBuffer {
  const types = { CNK: 0x30, PlM: 0x31, PlZ: 0x32 }

  let body: Uint8Array
  let compressedLength: number
  if (format === 'PlZ') {
    const once = deflateSync(payload)
    compressedLength = once.length
    body = new Uint8Array(deflateSync(once))
  } else if (format === 'CNK') {
    body = new Uint8Array(deflateSync(payload))
    compressedLength = body.length
  } else {
    body = payload // Oodle is never actually produced here.
    compressedLength = body.length
  }

  // A CNK carries an outer wrapper header and then the real one.
  const headerBytes = format === 'CNK' ? 24 : 12
  const out = new Uint8Array(headerBytes + body.length)
  const view = new DataView(out.buffer)

  const writeHeader = (at: number, magic: string) => {
    view.setUint32(at, corruptInner ? 999_999 : payload.length, true)
    view.setUint32(at + 4, compressedLength, true)
    for (let i = 0; i < 3; i++) out[at + 8 + i] = magic.charCodeAt(i)
    view.setUint8(at + 11, types[format])
  }

  if (format === 'CNK') {
    writeHeader(0, 'CNK')
    writeHeader(12, 'CNK')
  } else {
    writeHeader(0, format)
  }
  out.set(body, headerBytes)
  return out.buffer
}

const PAYLOAD = new TextEncoder().encode(
  'GVAS' + 'x'.repeat(4096) + 'end of archive',
)

describe('readContainer', () => {
  it('reads a PlZ header', () => {
    const c = readContainer(new Uint8Array(buildSav(PAYLOAD, 'PlZ')))
    expect(c.format).toBe('PlZ')
    expect(c.type).toBe(0x32)
    expect(c.dataOffset).toBe(12)
    expect(c.uncompressedLength).toBe(PAYLOAD.length)
    expect(c.mismatched).toBe(false)
  })

  it('follows a CNK file’s second header', () => {
    // The wrinkle: a CNK's real header sits *after* the wrapper, and the
    // payload starts at 24 rather than 12. Reading the outer one would give a
    // payload offset 12 bytes short and garbage lengths.
    const c = readContainer(new Uint8Array(buildSav(PAYLOAD, 'CNK')))
    expect(c.dataOffset).toBe(24)
    expect(c.uncompressedLength).toBe(PAYLOAD.length)
  })

  it('rejects a file with no container magic', () => {
    const bytes = new Uint8Array(64)
    expect(() => readContainer(bytes)).toThrow(NotASavError)
  })

  it('rejects a file too small to hold a header', () => {
    expect(() => readContainer(new Uint8Array(MIN_SAV_BYTES - 1))).toThrow(
      NotASavError,
    )
  })

  it('flags a header whose magic and type byte disagree', () => {
    // Not fatal — the magic is authoritative — but it is exactly the kind of
    // drift that should be visible rather than silently normalised.
    const buf = buildSav(PAYLOAD, 'PlZ')
    new DataView(buf).setUint8(11, 0x31)
    expect(readContainer(new Uint8Array(buf)).mismatched).toBe(true)
  })
})

describe('isDecodable', () => {
  it('admits zlib and refuses Oodle', () => {
    expect(isDecodable('PlZ')).toBe(true)
    expect(isDecodable('CNK')).toBe(true)
    expect(isDecodable('PlM')).toBe(false)
  })
})

describe('decodeSav', () => {
  it('decodes a double-zlib PlZ save back to the original bytes', async () => {
    const result = await decodeSav(buildSav(PAYLOAD, 'PlZ'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gvas).toEqual(PAYLOAD)
    expect(result.container.format).toBe('PlZ')
  })

  it('decodes a single-zlib CNK save', async () => {
    const result = await decodeSav(buildSav(PAYLOAD, 'CNK'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gvas).toEqual(PAYLOAD)
  })

  it('reports an Oodle payload that is not actually Oodle', async () => {
    // `buildSav` writes the payload uncompressed under a PlM header, so this
    // exercises the failure path of the real decompressor rather than a
    // pre-emptive refusal — Oodle itself is covered by the golden suite,
    // which has real Kraken data to feed it.
    const result = await decodeSav(buildSav(PAYLOAD, 'PlM'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
    expect(result.message).toMatch(/Oodle/)
    expect(result.container?.format).toBe('PlM')
    // The sizes are what make a message concrete, so they must survive.
    expect(result.container?.uncompressedLength).toBe(PAYLOAD.length)
  })

  it('catches a header that disagrees with the payload', async () => {
    const result = await decodeSav(
      buildSav(PAYLOAD, 'CNK', { corruptInner: true }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
    expect(result.message).toMatch(/header says 999999/)
  })

  it('reports a non-save without pretending to know more', async () => {
    const result = await decodeSav(new Uint8Array(64).buffer)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('not-a-sav')
  })

  it('reports a container whose payload is not zlib at all', async () => {
    const buf = buildSav(PAYLOAD, 'PlZ')
    new Uint8Array(buf).fill(0, 12, 20)
    const result = await decodeSav(buf)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
  })
})

describe('decodeSav — headers that are not what they seem', () => {
  it('inflates a PlZ once when its type byte says single zlib', async () => {
    // The reference implementation keys the second pass on the type byte
    // (0x32), not on the magic.
    const body = new Uint8Array(deflateSync(PAYLOAD))
    const out = new Uint8Array(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, PAYLOAD.length, true)
    view.setUint32(4, body.length, true)
    out.set([0x50, 0x6c, 0x5a, 0x31], 8) // 'PlZ', type 0x31
    out.set(body, 12)

    const result = await decodeSav(out.buffer)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gvas).toEqual(PAYLOAD)
  })

  it('refuses an absurd declared size before trying to decompress', async () => {
    // Handed to Oodle, `size + 64` wraps and corrupts the WASM heap for every
    // decode after it; see the golden suite for that half.
    const buf = buildSav(PAYLOAD, 'PlM')
    new DataView(buf).setUint32(0, 0xffff_fff0, true)
    const result = await decodeSav(buf)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
    expect(result.message).not.toMatch(/Oodle|out of bounds/i)
  })

  it('stops inflating once the output passes the declared length', async () => {
    // 64 MB of zeros is about 62 KB of zlib. Buffered whole and checked
    // afterwards, all 64 MB is allocated before the file is refused.
    const bomb = new Uint8Array(deflateSync(new Uint8Array(64 * 1024 * 1024)))
    const got = await inflate(bomb, 100)
    expect(got.overran).toBe(true)
    expect(got.bytes).toHaveLength(0)
    expect(got.produced).toBeLessThan(4 * 1024 * 1024)
  })

  it('refuses a save that inflates to more than its header says', async () => {
    const buf = buildSav(new Uint8Array(8 * 1024 * 1024), 'CNK')
    new DataView(buf).setUint32(12, 100, true)
    const result = await decodeSav(buf)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
    expect(result.message).toMatch(/header says 100/)
  })
})
