/**
 * The Bases view's audits: what a container holds as a table, what is damaged,
 * what is worn, and where an item stands on the map.
 *
 * Synthetic ids throughout.
 */

import { describe, expect, it } from 'vitest'

import { serialiseParams } from '@/app/viewParams.ts'
import {
  ailingWorkers,
  baseHealth,
  buildersOf,
  byFullness,
  containerContents,
  filterStructures,
  hpPercent,
  isDamaged,
  itemPlaces,
  wearFraction,
  wornItems,
} from '@/domain/bases.ts'
import { BASES_DEFAULTS, basesCodec, basesLink } from '@/views/bases/params.ts'
import {
  CONTAINER_COLUMNS,
  ITEM_HIT_COLUMNS,
  WORN_COLUMNS,
  containerRows,
  itemHitRows,
  wornRows,
} from '@/domain/exportRows.ts'
import type {
  Base,
  Container,
  DynamicItem,
  ItemStack,
  Pal,
  SaveIndex,
  Structure,
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
  ownerKind: 'structure',
  ownerId: id('7'),
  confidence: 'exact',
  slotCount: 7,
  usedSlots: 7,
}

const ANN = id('e')
const BOB = id('f')
const CAMP = id('b')

function structure(n: string, over: Partial<Structure> = {}): Structure {
  return {
    instanceId: id(n),
    mapObjectId: 'Thing',
    pos: { x: 0, y: 0, z: 0 },
    baseCampId: CAMP,
    locked: false,
    isBuilt: true,
    ...over,
  }
}

const small: Container = {
  containerId: id('c'),
  slots: [slot(0, 'Wood', 5)],
  ownerKind: 'structure',
  confidence: 'exact',
  slotCount: 1,
  usedSlots: 1,
}

const structures = [
  structure('5', { buildPlayerUid: ANN, hpCurrent: 40, hpMax: 80 }),
  structure('6', { buildPlayerUid: ANN, containerId: small.containerId, locked: true }), // prettier-ignore
  structure('7', { buildPlayerUid: BOB, containerId: chest.containerId, hpCurrent: 80, hpMax: 80 }), // prettier-ignore
  // Scenery inside the camp: nobody built it and it records no hit points.
  structure('8'),
]

const base = { baseId: CAMP, workerContainerId: id('d') } as Base
const workers = [{ sickness: 'Cold' }, {}, {}] as Pal[]

