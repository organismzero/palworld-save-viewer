/**
 * The pure half of session persistence.
 *
 * The IndexedDB wrappers are three lines each and testing them would mean
 * adding `fake-indexeddb` to exercise `idb` exercising a shim. What is worth
 * pinning is the part that decides *what* gets stored and whether it comes
 * back the same — which is plain functions over the committed fixture.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildIndexes } from '@/parse/worker/buildIndexes.ts'
import { buildSaveIndex, toSlim } from '@/domain/index.ts'
import type { SaveIndex, SlimPayload } from '@/domain/types.ts'

const FIXTURE = resolve(process.cwd(), 'test/fixtures/level.mini.json')

/** Every key `SlimPayload` declares. A snapshot must carry exactly these. */
const SLIM_KEYS = [
  'pals',
  'players',
  'guilds',
  'bases',
  'structures',
  'containers',
  'charContainers',
  'dynamicItems',
  'dungeons',
  'playerDetails',
  'stats',
  'meta',
] as const

describe('toSlim', () => {
  let payload: SlimPayload
  let index: SaveIndex

  beforeAll(() => {
    payload = buildIndexes(JSON.parse(readFileSync(FIXTURE, 'utf8')), {
      source: 'json',
    })
    index = buildSaveIndex(payload)
  })

  it('picks exactly the SlimPayload keys', () => {
    expect(Object.keys(toSlim(index)).sort()).toEqual([...SLIM_KEYS].sort())
  })

  it('carries no Maps', () => {
    // The whole point. `SaveIndex extends SlimPayload` and adds nineteen Map
    // fields of derived lookups; storing the index would clone every one of
    // them, and would silently pick up whatever gets added to SaveIndex next.
    for (const value of Object.values(toSlim(index))) {
      expect(value).not.toBeInstanceOf(Map)
    }
    expect(JSON.stringify(toSlim(index))).not.toContain('palById')
  })

  it('is the payload it was built from', () => {
    expect(toSlim(index)).toEqual(payload)
  })

  it('survives a structured clone, which is what IndexedDB does', () => {
    // If this throws, something un-cloneable has crept into the payload and
    // persistence would fail at runtime rather than here.
    expect(() => structuredClone(toSlim(index))).not.toThrow()
    expect(structuredClone(toSlim(index))).toEqual(payload)
  })

  /**
   * The round-trip that matters: a restored session must be indistinguishable
   * from a freshly parsed one. Same cross-check discipline as
   * `savPipeline.golden.test.ts`, at fixture scale so it runs in CI.
   */
  it('rebuilds an index equal to the direct path', () => {
    const restored = buildSaveIndex(structuredClone(toSlim(index)))

    for (const key of SLIM_KEYS) {
      expect(restored[key]).toEqual(index[key])
    }
    // And the derived lookups come back, not just the arrays.
    expect(restored.palById.size).toBe(index.palById.size)
    expect(restored.containersByItem.size).toBe(index.containersByItem.size)
    expect([...restored.palsByCharacterId.keys()].sort()).toEqual(
      [...index.palsByCharacterId.keys()].sort(),
    )
  })
})
