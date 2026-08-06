/**
 * Selectors behind the base and inventory explorer.
 *
 * The three interesting ones are all *decisions* rather than lookups — what a
 * base is called, how big a container is, and who owns it — so each is tested
 * against the shapes that make it non-obvious: a base whose nearest landmark
 * is not the first one in the list, a container with gaps in its slot indices,
 * and a container nothing claims.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  baseLabel,
  containerLocation,
  nearestLandmark,
  searchItems,
  slotGridSize,
  slotsByIndex,
  storageTotals,
} from '@/domain/bases.ts'
import { buildIndexes } from '@/parse/worker/buildIndexes.ts'
import { buildSaveIndex } from '@/domain/index.ts'
import type { Base, ItemStack, SaveIndex, Structure } from '@/domain/types.ts'
import type { Landmark } from '@/refdata/refdata.ts'

const FIXTURE = resolve(process.cwd(), 'test/fixtures/level.mini.json')

const LANDMARKS: Landmark[] = [
  { id: 'far', name: 'Far Away', x: 500_000, y: 500_000, z: 0 },
  { id: 'near', name: 'Small Settlement', x: 100, y: -200, z: 0 },
  { id: 'mid', name: 'Middling', x: 10_000, y: 10_000, z: 0 },
]

function baseAt(x: number, y: number): Base {
  return {
    baseId: 'b'.repeat(32),
    rawName: '新規生成拠点テンプレート名1(仮)',
    pos: { x, y, z: 0 },
    areaRange: 3500,
    workIds: [],
  }
}

function stack(slot: number, staticId = 'Wood', count = 1): ItemStack {
  return { slot, staticId, count }
}

describe('nearestLandmark', () => {
  it('picks the closest by squared distance, not list order', () => {
    expect(nearestLandmark(LANDMARKS, { x: 0, y: 0, z: 0 })?.id).toBe('near')
    expect(nearestLandmark(LANDMARKS, { x: 9_000, y: 9_000, z: 0 })?.id).toBe(
      'mid',
    )
  })

  it('returns nothing when reference data is unavailable', () => {
    expect(nearestLandmark(undefined, { x: 0, y: 0, z: 0 })).toBeUndefined()
    expect(nearestLandmark([], { x: 0, y: 0, z: 0 })).toBeUndefined()
  })
})

describe('baseLabel', () => {
  it('names a base by its nearest landmark, never by the save', () => {
    const label = baseLabel(baseAt(0, 0), 2, LANDMARKS)
    expect(label).toBe('Base 2 · near Small Settlement')
    // The raw name is a Japanese placeholder and must never reach the UI.
    expect(label).not.toContain('拠点')
  })

  it('degrades to the ordinal alone without reference data', () => {
    expect(baseLabel(baseAt(0, 0), 1, undefined)).toBe('Base 1')
  })
})

describe('slotGridSize', () => {
  it('sizes from the highest occupied index, not the stack count', () => {
    // Three items sitting at 0, 1 and 8 need nine slots' worth of grid, not
    // three — the gap between them is real and positional.
    expect(slotGridSize([stack(0), stack(1), stack(8)], 6)).toBe(18)
  })

  it('rounds up to a whole row and leaves one row of headroom', () => {
    expect(slotGridSize([stack(0)], 6)).toBe(12)
    expect(slotGridSize([stack(5)], 6)).toBe(12)
    expect(slotGridSize([stack(6)], 6)).toBe(18)
  })

  it('gives an empty container a single row', () => {
    expect(slotGridSize([], 6)).toBe(6)
  })
})

describe('slotsByIndex', () => {
  it('keys by the save’s own slot index so gaps survive', () => {
    const map = slotsByIndex([stack(0), stack(4)])
    expect(map.get(0)).toBeDefined()
    expect(map.get(1)).toBeUndefined()
    expect(map.get(4)).toBeDefined()
  })
})

describe('over the mini fixture', () => {
  let index: SaveIndex

  beforeAll(() => {
    const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    index = buildSaveIndex(buildIndexes(raw, { source: 'json' }))
  })

  const nameOfStructure = (s: Structure) => s.mapObjectId
  const nameOfBase = () => 'Base 1'

  it('totals storage across a set of containers', () => {
    const totals = storageTotals(
      index,
      index.containers.map((c) => c.containerId),
    )
    expect(totals.containers).toBe(index.containers.length)
    expect(totals.stacks).toBe(
      index.containers.reduce((n, c) => n + c.slots.length, 0),
    )
    expect(totals.items).toBeGreaterThanOrEqual(totals.stacks)
  })

  it('ignores container ids that are not in the save', () => {
    expect(storageTotals(index, ['0'.repeat(32)])).toEqual({
      containers: 0,
      stacks: 0,
      items: 0,
    })
  })

  it('names a chest by its structure and marks it exact', () => {
    const chest = index.containers.find((c) => c.ownerKind === 'structure')
    expect(chest).toBeDefined()
    const where = containerLocation(index, chest!, nameOfStructure, nameOfBase)
    expect(where.exact).toBe(true)
    expect(where.structure).toBeDefined()
    expect(where.label).toBe(where.structure!.mapObjectId)
  })

  it('says so plainly when nothing claims a container', () => {
    const orphan = index.containers.find((c) => c.ownerKind === 'unknown')
    expect(orphan).toBeDefined()
    const where = containerLocation(index, orphan!, nameOfStructure, nameOfBase)
    expect(where.exact).toBe(false)
    expect(where.label).toBe('Unattributed')
  })

  it('finds every stack of an item by name or by raw asset id', () => {
    const known = index.containers.flatMap((c) => c.slots)[0]
    expect(known).toBeDefined()

    const byId = searchItems(index, known!.staticId, (id) => id)
    expect(byId.some((h) => h.staticId === known!.staticId)).toBe(true)

    // The name comes from reference data, which the degraded state lacks —
    // searching must work against a display name too.
    const byName = searchItems(index, 'PRETTY', () => 'Pretty Name')
    expect(byName.length).toBeGreaterThan(0)
  })

  it('reports a total that matches the containers it points at', () => {
    for (const hit of searchItems(index, '', (id) => id)) {
      expect(hit.total).toBe(0) // an empty query finds nothing at all
    }

    const first = index.containers.flatMap((c) => c.slots)[0]!
    const [hit] = searchItems(index, first.staticId, (id) => id)
    expect(hit).toBeDefined()

    let summed = 0
    for (const place of hit!.places) {
      const container = index.containerById.get(place.containerId)
      expect(container).toBeDefined()
      summed += place.count
    }
    expect(summed).toBe(hit!.total)
  })

  it('returns nothing for an empty query', () => {
    expect(searchItems(index, '   ', (id) => id)).toEqual([])
  })
})
