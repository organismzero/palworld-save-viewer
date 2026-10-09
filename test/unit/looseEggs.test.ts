/**
 * Eggs waiting on a Breeding Farm, and folding them into it.
 *
 * Invented structures in the shape the reader produces. Positions are in
 * centimetres, as the save has them.
 */

import { describe, expect, it } from 'vitest'

import { buildSaveIndex, toSlim } from '@/domain/index.ts'
import { EGG_REACH, looseEggsByFarm } from '@/domain/looseEggs.ts'
import type { Container, SlimPayload, Structure } from '@/domain/types.ts'

const BASE = 'b'.repeat(32)
const OTHER_BASE = 'c'.repeat(32)
const id = (n: number) => String(n).padStart(32, '0')

let n = 0
function structure(
  mapObjectId: string,
  x: number,
  over: Partial<Structure> = {},
): Structure {
  n++
  return {
    instanceId: id(n),
    mapObjectId,
    pos: { x, y: 0, z: 0 },
    baseCampId: BASE,
    containerId: id(1000 + n),
    locked: false,
    isBuilt: true,
    ...over,
  }
}
const farm = (x: number, over: Partial<Structure> = {}) =>
  structure('BreedFarm', x, {
    concreteModelType: 'PalMapObjectBreedFarmModel',
    ...over,
  })
const egg = (x: number, over: Partial<Structure> = {}) =>
  structure('PalEgg_Dark', x, {
    concreteModelType: 'PalMapObjectPalEggModel',
    ...over,
  })

function holding(s: Structure, ...items: string[]): Container {
  return {
    containerId: s.containerId!,
    ownerKind: 'structure',
    ownerId: s.instanceId,
    confidence: 'exact',
    slots: items.map((staticId, slot) => ({ slot, staticId, count: 1 })),
  } as Container
}

function world(structures: Structure[], containers: Container[]) {
  return {
    pals: [],
    players: [],
    guilds: [],
    bases: [],
    structures,
    containers,
    charContainers: [],
    dynamicItems: [],
    dungeons: [],
    playerDetails: [],
    stats: {},
    meta: {},
  } as unknown as SlimPayload
}

describe('looseEggsByFarm', () => {
  it('gives an egg to the nearest farm in its base', () => {
    const [near, far] = [farm(0), farm(1000)]
    const [a, b] = [egg(200), egg(900)]
    const got = looseEggsByFarm([near, far, a, b])
    expect(got.get(near.instanceId)).toEqual([a])
    expect(got.get(far.instanceId)).toEqual([b])
  })

  it('leaves alone an egg with no farm in reach', () => {
    expect(looseEggsByFarm([farm(0), egg(EGG_REACH + 1)]).size).toBe(0)
    expect(looseEggsByFarm([egg(0)]).size).toBe(0)
  })

  it('does not reach into another base, or out into the world', () => {
    const f = farm(0)
    expect(looseEggsByFarm([f, egg(10, { baseCampId: OTHER_BASE })]).size).toBe(0) // prettier-ignore
    expect(looseEggsByFarm([f, egg(10, { baseCampId: undefined })]).size).toBe(0) // prettier-ignore
  })

  it('knows an egg by its name where the save records no model', () => {
    // `PalEgg_MutationPal` comes through without one.
    const f = farm(0)
    const e = structure('PalEgg_MutationPal', 50)
    expect(looseEggsByFarm([f, e]).get(f.instanceId)).toEqual([e])
  })

  it('does not take an incubator for a farm, or its eggs for loose ones', () => {
    const incubator = structure('MultiHatchingPalEgg', 0, {
      concreteModelType: 'PalMapObjectMultiHatchingEggModel',
    })
    expect(looseEggsByFarm([incubator, egg(10)]).size).toBe(0)
    expect(looseEggsByFarm([farm(0), incubator]).size).toBe(0)
  })
})

describe('buildSaveIndex — eggs waiting on a farm', () => {
  const f = farm(0)
  const chest = structure('ItemChest', 5000)
  const [a, b] = [egg(100), egg(200)]
  const payload = world(
    [f, chest, a, b],
    [
      holding(f, 'Cake'),
      holding(chest, 'Wood'),
      holding(a, 'PalEgg_Dark_01'),
      holding(b, 'PalEgg_Dark_05'),
    ],
  )
  const index = buildSaveIndex(payload)

  it('lists the base without them', () => {
    expect(index.structuresByBase.get(BASE)).toEqual([f, chest])
    expect(index.looseEggFarm.get(a.instanceId)).toBe(f.instanceId)
  })

  it('shows them in the farm, after what the farm holds itself', () => {
    expect(index.containerById.get(f.containerId!)!.slots).toEqual([
      { slot: 0, staticId: 'Cake', count: 1 },
      { slot: 1, staticId: 'PalEgg_Dark_01', count: 1 },
      { slot: 2, staticId: 'PalEgg_Dark_05', count: 1 },
    ])
  })

  it('finds an egg at the farm, whichever way it is asked', () => {
    expect(index.containersByItem.get('PalEgg_Dark_01')).toEqual([
      { containerId: f.containerId, count: 1 },
    ])
    expect(index.structureByContainer.get(a.containerId!)).toBe(f.instanceId)
  })

  it('has each egg in one place, not two', () => {
    const stacks = payload.containers.reduce(
      (sum, c) => sum + index.containerById.get(c.containerId)!.slots.length,
      0,
    )
    expect(stacks).toBe(4)
  })

  it('leaves everything else exactly as it was', () => {
    expect(index.containerById.get(chest.containerId!)).toBe(
      payload.containers[1],
    )
    expect(index.containersByItem.get('Wood')).toEqual([
      { containerId: chest.containerId, count: 1 },
    ])
  })

  it('does not touch the payload, which is what the save says', () => {
    expect(toSlim(index).structures).toHaveLength(4)
    expect(payload.containers[0]!.slots).toHaveLength(1)
    expect(payload.containers[2]!.slots).toHaveLength(1)
  })
})
