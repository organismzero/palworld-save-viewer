/**
 * The name resolvers, and the exports that used to bypass them.
 *
 * Synthetic ids throughout. What is being pinned is that a file saved from a
 * screen names things the way the screen did, and that all of it still works
 * with no reference data at all.
 */

import { describe, expect, it } from 'vitest'

import { containerRows, itemHitRows } from '@/domain/exportRows.ts'
import {
  baseNames,
  itemName,
  skillName,
  speciesName,
  structureName,
} from '@/domain/names.ts'
import type { SaveIndex } from '@/domain/types.ts'
import type { Refdata } from '@/refdata/refdata.ts'

const BASE = 'base0000'
const CHEST = 'struct00'
const BOX = 'cont0000'

const refdata = {
  species: { testpal: { name: 'Test Pal' } },
  items: { testore: { name: 'Test Ore' } },
  structures: { testchest: { name: 'Test Chest' } },
  skills: { testbeam: { name: 'Test Beam' } },
  landmarks: [{ name: 'Test Landing', x: 0, y: 0, type: 'fast_travel' }],
} as unknown as Refdata

const base = { baseId: BASE, pos: { x: 0, y: 0, z: 0 } }
const structure = {
  instanceId: CHEST,
  mapObjectId: 'TestChest',
  baseCampId: BASE,
  containerId: BOX,
}
const container = {
  containerId: BOX,
  ownerKind: 'structure',
  ownerId: CHEST,
  confidence: 'exact',
  slots: [{ slot: 0, staticId: 'TestOre', count: 12 }],
}

const index = {
  bases: [base],
  baseById: new Map([[BASE, base]]),
  structureById: new Map([[CHEST, structure]]),
  containerById: new Map([[BOX, container]]),
} as unknown as SaveIndex

describe('name resolvers', () => {
  it('look up by lowercased id, whatever case the save used', () => {
    expect(speciesName(refdata, 'TestPal')).toBe('Test Pal')
    expect(itemName(refdata, 'TestOre')).toBe('Test Ore')
    expect(structureName(refdata, { mapObjectId: 'TestChest' })).toBe(
      'Test Chest',
    )
    expect(skillName(refdata, 'TestBeam')).toBe('Test Beam')
  })

  it('fall back to the raw id with no reference data, or no entry', () => {
    expect(speciesName(undefined, 'TestPal')).toBe('TestPal')
    expect(itemName(refdata, 'Unknown')).toBe('Unknown')
    expect(structureName(undefined, { mapObjectId: 'TestChest' })).toBe(
      'TestChest',
    )
    expect(skillName(undefined, 'TestBeam')).toBe('TestBeam')
  })

  it('label a base by its place in the save and what it is near', () => {
    expect(baseNames(index, undefined).get(BASE)).toBe('Base 1')
    expect(baseNames(index, refdata).get(BASE)).toMatch(/^Base 1 · near /)
  })
})

describe('export rows', () => {
  it('name the structure and the base as the Bases view does', () => {
    const [row] = containerRows(index, refdata, [container as never])
    expect(row?.where).toBe('Test Chest')
    expect(row?.detail).toMatch(/^Base 1 · near /)
    expect(row?.item).toBe('Test Ore')
  })

  it('still name both with no reference data', () => {
    const [row] = containerRows(index, undefined, [container as never])
    expect(row?.where).toBe('TestChest')
    expect(row?.detail).toBe('Base 1')
  })

  it('do the same for item search hits', () => {
    const hits = [
      {
        staticId: 'TestOre',
        name: 'Test Ore',
        total: 12,
        places: [{ containerId: BOX, count: 12 }],
      },
    ]
    const [row] = itemHitRows(index, refdata, hits as never)
    expect(row?.where).toBe('Test Chest')
    expect(row?.detail).toMatch(/^Base 1 · near /)
  })
})
