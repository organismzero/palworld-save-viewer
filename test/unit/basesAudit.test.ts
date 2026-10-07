/**
 * The Bases view's audits: what a container holds as a table, what is damaged,
 * what is worn, and where an item stands on the map.
 *
 * Synthetic ids throughout.
 */

import { describe, expect, it } from 'vitest'

import { containerContents, wearFraction } from '@/domain/bases.ts'
import {
  CONTAINER_COLUMNS,
  ITEM_HIT_COLUMNS,
  containerRows,
  itemHitRows,
} from '@/domain/exportRows.ts'
import type {
  Container,
  DynamicItem,
  ItemStack,
  SaveIndex,
} from '@/domain/types.ts'
import type { Refdata } from '@/refdata/refdata.ts'

const id = (c: string) => c.repeat(32)

const dynamics: DynamicItem[] = [
  { localId: id('1'), staticId: 'Pickaxe', durability: 50, passives: [] },
  { localId: id('2'), staticId: 'Pickaxe', durability: 180, passives: [] },
  { localId: id('3'), staticId: 'Rifle', durability: 300, ammo: 4, passives: [] }, // prettier-ignore
  // An egg: a dynamic item with nothing the table has a column for.
  { localId: id('4'), staticId: 'Egg', passives: [] },
]

function slot(n: number, staticId: string, count = 1, dyn?: string): ItemStack {
  return { slot: n, staticId, count, dynamicLocalId: dyn }
}

const chest: Container = {
  containerId: id('a'),
  slots: [
    slot(0, 'Wood', 40),
    slot(1, 'Wood', 60),
    slot(2, 'Pickaxe', 1, id('1')),
    slot(3, 'Pickaxe', 1, id('2')),
    slot(5, 'Rifle', 1, id('3')),
    slot(6, 'Egg', 1, id('4')),
    slot(7, 'Egg', 1, id('4')),
  ],
  ownerKind: 'unknown',
  confidence: 'inferred',
  slotCount: 7,
  usedSlots: 7,
}

const index = {
  containers: [chest],
  containerById: new Map([[chest.containerId, chest]]),
  dynamicItemById: new Map(dynamics.map((d) => [d.localId, d])),
  structureById: new Map(),
  structureByContainer: new Map(),
  baseById: new Map(),
  bases: [],
  playerByUid: new Map(),
  guildById: new Map(),
} as unknown as SaveIndex

const data = {
  items: {
    wood: { name: 'Wood' },
    pickaxe: { name: 'Pickaxe', durability: 200 },
    rifle: { name: 'Rifle', durability: 300, magazine: 5 },
  },
  structures: {},
} as unknown as Refdata

describe('containerContents', () => {
  const rows = containerContents(index, chest)

  it('merges stacks of a plain item', () => {
    expect(rows[0]).toEqual({ staticId: 'Wood', count: 100 })
  })

  it('keeps a stack with a state of its own apart', () => {
    const picks = rows.filter((r) => r.staticId === 'Pickaxe')
    expect(picks.map((r) => r.dynamic?.durability)).toEqual([50, 180])
  })

  it('merges a dynamic item that has nothing to tell apart', () => {
    expect(rows.filter((r) => r.staticId === 'Egg')).toEqual([
      { staticId: 'Egg', count: 2 },
    ])
  })
})

describe('wearFraction', () => {
  it('is the share of full durability left, clamped', () => {
    expect(wearFraction(dynamics[0], 200)).toBe(0.25)
    expect(wearFraction(dynamics[2], 200)).toBe(1)
  })

  it('is nothing without a denominator, or without wear', () => {
    expect(wearFraction(dynamics[0], undefined)).toBeUndefined()
    expect(wearFraction(dynamics[3], 200)).toBeUndefined()
    expect(wearFraction(undefined, 200)).toBeUndefined()
  })
})

describe('the storage export', () => {
  const headers = CONTAINER_COLUMNS.map((c) => c.header)

  it('carries durability and ammo with what they are read against', () => {
    expect(headers).toEqual(
      expect.arrayContaining(['durability', 'durability_full', 'ammo', 'magazine']), // prettier-ignore
    )
    const rifle = containerRows(index, data, [chest]).find((r) => r.itemId === 'Rifle') // prettier-ignore
    expect(rifle).toMatchObject({ durability: 300, durabilityFull: 300, ammo: 4, magazine: 5 }) // prettier-ignore
  })

  it('leaves them empty for an item that has neither', () => {
    const wood = containerRows(index, data, [chest])[0]!
    expect(wood.durability).toBeUndefined()
    expect(wood.ammo).toBeUndefined()
  })

  it('still gives the durability when reference data is missing', () => {
    const pick = containerRows(index, undefined, [chest]).find((r) => r.itemId === 'Pickaxe') // prettier-ignore
    expect(pick).toMatchObject({ durability: 50, durabilityFull: undefined })
  })
})

describe('the item search export', () => {
  it('gives the most worn of an item in each place', () => {
    expect(ITEM_HIT_COLUMNS.map((c) => c.header)).toContain('durability_lowest')
    const [row] = itemHitRows(index, data, [
      {
        staticId: 'Pickaxe',
        name: 'Pickaxe',
        total: 2,
        places: [{ containerId: chest.containerId, count: 2 }],
      },
    ])
    expect(row).toMatchObject({ durabilityLowest: 50, durabilityFull: 200 })
  })
})
