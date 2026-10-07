/**
 * Where a pal is kept, what state it is in, and what it can do.
 *
 * Synthetic ids throughout.
 */

import { describe, expect, it } from 'vitest'

import {
  LOW_SANITY,
  conditions,
  placeText,
  placer,
  spaced,
  workLevel,
} from '@/domain/palState.ts'
import type { Pal, SaveIndex } from '@/domain/types.ts'
import type { Refdata } from '@/refdata/refdata.ts'

function pal(over: Partial<Pal> = {}): Pal {
  return {
    instanceId: 'pal0',
    characterId: 'TestPal',
    isBoss: false,
    isRare: false,
    level: 1,
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
    ...over,
  }
}

function indexOf(over: Partial<SaveIndex> = {}): SaveIndex {
  return {
    bases: [],
    playerDetails: [],
    charContainerById: new Map(),
    ...over,
  } as unknown as SaveIndex
}

describe('placer', () => {
  const index = indexOf({
    bases: [{ baseId: 'base1', workerContainerId: 'workers1' }],
    playerDetails: [{ otomoContainerId: 'party1', palboxContainerId: 'box1' }],
    charContainerById: new Map([
      ['guess-party', { ownerSlot: 'party' }],
      ['guess-base', { ownerBaseId: 'base2' }],
      ['mystery', {}],
    ]),
  } as never)
  const place = placer(index)

  it('knows a worker roster from the base that points at it', () => {
    expect(place(pal({ containerId: 'workers1', slotIndex: 4 }))).toEqual({
      where: 'base',
      baseId: 'base1',
      slot: 4,
    })
  })

  it('knows a party and a palbox from a player save', () => {
    expect(place(pal({ containerId: 'party1', slotIndex: 1 }))).toEqual({
      where: 'party',
      slot: 1,
    })
    expect(place(pal({ containerId: 'box1', slotIndex: 43 })).where).toBe(
      'palbox',
    )
  })

  it('falls back to what the container itself was inferred to be', () => {
    expect(place(pal({ containerId: 'guess-party' })).where).toBe('party')
    expect(place(pal({ containerId: 'guess-base' }))).toMatchObject({
      where: 'base',
      baseId: 'base2',
    })
  })

  it('says unknown, without a slot, when the save does not explain it', () => {
    expect(place(pal({ containerId: 'mystery', slotIndex: 9 }))).toEqual({
      where: 'unknown',
    })
    expect(place(pal())).toEqual({ where: 'unknown' })
  })
})

describe('placeText', () => {
  const name = (id: string) =>
    id === 'base1' ? 'Base 1 · near Here' : undefined

  it('counts slots from one, and a palbox in pages of thirty', () => {
    expect(placeText({ where: 'party', slot: 1 }, name)).toBe('Party · slot 2')
    expect(placeText({ where: 'palbox', slot: 0 }, name)).toBe(
      'Palbox · page 1, slot 1',
    )
    expect(placeText({ where: 'palbox', slot: 43 }, name)).toBe(
      'Palbox · page 2, slot 14',
    )
  })

  it('names the base, or admits it cannot', () => {
    expect(placeText({ where: 'base', baseId: 'base1' }, name)).toBe(
      'Base 1 · near Here',
    )
    expect(placeText({ where: 'base', baseId: 'gone' }, name)).toBe('A base')
    expect(placeText({ where: 'base' }, name)).toBe('A base')
  })

  it('says nothing for an unknown place', () => {
    expect(placeText({ where: 'unknown' }, name)).toBeUndefined()
  })
})

describe('conditions', () => {
  it('is empty for a healthy pal, including one with nothing recorded', () => {
    expect(conditions(pal())).toEqual([])
    expect(conditions(pal({ fullStomach: 120, sanity: 80 }))).toEqual([])
  })

  it('tells dying from a lesser injury, and names the injury', () => {
    expect(conditions(pal({ physicalHealth: 'Dying' }))[0]).toMatchObject({
      id: 'dying',
      tone: 'danger',
    })
    expect(conditions(pal({ physicalHealth: 'MinorInjury' }))[0]).toMatchObject(
      { id: 'injured', detail: 'Minor Injury', tone: 'warn' },
    )
  })

  it('names a sickness in words', () => {
    expect(conditions(pal({ sickness: 'DepressionSprain' }))[0]).toMatchObject({
      id: 'sick',
      detail: 'Depression Sprain',
    })
  })

  it('calls an empty stomach starving, and nothing above it', () => {
    expect(conditions(pal({ fullStomach: 0 })).map((c) => c.id)).toEqual([
      'starving',
    ])
    expect(conditions(pal({ fullStomach: 1 }))).toEqual([])
  })

  it('flags sanity only below the line', () => {
    expect(conditions(pal({ sanity: LOW_SANITY }))).toEqual([])
    expect(conditions(pal({ sanity: LOW_SANITY - 1 }))[0]?.id).toBe('sanity')
  })

  it('lists the worst first', () => {
    const all = conditions(
      pal({ physicalHealth: 'Dying', sickness: 'Cold', sanity: 10 }),
    )
    expect(all.map((c) => c.id)).toEqual(['dying', 'sick', 'sanity'])
  })
})

describe('spaced', () => {
  it('splits an enum tail at its capitals', () => {
    expect(spaced('GastricUlcer')).toBe('Gastric Ulcer')
    expect(spaced('Dying')).toBe('Dying')
  })
})

describe('workLevel', () => {
  const data = {
    species: { testpal: { work: { Mining: 2 } } },
  } as unknown as Refdata

  it("adds the pal's bonus to its species' level", () => {
    expect(workLevel(data, pal(), 'Mining')).toBe(2)
    expect(
      workLevel(data, pal({ workSuitabilityBonus: { Mining: 1 } }), 'Mining'),
    ).toBe(3)
  })

  it('does not invent a job from a bonus alone', () => {
    expect(
      workLevel(data, pal({ workSuitabilityBonus: { Cool: 2 } }), 'Cool'),
    ).toBe(0)
  })
})
