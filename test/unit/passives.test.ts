/**
 * The passive inheritance model.
 *
 * The expected values here are worked out by hand from `INHERIT_COUNT` rather
 * than recorded from a run, so a change to the distribution fails these tests
 * loudly instead of quietly re-baselining. That matters more here than anywhere
 * else in the domain: the distribution is community datamining and the one
 * input this app cannot check against upstream data.
 */

import { describe, expect, it } from 'vitest'

import {
  INHERIT_COUNT,
  MAX_SLOTS,
  RANDOM_ADD,
  carrierCounts,
  combine,
  expectedEggs,
  pAtLeast,
  pInherit,
  popcount,
  profileOf,
  subsets,
  wantedFrom,
} from '@/domain/passives.ts'
import type { Pal } from '@/domain/types.ts'

let n = 0
function pal(passives: string[]): Pal {
  n++
  return {
    instanceId: `${n}`.padStart(32, '0'),
    characterId: 'aa',
    isBoss: false,
    isRare: false,
    level: 1,
    exp: 0,
    rank: 0,
    rankAttack: 0,
    rankDefence: 0,
    rankHp: 0,
    rankCraftSpeed: 0,
    passives,
    equipWaza: [],
    masteredWaza: [],
    workSuitabilityBonus: {},
    oldOwnerUids: [],
  }
}

