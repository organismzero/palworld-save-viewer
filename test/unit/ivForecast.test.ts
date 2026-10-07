/** The child IV model. Synthetic pals throughout. */

import { describe, expect, it } from 'vitest'

import type { BreedNode, BreedStep } from '@/domain/breeding.ts'
import {
  INHERIT_IVS,
  P_INHERIT,
  expectedIvs,
  ivForecast,
  stepIvs,
} from '@/domain/ivForecast.ts'
import type { Pal } from '@/domain/types.ts'

const pal = (ivHp?: number, ivAttack?: number, ivDefense?: number) =>
  ({ ivHp, ivAttack, ivDefense }) as Pal

describe('the inheritance weights', () => {
  it('are 3:2:1 over one, two and three IVs, and never none', () => {
    expect(INHERIT_IVS[0]).toBe(0)
    expect(INHERIT_IVS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    expect(INHERIT_IVS[1]! / INHERIT_IVS[3]!).toBeCloseTo(3, 12)
  })

  it('make any one stat inherited five times in nine', () => {
    expect(P_INHERIT).toBeCloseTo(5 / 9, 12)
  })
})

describe('expectedIvs', () => {
  it('is the parents’ mean pulled towards a fresh roll', () => {
    const e = expectedIvs(
      { hp: 100, attack: 0, defense: 50 },
      { hp: 100, attack: 0, defense: 50 },
    )
    // 5/9 of 100 and 4/9 of 50.
    expect(e.hp).toBeCloseTo(700 / 9, 9)
    expect(e.attack).toBeCloseTo(200 / 9, 9)
    expect(e.defense).toBeCloseTo(50, 9)
  })
})

describe('ivForecast', () => {
  it('is nothing when a parent has no IVs recorded', () => {
    expect(ivForecast(pal(1, 2, 3), pal(1, 2))).toBeUndefined()
  })

  it('gives each stat its parents, its mean and the better value', () => {
    const f = ivForecast(pal(80, 20, 60), pal(40, 90, 60))!
    expect(f.stats.map((s) => [s.stat, s.a, s.b, s.best])).toEqual([
      ['hp', 80, 40, 80],
      ['attack', 20, 90, 90],
      ['defense', 60, 60, 60],
    ])
    expect(f.expectedTotal).toBeCloseTo(
      f.stats.reduce((t, s) => t + s.expected, 0),
      9,
    )
  })

  it('counts both inheriting the better value and rolling it', () => {
    const f = ivForecast(pal(100, 0, 60), pal(0, 0, 60))!
    const [hp, attack, defense] = f.stats
    // Inherited and the right parent, or rolled a 100 outright.
    expect(hp!.pBest).toBeCloseTo((5 / 9) * 0.5 + (4 / 9) * (1 / 101), 9)
    // Nothing is below zero, so every hatch is at least as good.
    expect(attack!.pBest).toBeCloseTo(1, 9)
    // The parents agree, so inheriting it from either will do.
    expect(defense!.pBest).toBeCloseTo(5 / 9 + (4 / 9) * (41 / 101), 9)
  })

  it('does not treat the three stats as independent', () => {
    // Two perfect parents: all three are perfect only if all three are
    // inherited, or the missing ones are rolled at 100.
    const f = ivForecast(pal(100, 100, 100), pal(100, 100, 100))!
    const r = 1 / 101
    expect(f.pAllBest).toBeCloseTo(1 / 6 + (2 / 6) * r + (3 / 6) * r * r, 9)
    // Multiplying the per-stat chances would say something else.
    expect(f.pAllBest).not.toBeCloseTo(f.stats[0]!.pBest ** 3, 3)
  })

  it('is certain when there is nothing to beat', () => {
    expect(ivForecast(pal(0, 0, 0), pal(0, 0, 0))!.pAllBest).toBeCloseTo(1, 9)
  })
})

describe('stepIvs', () => {
  const held = (p?: Pal): BreedNode => ({ kind: 'owned', species: 'aa', count: 1, use: p }) // prettier-ignore
  const bred = (step: number): BreedNode => ({ kind: 'bred', species: 'mid', step, a: held(), b: held() }) // prettier-ignore
  const step = (n: number, a: BreedNode, b: BreedNode): BreedStep => ({ n, species: 'x', a, b, generation: 1, selfPair: false }) // prettier-ignore

  it('carries the expectation down through an egg that does not exist yet', () => {
    const steps = [
      step(1, held(pal(100, 100, 100)), held(pal(100, 100, 100))),
      step(2, bred(1), held(pal(50, 50, 50))),
    ]
    const ivs = stepIvs(steps)
    const first = 700 / 9
    expect(ivs.get(1)!.hp).toBeCloseTo(first, 9)
    expect(ivs.get(2)!.hp).toBeCloseTo((5 / 9) * ((first + 50) / 2) + (4 / 9) * 50, 9) // prettier-ignore
  })

  it('leaves a step out when a parent beneath it is unknown', () => {
    const steps = [
      step(1, held(pal(1, 2, 3)), held()),
      step(2, bred(1), held(pal(50, 50, 50))),
    ]
    expect(stepIvs(steps).size).toBe(0)
  })
})
