/**
 * The sample world shipped in `public/demo/`.
 *
 * Two things can go wrong with a generated file that is committed: it falls
 * behind what generates it, or it stops being something the app can open.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildSaveIndex } from '@/domain/index.ts'
import { SAMPLE_VERSION, readSample, sampleFrom } from '@/store/sampleData.ts'

const read = (path: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as unknown

const shipped = read('public/demo/sample.json')

describe('the sample world', () => {
  it('is what `pnpm sample` would write today', () => {
    // Through JSON, as the file is: `undefined` fields do not survive it.
    const fresh = JSON.parse(
      JSON.stringify(sampleFrom(read('test/fixtures/level.mini.json'))),
    ) as unknown
    expect(shipped).toEqual(fresh)
  })

  it('opens: it has pals, players and a base, and builds an index', () => {
    const payload = readSample(shipped)!
    expect(payload).toBeDefined()
    const index = buildSaveIndex(payload)
    expect(index.pals.length).toBeGreaterThan(0)
    expect(index.players.length).toBeGreaterThan(0)
    expect(index.bases.length).toBeGreaterThan(0)
  })

  it('refuses a file of another version, or one that is not a sample', () => {
    expect(readSample({ version: SAMPLE_VERSION + 1, payload: {} })).toBeUndefined() // prettier-ignore
    expect(readSample({ version: SAMPLE_VERSION })).toBeUndefined()
    expect(readSample(null)).toBeUndefined()
  })
})