describe('the two constants', () => {
  it('INHERIT_COUNT is a distribution over 1…MAX_SLOTS', () => {
    expect(INHERIT_COUNT).toHaveLength(MAX_SLOTS + 1)
    // Index 0 exists and is zero: a hatch always inherits at least one.
    expect(INHERIT_COUNT[0]).toBe(0)
    expect(INHERIT_COUNT.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  it('RANDOM_ADD is a distribution over 0…3, averaging one per hatch', () => {
    expect(RANDOM_ADD.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    const mean = RANDOM_ADD.reduce((a, p, r) => a + p * r, 0)
    // The number behind every "why do the odds decay so fast" question: a clean
    // pair still hands its child one junk passive on average.
    expect(mean).toBeCloseTo(1, 10)
  })
})

describe('pInherit', () => {
  it('is certain when you want nothing', () => {
    expect(pInherit(0, 0)).toBe(1)
    expect(pInherit(8, 0)).toBe(1)
  })

  it('always passes down a lone passive', () => {
    // The model's most surprising claim, pinned deliberately. Every roll takes
    // at least one and a pool of one is taken whole, so a single carrier paired
    // with a blank pal *cannot* fail to pass it on. At least one community hatch
    // test disagrees; PalCalc, the most careful implementation in the ecosystem,
    // uses these weights anyway. If INHERIT_COUNT is ever corrected, this test
    // is where it shows up as a deliberate change rather than a silent one.
    expect(pInherit(1, 1)).toBeCloseTo(1, 10)
  })

  it('needs the two-roll for two wanted passives', () => {
    // P(n >= 2), since a pool of exactly two is taken whole by any bigger roll.
    expect(pInherit(2, 2)).toBeCloseTo(0.6, 10)
  })

  it('is impossible to want what is not there', () => {
    expect(pInherit(1, 2)).toBe(0)
    expect(pInherit(0, 1)).toBe(0)
  })

  it('is impossible to want more than a pal can hold', () => {
    expect(pInherit(8, MAX_SLOTS + 1)).toBe(0)
  })

  it('halves on a pool of two', () => {
    // n=1 draws it 1 time in 2; n≥2 takes the whole pool.
    // 0.4·½ + 0.3 + 0.2 + 0.1 = 0.8
    expect(pInherit(2, 1)).toBeCloseTo(0.8, 10)
  })

  it('is one in two for one wanted passive out of four', () => {
    // 0.4·¼ + 0.3·½ + 0.2·¾ + 0.1·1 = 0.5
    expect(pInherit(4, 1)).toBeCloseTo(0.5, 10)
  })

  it('needs the four-roll for four wanted passives', () => {
    // Only n=4 can carry four, and a pool of exactly four is taken whole.
    expect(pInherit(4, 4)).toBeCloseTo(INHERIT_COUNT[4]!, 10)
  })

  it('is about seven hundred eggs from two fully loaded parents', () => {
    // The number that justifies tracking junk at all: the same four passives
    // that cost ten eggs off two clean parents cost seven hundred off two
    // full ones. Everything the planner does about junk exists for this row.
    expect(pInherit(8, 4)).toBeCloseTo(INHERIT_COUNT[4]! / 70, 10)
    expect(expectedEggs(pInherit(8, 4))).toBeCloseTo(700, 6)
  })

  it('gets worse as the pool grows', () => {
    for (let m = 2; m <= 8; m++) {
      expect(pInherit(m, 1)).toBeLessThan(pInherit(m - 1, 1))
    }
  })

  it('gets worse the more you ask for', () => {
    for (let k = 2; k <= MAX_SLOTS; k++) {
      expect(pInherit(6, k)).toBeLessThan(pInherit(6, k - 1))
    }
  })
})

describe('expectedEggs', () => {
  it('inverts the odds', () => {
    expect(expectedEggs(0.5)).toBe(2)
    expect(expectedEggs(1)).toBe(1)
  })

  it('is infinite for an impossible ask, so the search drops it', () => {
    expect(expectedEggs(0)).toBe(Infinity)
    expect(expectedEggs(pInherit(1, 2))).toBe(Infinity)
  })
})

const clean = (mask: number) => ({ mask, junk: 0 })

describe('combine', () => {
  it('is a distribution, whatever it is given', () => {
    for (const a of [clean(0), clean(0b1), { mask: 0b11, junk: 2 }]) {
      for (const b of [clean(0), clean(0b10), { mask: 0b1100, junk: 2 }]) {
        const total = combine(a, b).reduce((t, o) => t + o.prob, 0)
        expect(total).toBeCloseTo(1, 10)
      }
    }
  })

  it('never fills more slots than a pal has', () => {
    for (const o of combine({ mask: 0b11, junk: 2 }, { mask: 0b1100, junk: 2 })) {
      expect(popcount(o.mask) + o.junk).toBeLessThanOrEqual(MAX_SLOTS)
    }
  })

  it('never invents a passive neither parent had', () => {
    // The "random fills are never one you wanted" assumption, asserted rather
    // than left implied.
    const union = 0b0101
    for (const o of combine(clean(0b0001), clean(0b0100))) {
      expect(o.mask & ~union).toBe(0)
    }
  })

  it('adds junk to two blank parents anyway', () => {
    const out = combine(clean(0), clean(0))
    expect(out.every((o) => o.mask === 0)).toBe(true)
    expect(out.find((o) => o.junk === 0)?.prob).toBeCloseTo(RANDOM_ADD[0]!, 10)
  })

  it('is unordered, like the pair it describes', () => {
    const a = { mask: 0b01, junk: 1 }
    const b = { mask: 0b10, junk: 2 }
    expect(combine(a, b)).toEqual(combine(b, a))
  })
})

describe('pAtLeast', () => {
  it('costs two and a half eggs to pass one passive down cleanly', () => {
    // A lone carrier always passes it on (pInherit(1,1) === 1) — but only 40%
    // of those hatches arrive without a random passive tagging along. That gap
    // is the whole difference between "a route" and "a route you can build on".
    expect(pAtLeast(clean(0b1), clean(0), 0b1, 0)).toBeCloseTo(0.4, 10)
    expect(pAtLeast(clean(0b1), clean(0), 0b1, 3)).toBeCloseTo(1, 10)
  })

  it('merges two clean carriers at a quarter, cleanly', () => {
    expect(pAtLeast(clean(0b01), clean(0b10), 0b11, 3)).toBeCloseTo(0.6, 10)
    expect(pAtLeast(clean(0b01), clean(0b10), 0b11, 0)).toBeCloseTo(0.24, 10)
  })

  it('lands a perfect four at one hatch in ten', () => {
    // Two clean two-passive parents. Every slot is spoken for, so step 4 has
    // nowhere to put a random one and the clean result is free.
    const p = pAtLeast(clean(0b0011), clean(0b1100), 0b1111, 0)
    expect(p).toBeCloseTo(0.1, 10)
  })

  it('is seven hundred eggs from two loaded parents', () => {
    const a = { mask: 0b0011, junk: 2 }
    const b = { mask: 0b1100, junk: 2 }
    expect(expectedEggs(pAtLeast(a, b, 0b1111, 0))).toBeCloseTo(700, 6)
  })

  it('gets easier the more junk you will tolerate', () => {
    const a = { mask: 0b01, junk: 1 }
    const b = { mask: 0b10, junk: 1 }
    let prev = -1
    for (let j = 0; j <= MAX_SLOTS; j++) {
      const p = pAtLeast(a, b, 0b11, j)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })

  it('gets harder the more you ask for', () => {
    const a = { mask: 0b01, junk: 0 }
    const b = { mask: 0b10, junk: 0 }
    expect(pAtLeast(a, b, 0b11, 4)).toBeLessThan(pAtLeast(a, b, 0b01, 4))
  })

  it('is impossible to want what neither parent has', () => {
    expect(pAtLeast(clean(0b01), clean(0b01), 0b10, 4)).toBe(0)
    expect(expectedEggs(pAtLeast(clean(0), clean(0), 0b1, 4))).toBe(Infinity)
  })
})

describe('wantedFrom', () => {
  it('lowercases, dedupes and caps at a pal’s slots', () => {
    const w = wantedFrom(['Legend', 'legend', 'Swift', 'A', 'B', 'C'])
    expect(w.ids).toEqual(['legend', 'swift', 'a', 'b'])
    expect(w.all).toBe(0b1111)
  })

  it('reports what it dropped rather than dropping it quietly', () => {
    // The picker caps the selection at four, but a link can carry any number,
    // and planning for a subset of what the URL says without saying so would be
    // the kind of quiet lie this app avoids everywhere else.
    expect(wantedFrom(['a', 'b', 'c', 'd', 'e', 'f']).ignored).toEqual([
      'e',
      'f',
    ])
  })

  it('is empty for nothing wanted', () => {
    expect(wantedFrom([])).toEqual({ ids: [], all: 0, ignored: [] })
  })
})

describe('profileOf', () => {
  const wanted = wantedFrom(['legend', 'swift'])

  it('matches regardless of the casing the save wrote', () => {
    expect(profileOf(pal(['Legend']), wanted).mask).toBe(0b01)
    expect(profileOf(pal(['SWIFT']), wanted).mask).toBe(0b10)
    expect(profileOf(pal(['legend', 'swift']), wanted).mask).toBe(0b11)
  })

  it('counts everything not asked for as junk', () => {
    expect(profileOf(pal(['Musclehead', 'Runner']), wanted)).toEqual({
      mask: 0,
      junk: 2,
    })
    expect(profileOf(pal(['Legend', 'Runner']), wanted)).toEqual({
      mask: 0b01,
      junk: 1,
    })
  })

  it('counts a duplicated passive once', () => {
    expect(profileOf(pal(['Runner', 'Runner']), wanted).junk).toBe(1)
  })

  it('never claims more slots than a pal has', () => {
    const crowded = pal(['a', 'b', 'c', 'd', 'e', 'Legend'])
    const p = profileOf(crowded, wanted)
    expect(popcount(p.mask) + p.junk).toBeLessThanOrEqual(MAX_SLOTS)
  })

  it('is all junk when nothing is wanted', () => {
    expect(profileOf(pal(['Legend']), wantedFrom([]))).toEqual({
      mask: 0,
      junk: 1,
    })
  })
})

describe('subsets', () => {
  it('enumerates every submask, largest first, ending at nothing', () => {
    expect(subsets(0b101)).toEqual([0b101, 0b100, 0b001, 0])
  })

  it('is just nothing for an empty mask', () => {
    expect(subsets(0)).toEqual([0])
  })

  it('counts 2^popcount', () => {
    expect(subsets(0b1111)).toHaveLength(16)
    expect(popcount(0b1011)).toBe(3)
  })
})

describe('carrierCounts', () => {
  it('keys lowercased, like every other refdata-keyed map', () => {
    const counts = carrierCounts([pal(['Legend']), pal(['legend'])])
    expect(counts.get('legend')).toBe(2)
  })

  it('counts pals, not slots', () => {
    // A save can list the same passive twice on one pal; it is one carrier.
    expect(carrierCounts([pal(['Legend', 'Legend'])]).get('legend')).toBe(1)
  })

  it('omits nothing it was given and invents nothing it was not', () => {
    const counts = carrierCounts([pal(['a', 'b']), pal(['b'])])
    expect([...counts]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })
})