const index = {
  containers: [chest, small],
  containerById: new Map([chest, small].map((c) => [c.containerId, c])),
  dynamicItemById: new Map(dynamics.map((d) => [d.localId, d])),
  structures,
  structureById: new Map(structures.map((s) => [s.instanceId, s])),
  structuresByBase: new Map([[CAMP, structures]]),
  structureByContainer: new Map([
    [small.containerId, id('6')],
    [chest.containerId, id('7')],
  ]),
  baseById: new Map([[CAMP, base]]),
  bases: [base],
  palsByContainer: new Map([[id('d'), workers]]),
  playerByUid: new Map([[ANN, { name: 'Ann' }]]),
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

describe('damage', () => {
  it('needs both halves of the hit points to call a thing damaged', () => {
    expect(structures.map(isDamaged)).toEqual([true, false, false, false])
    expect(hpPercent(structures[0]!)).toBe(50)
    expect(hpPercent(structures[3]!)).toBeUndefined()
  })
})

describe('filterStructures', () => {
  const off = { storageOnly: false, builder: '', damaged: false, locked: false }
  const got = (over: Partial<typeof off>) =>
    filterStructures(structures, { ...off, ...over }).map(
      (s) => s.instanceId[0],
    )

  it('lets everything through with nothing on', () => {
    expect(got({})).toEqual(['5', '6', '7', '8'])
  })

  it('narrows by storage, builder, damage and lock, and by all at once', () => {
    expect(got({ storageOnly: true })).toEqual(['6', '7'])
    expect(got({ builder: ANN })).toEqual(['5', '6'])
    expect(got({ damaged: true })).toEqual(['5'])
    expect(got({ locked: true })).toEqual(['6'])
    expect(got({ builder: ANN, storageOnly: true, damaged: true })).toEqual([])
  })
})

describe('buildersOf', () => {
  it('counts per builder, most first, and keeps one the save cannot name', () => {
    expect(buildersOf(index, structures)).toEqual([
      { uid: ANN, name: 'Ann', count: 2 },
      { uid: BOB, name: undefined, count: 1 },
    ])
  })
})

describe('byFullness', () => {
  it('orders by stacks held, with what holds nothing last', () => {
    const order = byFullness(index, structures).map((s) => s.instanceId[0])
    expect(order.slice(0, 2)).toEqual(['7', '6'])
    expect(order.slice(2).sort()).toEqual(['5', '8'])
  })
})

describe('baseHealth', () => {
  it('counts what is damaged, locked and ailing against the totals', () => {
    expect(baseHealth(index, base)).toEqual({
      structures: 4,
      damaged: 1,
      locked: 1,
      workers: 3,
      workersAiling: 1,
    })
  })
})

describe('the structure list in a Bases link', () => {
  const codec = basesCodec(index)
  const source = { kind: 'base' as const, baseId: CAMP }

  it('writes nothing extra for an untouched list', () => {
    const out = codec.encode({ ...BASES_DEFAULTS, source }, BASES_DEFAULTS)
    expect(Object.keys(out)).toEqual(['src'])
  })

  it('round-trips the builder, both flags and the order', () => {
    const value = { ...BASES_DEFAULTS, source, builder: BOB, damaged: true, locked: true, sort: 'full' as const } // prettier-ignore
    const qs = serialiseParams(codec.encode(value, BASES_DEFAULTS))
    expect(codec.decode(new URLSearchParams(qs), BASES_DEFAULTS)).toEqual(value)
  })

  it('accepts a builder with no player record, and reports one nobody is', () => {
    expect(codec.missing!(new URLSearchParams('by=ffffffff'))).toEqual([])
    expect(codec.missing!(new URLSearchParams('by=99999999'))).toEqual(['a builder']) // prettier-ignore
    const got = codec.decode(new URLSearchParams('by=99999999&sort=nope'), BASES_DEFAULTS) // prettier-ignore
    expect(got).toMatchObject({ builder: '', sort: 'type' })
  })
})

describe('wornItems', () => {
  const fullOf = (staticId: string) =>
    data.items[staticId.toLowerCase()]?.durability

  it('lists what is at or under the threshold, worst first', () => {
    const got = wornItems(index, fullOf, 0.9)
    expect(got.map((w) => [w.staticId, w.fraction])).toEqual([
      ['Pickaxe', 0.25],
      ['Pickaxe', 0.9],
    ])
    expect(got[0]).toMatchObject({ containerId: chest.containerId, slot: 2, full: 200 }) // prettier-ignore
  })

  it('includes the threshold itself and nothing above it', () => {
    expect(wornItems(index, fullOf, 0.25)).toHaveLength(1)
    expect(wornItems(index, fullOf, 0.24)).toHaveLength(0)
    expect(wornItems(index, fullOf, 1)).toHaveLength(3)
  })

  it('calls nothing worn without a full durability to measure against', () => {
    expect(wornItems(index, () => undefined, 1)).toEqual([])
  })

  it('exports each with where it is', () => {
    const [row] = wornRows(index, data, wornItems(index, fullOf, 0.5))
    expect(row).toMatchObject({
      item: 'Pickaxe',
      durability: 50,
      durabilityFull: 200,
      percent: 25,
      where: 'Thing',
      exact: true,
    })
    expect(WORN_COLUMNS.map((c) => c.header)).toContain('percent')
  })
})

describe('the wear audit in a Bases link', () => {
  const codec = basesCodec(index)
  const read = (qs: string) => codec.decode(new URLSearchParams(qs), BASES_DEFAULTS) // prettier-ignore

  it('round-trips the source and a threshold that is not the default', () => {
    const value = { ...BASES_DEFAULTS, source: { kind: 'wear' as const }, wear: 60 } // prettier-ignore
    const out = codec.encode(value, BASES_DEFAULTS)
    expect(out).toMatchObject({ src: 'wear', wear: '60' })
    expect(read(serialiseParams(out))).toEqual(value)
  })

  it('leaves the default threshold out and clamps a silly one', () => {
    const out = codec.encode({ ...BASES_DEFAULTS, source: { kind: 'wear' } }, BASES_DEFAULTS) // prettier-ignore
    expect(out.wear).toBeUndefined()
    expect(read('src=wear&wear=900').wear).toBe(100)
    expect(read('src=wear&wear=x').wear).toBe(BASES_DEFAULTS.wear)
  })
})

describe('itemPlaces', () => {
  const carried: Container = {
    containerId: id('9'),
    slots: [slot(0, 'Wood', 3)],
    ownerKind: 'player',
    confidence: 'exact',
    slotCount: 1,
    usedSlots: 1,
  }
  const withItems = {
    ...index,
    containersByItem: new Map([
      [
        'Wood',
        [
          { containerId: chest.containerId, count: 100 },
          { containerId: small.containerId, count: 5 },
          { containerId: carried.containerId, count: 3 },
        ],
      ],
    ]),
  } as unknown as SaveIndex

  it('gives the containers that stand somewhere, with how much each holds', () => {
    const { places } = itemPlaces(withItems, 'Wood')
    expect(places.map((p) => [p.structure.instanceId[0], p.count])).toEqual([
      ['7', 100],
      ['6', 5],
    ])
  })

  it('counts what has no position instead of placing it', () => {
    expect(itemPlaces(withItems, 'Wood').unplaced).toBe(1)
    expect(itemPlaces(withItems, 'Nothing')).toEqual({
      places: [],
      unplaced: 0,
    })
  })
})

describe('what needs attention at a base', () => {
  it('names the workers with something wrong, and what', () => {
    const ailing = ailingWorkers(index, base)
    expect(ailing).toHaveLength(1)
    expect(ailing[0]!.pal).toBe(workers[0])
    expect(ailing[0]!.conditions.map((c) => c.id)).toEqual(['sick'])
  })

  it('links to the base with its list narrowed to what is damaged', () => {
    const qs = basesLink(index, {
      source: { kind: 'base', baseId: CAMP },
      damaged: true,
      storageOnly: false,
    })
    expect(qs).toBe('all=1&dmg=1&src=base:bbbbbbbb')
    const got = basesCodec(index).decode(new URLSearchParams(qs), BASES_DEFAULTS) // prettier-ignore
    expect(got).toMatchObject({
      damaged: true,
      storageOnly: false,
      builder: '',
    })
  })
})
