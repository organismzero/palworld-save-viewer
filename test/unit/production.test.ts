/**
 * The production purposes: fishing and salvaging, food, cake and ranch.
 *
 * They rank by partner-skill effects and ranch drops rather than by passives,
 * so the fixture is species carrying those, shaped like reference data.
 */

import { describe, expect, it } from 'vitest'

import {
  PARTNER_WANTS,
  bestPartners,
  ownedPartners,
  ownedProducers,
  ranchDropItems,
  ranchProducers,
  sidesFor,
  type GoalInput,
  type Where,
} from '@/domain/recommend.ts'
import type { Pal } from '@/domain/types.ts'
import type {
  ItemInfo,
  PassiveEffect,
  Refdata,
  SpeciesInfo,
} from '@/refdata/refdata.ts'

const fx = (
  type: string,
  value: number,
  target: PassiveEffect['target'] = 'trainer',
): PassiveEffect => ({ type, value, target })

const species = (extra: Partial<SpeciesInfo>): SpeciesInfo => ({
  name: 'x',
  zukan: 1,
  ...extra,
})

const item = (name: string, food = false): ItemInfo => ({
  name,
  rarity: 0,
  typeA: '',
  typeB: '',
  weight: 0,
  maxStack: 1,
  ...(food && { food: true as const }),
})

const DATA = {
  species: {
    jelly: species({
      partnerEffects: [
        fx('Fishing_ItemAddDrop', 55),
        fx('Fishing_EnemyAddDrop', 55),
        fx('CraftSpeed', 50, 'self'),
      ],
    }),
    whale: species({
      partnerEffects: [
        fx('Fishing_StartProgressAdd', 5),
        fx('Fishing_SuccessAmountUp', 5),
      ],
    }),
    octo: species({ partnerEffects: [fx('Fishing_FailedAmountDown', 12)] }),
    salvager: species({
      partnerEffects: [fx('FishingSalvage_ItemDrop', 55)],
    }),
    // Right type, wrong target: a fishing bonus that lands on the pal itself
    // is not a party bonus, and must not be offered as one.
    selfish: species({
      partnerEffects: [fx('Fishing_ItemAddDrop', 99, 'self')],
    }),
    sheep: species({
      work: { MonsterFarm: 1 },
      stats: {
        hp: 1,
        attack: 1,
        melee: 1,
        defense: 1,
        craftSpeed: 100,
        food: 2,
        runSpeed: 1,
        rideSpeed: 1,
      },
      ranchDrops: ['sweet', 'wool'],
      partnerEffects: [fx('FullStomatch_Decrease', -10, 'base')],
    }),
    cow: species({ work: { MonsterFarm: 2 }, ranchDrops: ['milk'] }),
    // Drops milk too, but is not in the pool — a quest variant.
    questcow: species({ work: { MonsterFarm: 3 }, ranchDrops: ['milk'] }),
  },
  items: {
    milk: item('Milk', true),
    sweet: item('Cotton Candy', true),
    wool: item('Wool'),
  },
  passives: {},
} as unknown as Refdata

const POOL = ['jelly', 'whale', 'octo', 'salvager', 'selfish', 'sheep', 'cow']

const INPUT: GoalInput = { work: [], opponentElements: [], attackElements: [] }

let n = 0
function pal(characterId: string, overrides: Partial<Pal> = {}): Pal {
  n++
  return {
    instanceId: `${n}`.padStart(32, '0'),
    characterId,
    isBoss: false,
    isRare: false,
    level: 10,
    exp: 0,
    rank: 0,
    rankAttack: 0,
    rankDefence: 0,
    rankHp: 0,
    rankCraftSpeed: 0,
    passives: [],
    equipWaza: [],
    masteredWaza: [],
    workSuitabilityBonus: {},
    oldOwnerUids: [],
    ...overrides,
  }
}

describe('production purposes', () => {
  it('asks no passive of a fishing party, because none helps', () => {
    expect(sidesFor('fishing', INPUT)).toEqual([
      { side: 'party', want: [], extra: [] },
    ])
  })

  it('gives the bases the ordinary worker wants for their jobs', () => {
    const [food] = sidesFor('food', { ...INPUT, work: ['MonsterFarm'] })
    expect(food!.side).toBe('base')
    expect(food!.want.map((w) => w.type)).toContain('CraftSpeed')
    // Ranching is in the jobs, so Ranch Master's rank is worth listing.
    expect(food!.extra.map((w) => w.type)).toContain(
      'WorkSuitabilityAddRank_MonsterFarm',
    )
    expect(sidesFor('ranch', INPUT)[0]!.side).toBe('base')
  })

  it('adds the breeding farm to a cake base, where the cake is used', () => {
    expect(sidesFor('cake', INPUT).map((s) => s.side)).toEqual(['base', 'farm'])
  })
})

describe('bestPartners', () => {
  it('ranks by how many wanted effects a partner has, then by size', () => {
    const rows = bestPartners(DATA, POOL, PARTNER_WANTS.fishing, 10)
    expect(rows.map((r) => r.id)).toEqual(['jelly', 'whale', 'octo'])
    // Only the matched effects, in the order wanted.
    expect(rows[0]!.effects.map((e) => e.type)).toEqual([
      'Fishing_ItemAddDrop',
      'Fishing_EnemyAddDrop',
    ])
  })

  it('ignores an effect that lands on the wrong target', () => {
    const ids = bestPartners(DATA, POOL, PARTNER_WANTS.fishing, 10).map(
      (r) => r.id,
    )
    expect(ids).not.toContain('selfish')
  })

  it('keeps salvaging and base boosters separate', () => {
    expect(
      bestPartners(DATA, POOL, PARTNER_WANTS.salvage, 10).map((r) => r.id),
    ).toEqual(['salvager'])
    // A reduction, wanted as one: the sign has to agree.
    expect(
      bestPartners(DATA, POOL, PARTNER_WANTS.hunger, 10).map((r) => r.id),
    ).toEqual(['sheep'])
  })

  it('puts the one in the party first among the player’s own', () => {
    const inBox = pal('Jelly', { level: 50 })
    const inParty = pal('Jelly', { level: 5 })
    const where = (p: Pal): Where => (p === inParty ? 'party' : 'palbox')
    const rows = ownedPartners(
      DATA,
      [inBox, inParty, pal('Cow')],
      where,
      PARTNER_WANTS.fishing,
      sidesFor('fishing', INPUT)[0]!,
      5,
    )
    expect(rows.map((r) => r.pal)).toEqual([inParty, inBox])
  })
})

describe('ranch drops', () => {
  it('ranks producers as ranch workers, from the pool only', () => {
    expect(ranchProducers(DATA, POOL, 'Milk', 5).map((r) => r.id)).toEqual([
      'cow',
    ])
  })

  it('finds the player’s own producers', () => {
    const cow = pal('Cow')
    const rows = ownedProducers(
      DATA,
      [pal('Jelly'), cow],
      () => 'base',
      'milk',
      sidesFor('ranch', INPUT)[0]!,
      5,
    )
    expect(rows.map((r) => r.pal)).toEqual([cow])
    expect(rows[0]!.level).toBe(2)
  })

  it('splits drops into food and everything else', () => {
    expect(ranchDropItems(DATA, POOL, true)).toEqual([
      { item: 'sweet', species: ['sheep'] },
      { item: 'milk', species: ['cow'] },
    ])
    expect(ranchDropItems(DATA, POOL, false)).toEqual([
      { item: 'wool', species: ['sheep'] },
    ])
  })
})
