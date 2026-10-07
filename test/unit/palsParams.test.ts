/**
 * The Pals view's link codec and the filter it drives.
 *
 * Synthetic ids throughout.
 */

import { describe, expect, it } from 'vitest'

import { serialiseParams } from '@/app/viewParams.ts'
import type { Pal, SaveIndex } from '@/domain/types.ts'
import type { Refdata } from '@/refdata/refdata.ts'
import { filterPals, isFiltered } from '@/views/pals/filter.ts'
import {
  OWNER_BASE,
  OWNER_NONE,
  PALS_DEFAULTS,
  palsCodec,
  type PalsParams,
} from '@/views/pals/params.ts'

const ANN = 'aaaaaaaa'.padEnd(32, '0')
const BOB = 'bbbbbbbb'.padEnd(32, '0')

function pal(id: string, over: Partial<Pal> = {}): Pal {
  return {
    instanceId: id.padEnd(32, '0'),
    characterId: 'TestPal',
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
    ...over,
  }
}

const pals = [
  pal('11111111', { ownerPlayerUid: ANN, gender: 'Female', level: 30, hp: 900, passives: ['CraftSpeed_up2'] }), // prettier-ignore
  pal('22222222', { ownerPlayerUid: BOB, gender: 'Male', level: 5, hp: 100, nickname: 'Zed', characterId: 'OtherPal' }), // prettier-ignore
  pal('33333333', { level: 50, hp: 500, sickness: 'Cold', containerId: 'workers' }), // prettier-ignore
]

const index = {
  pals,
  palById: new Map(pals.map((p) => [p.instanceId, p])),
  playerByUid: new Map([
    [ANN, { name: 'Ann' }],
    [BOB, { name: 'Bob' }],
  ]),
} as unknown as SaveIndex

const data = {
  species: {
    testpal: { name: 'Test Pal', element1: 'Fire', work: { Mining: 3 } },
    otherpal: { name: 'Other Pal', element1: 'Water', work: {} },
  },
  passives: { craftspeed_up2: { name: 'Artisan' } },
} as unknown as Refdata

const codec = palsCodec(index)

function roundTrip(over: Partial<PalsParams>): PalsParams {
  const value = { ...PALS_DEFAULTS, ...over }
  const qs = serialiseParams(codec.encode(value, PALS_DEFAULTS))
  return codec.decode(new URLSearchParams(qs), PALS_DEFAULTS)
}

function ids(over: Partial<PalsParams>, withData = true): string[] {
  return filterPals(
    pals,
    { ...PALS_DEFAULTS, ...over },
    {
      index,
      data: withData ? data : undefined,
      place: (p) =>
        p.containerId === 'workers' ? { where: 'base' } : { where: 'unknown' },
    },
  ).map((p) => p.instanceId.slice(0, 1))
}

describe('palsCodec', () => {
  it('writes nothing for an untouched view', () => {
    expect(codec.encode(PALS_DEFAULTS, PALS_DEFAULTS)).toEqual({})
  })

  it('round-trips every filter', () => {
    const value: Partial<PalsParams> = {
      query: 'lam ball',
      elements: new Set(['Fire', 'Water']),
      minLevel: 12,
      maxLevel: 40,
      minIv: 150,
      owner: ANN,
      gender: 'Female',
      work: 'Mining',
      workMin: 3,
      attention: true,
      preset: 'Raid team',
      flags: { boss: true, rare: false, named: true },
      sort: 'owner',
      reversed: true,
      selectedId: pals[0]!.instanceId,
    }
    expect(roundTrip(value)).toEqual({ ...PALS_DEFAULTS, ...value })
  })

  it('keeps the two owners that are not players as words', () => {
    expect(codec.encode({ ...PALS_DEFAULTS, owner: OWNER_BASE }, PALS_DEFAULTS).owner).toBe('base') // prettier-ignore
    expect(roundTrip({ owner: OWNER_NONE }).owner).toBe(OWNER_NONE)
    expect(roundTrip({ owner: OWNER_BASE }).owner).toBe(OWNER_BASE)
  })

  it('carries a job and its minimum as one param', () => {
    const out = codec.encode(
      { ...PALS_DEFAULTS, work: 'Mining', workMin: 2 },
      PALS_DEFAULTS,
    )
    expect(out.job).toBe('Mining:2')
    // A minimum with no job says nothing, so it does not travel.
    expect(codec.encode({ ...PALS_DEFAULTS, workMin: 4 }, PALS_DEFAULTS)).toEqual({}) // prettier-ignore
  })

  it('falls back on a job param it cannot read', () => {
    const d = (qs: string) => codec.decode(new URLSearchParams(qs), PALS_DEFAULTS) // prettier-ignore
    expect(d('job=Mining')).toMatchObject({ work: 'Mining', workMin: 1 })
    expect(d('job=Mining:x')).toMatchObject({ work: 'Mining', workMin: 1 })
    expect(d('job=:3')).toMatchObject({ work: '', workMin: 1 })
  })

  it('drops an unknown sort, gender and owner', () => {
    const got = codec.decode(
      new URLSearchParams('sort=nope&sex=x&owner=cccccccc'),
      PALS_DEFAULTS,
    )
    expect(got).toMatchObject({ sort: 'iv', gender: '', owner: '' })
  })

  it('reports a missing owner, but not a sentinel one', () => {
    const missing = (qs: string) => codec.missing!(new URLSearchParams(qs))
    expect(missing('owner=cccccccc')).toEqual(['a player'])
    expect(missing('owner=none')).toEqual([])
    expect(missing('owner=base')).toEqual([])
    expect(missing('owner=aaaaaaaa')).toEqual([])
  })
})

