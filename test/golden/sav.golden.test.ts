/**
 * Container parsing against every real `.sav` in `data/`.
 *
 * Every file in the reference set — level, all ten players, and the 244 MB DPS
 * storage file — is `PlM` (Oodle). The zlib formats are still implemented,
 * still tested against synthetic containers in the unit suite, and still
 * unreachable for these files; this suite is what would notice if a game
 * version changed that.
 *
 * Self-skips without `data/`, so CI stays green.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isDecodable, readContainer } from '@/parse/sav/container.ts'
import { decodeSav } from '@/parse/sav/decode.ts'

const DATA = resolve(process.cwd(), 'data')
const hasData = existsSync(DATA)

function savFiles(): string[] {
  if (!hasData) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry.endsWith('.sav')) out.push(path)
    }
  }
  walk(DATA)
  return out
}

/** Measured from the reference save. */
const LEVEL = {
  format: 'PlM',
  type: 0x31,
  uncompressedLength: 13_793_869,
  compressedLength: 861_554,
  dataOffset: 12,
} as const

describe.skipIf(!hasData)('golden: real .sav containers', () => {
  const files = savFiles()

  it('finds saves to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('reads Level.sav’s header exactly', () => {
    const path = files.find((f) => f.endsWith('Level.sav'))
    if (!path) return
    // Only the first 24 bytes are needed, which is the point — the header is
    // readable without loading 861 KB, let alone decompressing it.
    const container = readContainer(readFileSync(path).subarray(0, 24))
    expect(container.format).toBe(LEVEL.format)
    expect(container.type).toBe(LEVEL.type)
    expect(container.uncompressedLength).toBe(LEVEL.uncompressedLength)
    expect(container.compressedLength).toBe(LEVEL.compressedLength)
    expect(container.dataOffset).toBe(LEVEL.dataOffset)
    expect(container.mismatched).toBe(false)
  })

  it.each(savFiles().map((f) => [f.replace(DATA + '/', ''), f]))(
    '%s parses as a container',
    (_name, path) => {
      const container = readContainer(readFileSync(path).subarray(0, 24))
      expect(['PlZ', 'PlM', 'CNK']).toContain(container.format)
      expect(container.mismatched).toBe(false)
      expect(container.uncompressedLength).toBeGreaterThan(0)
      // A save that claims to decompress to less than it occupies is a header
      // read at the wrong offset.
      expect(container.uncompressedLength).toBeGreaterThan(
        container.compressedLength,
      )
    },
  )

  it('confirms every save in this set is Oodle, including player saves', () => {
    const formats = new Set(
      files.map((f) => readContainer(readFileSync(f).subarray(0, 24)).format),
    )
    expect([...formats]).toEqual(['PlM'])
    // `isDecodable` covers the *browser-native* formats only. Oodle is handled,
    // but through `ooz-wasm` rather than `DecompressionStream`, which is why
    // it is false here and still decodes below.
    expect(isDecodable('PlM')).toBe(false)
  })

  it('decompresses the real Level.sav to exactly the promised size', async () => {
    const path = files.find((f) => f.endsWith('Level.sav'))
    if (!path) return
    const buf = readFileSync(path)
    const result = await decodeSav(
      buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer,
    )

    expect(result.ok, result.ok ? '' : result.message).toBe(true)
    if (!result.ok) return
    expect(result.container.format).toBe('PlM')
    // `Kraken_Decompress` is given the header's length and writes exactly that
    // many bytes, so this equality is the integrity check on the payload.
    expect(result.gvas.length).toBe(LEVEL.uncompressedLength)
    // And what comes out is a GVAS archive, not plausible-looking noise.
    expect(Array.from(result.gvas.subarray(0, 4))).toEqual([
      0x47, 0x56, 0x41, 0x53,
    ])
  })

  it('decompresses every player save too', async () => {
    for (const path of files.filter((f) => !f.endsWith('Level.sav'))) {
      const buf = readFileSync(path)
      const container = readContainer(buf.subarray(0, 24))
      const result = await decodeSav(
        buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer,
      )
      expect(result.ok, `${path}: ${result.ok ? '' : result.message}`).toBe(
        true,
      )
      if (!result.ok) continue
      expect(result.gvas.length).toBe(container.uncompressedLength)
    }
  }, 60_000)
})
