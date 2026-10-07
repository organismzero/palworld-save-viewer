/**
 * Two concrete pals, forwards: the child, the passive outcomes and their ranking.
 *
 * The distribution is pinned against `passives.ts` rather than re-derived: for
 * disjoint parents the exact pool and the profile model must agree, and where
 * they share a passive the exact pool must be the smaller one.
 */

import { describe, expect, it } from 'vitest'

import { buildBreedingTable } from '@/domain/breeding.ts'
import {
  DEFAULT_PAIR_PURPOSE,
  PAIR_PURPOSES,
  pairChild,
  pairOutcomes,
  pairProblem,
  pairSpec,
  rankPairOutcomes,
} from '@/domain/pairOutcomes.ts'
import { MAX_SLOTS, pInherit } from '@/domain/passives.ts'
import type { Gender, Pal } from '@/domain/types.ts'
import type { PassiveEffect, PassiveInfo } from '@/refdata/refdata.ts'

let n = 0
function pal(passives: string[], gender?: Gender, characterId = 'aa'): Pal {
  n++
  return {
    instanceId: `${n}`.padStart(32, '0'),
    characterId,
    gender,
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

const total = (xs: { prob: number }[]) => xs.reduce((s, x) => s + x.prob, 0)

/** Chance the child inherits every one of `ids`. */
const pHas = (a: Pal, b: Pal, ids: string[]) =>
  total(pairOutcomes(a, b).filter((o) => ids.every((id) => o.inherited.includes(id)))) // prettier-ignore

describe('pairOutcomes', () => {
  it('is a distribution, empty parents included', () => {
    expect(total(pairOutcomes(pal([]), pal([])))).toBeCloseTo(1, 12)
    expect(
      total(pairOutcomes(pal(['a', 'b', 'c', 'd']), pal(['e', 'f', 'g', 'h']))),
    ).toBeCloseTo(1, 12)
  })

  it('two blank parents get only random fills', () => {
    const out = pairOutcomes(pal([]), pal([]))
    expect(out.every((o) => o.inherited.length === 0)).toBe(true)
    expect(out.map((o) => o.random).sort()).toEqual([0, 1, 2, 3])
  })

  it('never fills past four slots', () => {
    for (const o of pairOutcomes(pal(['a', 'b', 'c', 'd']), pal(['e', 'f']))) {
      expect(o.inherited.length + o.random).toBeLessThanOrEqual(MAX_SLOTS)
      expect(o.inherited.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('agrees with pInherit for disjoint parents', () => {
    const a = pal(['a', 'b', 'c'])
    const b = pal(['d', 'e'])
    expect(pHas(a, b, ['a'])).toBeCloseTo(pInherit(5, 1), 12)
    expect(pHas(a, b, ['a', 'd'])).toBeCloseTo(pInherit(5, 2), 12)
  })

  it('counts a shared passive once, so the pool is smaller', () => {
    // Four names between them, not five: X is in both.
    const a = pal(['x', 'a', 'b'])
    const b = pal(['X', 'c'])
    expect(pHas(a, b, ['x'])).toBeCloseTo(pInherit(4, 1), 12)
    expect(pairOutcomes(a, b).some((o) => o.inherited.includes('X'))).toBe(
      false,
    )
  })

  it('inherits a small pool whole', () => {
    // A pool of one: every hatch has it.
    expect(pHas(pal(['a']), pal([]), ['a'])).toBeCloseTo(1, 12)
  })
})

describe('pairProblem', () => {
  it('needs two different pals of opposite gender', () => {
    const m = pal([], 'Male')
    expect(pairProblem(m, m, false)).toBe('same-pal')
    expect(pairProblem(m, pal([], 'Male'), false)).toBe('same-gender')
    expect(pairProblem(m, pal([], 'Female'), false)).toBeUndefined()
  })

  it('lets an unknown gender through only when told to assume', () => {
    const m = pal([], 'Male')
    expect(pairProblem(m, pal([]), false)).toBe('unknown-gender')
    expect(pairProblem(m, pal([]), true)).toBeUndefined()
  })
})

describe('pairChild', () => {
  const table = buildBreedingTable({
    pals: {
      aa: { combiRank: 100, ignoreCombi: false },
      bb: { combiRank: 200, ignoreCombi: false },
      mid: { combiRank: 150, ignoreCombi: false },
      odd: { combiRank: 300, ignoreCombi: false },
    },
    uniqueCombos: [{ a: 'aa', b: 'odd', child: 'bb' }],
  })

  it('follows the formula, and marks a unique combo', () => {
    expect(pairChild(table, 'AA', 'bb')).toEqual({
      child: 'mid',
      unique: false,
    })
    expect(pairChild(table, 'odd', 'aa')).toEqual({ child: 'bb', unique: true })
    expect(pairChild(table, 'aa', 'aa')).toEqual({ child: 'aa', unique: false })
  })
})

describe('rankPairOutcomes', () => {
  const fx = (type: string, value: number): PassiveEffect => ({
    type,
    value,
    target: 'self',
  })
  const passive = (effects: PassiveEffect[]): PassiveInfo => ({
    name: 'x',
    rank: 1,
    source: 'random',
    effects,
  })
  const PASSIVES: Record<string, PassiveInfo> = {
    brave: passive([fx('ShotAttack', 20)]),
    hard: passive([fx('Defense', 10)]),
    coward: passive([fx('ShotAttack', -10)]),
    artisan: passive([fx('CraftSpeed', 50)]),
    musclehead: passive([fx('ShotAttack', 30), fx('CraftSpeed', -50)]),
  }

  it('puts the best hatch for the purpose first, and sums to one', () => {
    const ranked = rankPairOutcomes(
      pairOutcomes(pal(['brave', 'coward']), pal(['hard', 'artisan'])),
      PASSIVES,
      pairSpec('fight'),
    )
    // Artisan is worth nothing in a fight, so it rides along at the top or not.
    expect(ranked[0]!.inherited).toEqual(
      expect.arrayContaining(['brave', 'hard']),
    )
    expect(ranked[0]!.inherited).not.toContain('coward')
    expect(ranked[0]!.score).toBe(30)
    expect(ranked.at(-1)!.score).toBe(-10)
    expect(ranked.at(-1)!.inherited).toContain('coward')
    expect(total(ranked)).toBeCloseTo(1, 12)
  })

  it('reports "this or better" as a rising running total', () => {
    const ranked = rankPairOutcomes(
      pairOutcomes(pal(['brave', 'coward']), pal(['hard'])),
      PASSIVES,
      pairSpec('fight'),
    )
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.atLeast).toBeGreaterThanOrEqual(ranked[i - 1]!.atLeast)
      expect(ranked[i]!.score).toBeLessThanOrEqual(ranked[i - 1]!.score)
    }
    expect(ranked.at(-1)!.atLeast).toBe(1)
  })

  it('groups over random fills and keeps their split', () => {
    const ranked = rankPairOutcomes(
      pairOutcomes(pal(['brave']), pal([])),
      PASSIVES,
      pairSpec('fight'),
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.prob).toBeCloseTo(1, 12)
    expect(ranked[0]!.pClean).toBeCloseTo(0.4, 12)
    expect(ranked[0]!.randomDist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('scores the same hatch differently for a different purpose', () => {
    // Musclehead hits harder and works slower: top for a fight, bottom for a base.
    const outcomes = pairOutcomes(pal(['artisan']), pal(['musclehead']))
    const fight = rankPairOutcomes(outcomes, PASSIVES, pairSpec('fight'))
    const work = rankPairOutcomes(outcomes, PASSIVES, pairSpec('work'))
    expect(fight[0]!.inherited).toContain('musclehead')
    expect(work[0]!.inherited).toEqual(['artisan'])
    expect(work.at(-1)!.inherited).toEqual(['musclehead'])
  })
})

describe('purposes', () => {
  it('defaults to fighting, and each one wants something', () => {
    expect(DEFAULT_PAIR_PURPOSE).toBe('fight')
    expect(PAIR_PURPOSES[0]!.id).toBe('fight')
    for (const p of PAIR_PURPOSES) {
      expect(pairSpec(p.id).want.length).toBeGreaterThan(0)
    }
  })
})