describe('filterPals', () => {
  it('shows everything by default', () => {
    expect(ids({ sort: 'level' })).toEqual(['3', '1', '2'])
  })

  it('filters by gender, level range and owner', () => {
    expect(ids({ gender: 'Male' })).toEqual(['2'])
    expect(ids({ minLevel: 6, maxLevel: 40 })).toEqual(['1'])
    expect(ids({ owner: BOB })).toEqual(['2'])
  })

  it('treats no owner and base workers as owners of their own', () => {
    expect(ids({ owner: OWNER_NONE })).toEqual(['3'])
    expect(ids({ owner: OWNER_BASE })).toEqual(['3'])
  })

  it('keeps only pals that need attention', () => {
    expect(ids({ attention: true })).toEqual(['3'])
  })

  it('filters by a job at a level', () => {
    expect(ids({ work: 'Mining', workMin: 3 }).sort()).toEqual(['1', '3'])
    expect(ids({ work: 'Mining', workMin: 4 })).toEqual([])
  })

  it('does not apply an element or job filter before reference data', () => {
    expect(ids({ work: 'Mining', workMin: 5 }, false)).toHaveLength(3)
    expect(ids({ elements: new Set(['Water']) }, false)).toHaveLength(3)
    expect(ids({ elements: new Set(['Water']) })).toEqual(['2'])
  })

  it('finds a passive by the name on its chip, not only its asset id', () => {
    expect(ids({ query: 'artisan' })).toEqual(['1'])
    expect(ids({ query: 'craftspeed' })).toEqual(['1'])
  })

  it('narrows to a party preset', () => {
    const got = filterPals(pals, PALS_DEFAULTS, {
      index,
      data,
      place: () => ({ where: 'unknown' }),
      preset: new Set([pals[1]!.instanceId]),
    })
    expect(got).toEqual([pals[1]])
  })

  it('sorts by HP, name, species and owner', () => {
    expect(ids({ sort: 'hp' })).toEqual(['1', '3', '2'])
    // "Test Pal", "Test Pal", "Zed": the nickname is the name.
    expect(ids({ sort: 'name' })[2]).toBe('2')
    expect(ids({ sort: 'species' })[0]).toBe('2')
    // Ann, Bob, then the pal nobody owns.
    expect(ids({ sort: 'owner' })).toEqual(['1', '2', '3'])
  })

  it('turns any sort over', () => {
    expect(ids({ sort: 'hp', reversed: true })).toEqual(['2', '3', '1'])
  })
})

describe('isFiltered', () => {
  it('does not count sort, direction or selection', () => {
    expect(isFiltered(PALS_DEFAULTS)).toBe(false)
    expect(
      isFiltered({ ...PALS_DEFAULTS, sort: 'hp', reversed: true, selectedId: 'x' }), // prettier-ignore
    ).toBe(false)
  })

  it('counts each of the new filters', () => {
    for (const over of [
      { gender: 'Male' },
      { maxLevel: 10 },
      { work: 'Mining' },
      { attention: true },
      { preset: 'p' },
      { owner: OWNER_NONE },
    ] as Partial<PalsParams>[]) {
      expect(isFiltered({ ...PALS_DEFAULTS, ...over })).toBe(true)
    }
  })
})
