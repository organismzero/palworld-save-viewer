/**
 * What a child's IVs are likely to be, given its parents'.
 *
 * ## This is a model, and a thinner one than the passive odds
 *
 * Nobody outside the game's code knows the rule. What is known is one array of
 * weights in the game's `BP_PalGameSetting`, `Combi_TalentInheritNum`, which is
 * `[3, 2, 1]` (the game calls IVs "talents"), and about 190 hatches recorded by
 * the `tylercamp/palcalc` project, in which no child had three random IVs and
 * no stat, parent or higher value was favoured. Its
 * `README-PALWORLD-MECHANICS.md` reads those as the process below, and this
 * follows it:
 *
 * 1. Roll how many of the three IVs are inherited, from {@link INHERIT_IVS}.
 * 2. Choose that many of HP, attack and defense, uniformly.
 * 3. Each chosen one takes either parent's value, with an even chance.
 * 4. The others are rolled fresh.
 *
 * Step 4's range is this module's own assumption: uniform over 0 to
 * {@link IV_MAX}, which is what a wild pal's IVs look like. Breeding cakes
 * raise a floor on it and are not modelled.
 *
 * Everything here is a consequence of those four lines, so a correction to any
 * of them is a change to one constant.
 */

import type { BreedStep, BreedNode } from './breeding.ts'
import type { Pal } from './types.ts'

/** The largest value an IV takes. */
export const IV_MAX = 100

/**
 * Chance of inheriting this many IVs, indexed by count. `[3, 2, 1]` over six.
 *
 * Index 0 is zero: every recorded hatch inherited at least one.
 */
export const INHERIT_IVS: readonly number[] = [0, 3 / 6, 2 / 6, 1 / 6]

/** Chance any one stat is among the inherited: the mean count over three. */
export const P_INHERIT =
  INHERIT_IVS.reduce((sum, p, k) => sum + p * k, 0) / (INHERIT_IVS.length - 1)

export const IV_STATS = ['hp', 'attack', 'defense'] as const
export type IvStat = (typeof IV_STATS)[number]
export type IvTriple = Record<IvStat, number>

export function ivsOf(pal: Pal): IvTriple | undefined {
  if (
    pal.ivHp === undefined ||
    pal.ivAttack === undefined ||
    pal.ivDefense === undefined
  ) {
    return undefined
  }
  return { hp: pal.ivHp, attack: pal.ivAttack, defense: pal.ivDefense }
}

/**
 * The mean of each of a child's IVs.
 *
 * Linear in the parents' values, which is what lets a plan carry it down
 * through eggs that do not exist yet: the expected child of an expected parent
 * is the expected grandchild, with no approximation.
 */
export function expectedIvs(a: IvTriple, b: IvTriple): IvTriple {
  const one = (x: number, y: number) =>
    P_INHERIT * ((x + y) / 2) + (1 - P_INHERIT) * (IV_MAX / 2)
  return {
    hp: one(a.hp, b.hp),
    attack: one(a.attack, b.attack),
    defense: one(a.defense, b.defense),
  }
}

export interface StatForecast {
  stat: IvStat
  a: number
  b: number
  expected: number
  /** The better of the two parents' values. */
  best: number
  /** Chance the child's value is at least `best`, by inheritance or by luck. */
  pBest: number
}

export interface IvForecast {
  stats: StatForecast[]
  expectedTotal: number
  /** Chance all three come out at least as good as the better parent's. */
  pAllBest: number
}

/** Chance a freshly rolled IV is at least `v`. */
function pRolled(v: number): number {
  return Math.max(0, Math.min(1, (IV_MAX + 1 - v) / (IV_MAX + 1)))
}

/** The forecast for two actual pals, or nothing if either has no IVs recorded. */
export function ivForecast(palA: Pal, palB: Pal): IvForecast | undefined {
  const a = ivsOf(palA)
  const b = ivsOf(palB)
  if (!a || !b) return undefined

  const expected = expectedIvs(a, b)
  const best = (s: IvStat) => Math.max(a[s], b[s])
  // Given that a stat is inherited, the chance it is the better value: a coin
  // flip, unless the parents agree and either will do.
  const pTaken = (s: IvStat) => (a[s] === b[s] ? 1 : 0.5)

  const stats = IV_STATS.map((stat) => ({
    stat,
    a: a[stat],
    b: b[stat],
    expected: expected[stat],
    best: best(stat),
    pBest: P_INHERIT * pTaken(stat) + (1 - P_INHERIT) * pRolled(best(stat)),
  }))

  // The three stats are not independent, since the count is shared, so "all
  // three" is summed over which ones were inherited rather than multiplied.
  let pAllBest = 0
  for (let mask = 1; mask < 8; mask++) {
    const chosen = IV_STATS.filter((_, i) => mask & (1 << i))
    const ways = chosen.length === 2 ? 3 : chosen.length === 1 ? 3 : 1
    let p = INHERIT_IVS[chosen.length]! / ways
    for (const s of IV_STATS) {
      p *= chosen.includes(s) ? pTaken(s) : pRolled(best(s))
    }
    pAllBest += p
  }

  return {
    stats,
    expectedTotal: expected.hp + expected.attack + expected.defense,
    pAllBest,
  }
}

/**
 * The expected IVs of every egg in a plan, by step number.
 *
 * A held parent contributes the IVs of the pal the plan names; a bred one
 * contributes the expectation of the step that makes it. A step is left out
 * when anything beneath it is unknown, rather than filled with a guess.
 *
 * This is the mean over hatches taken as they come. A player who re-hatches a
 * step until it is good does better, and the plan cannot know that they will.
 */
export function stepIvs(steps: readonly BreedStep[]): Map<number, IvTriple> {
  const out = new Map<number, IvTriple>()
  const of = (node: BreedNode) =>
    node.kind === 'bred'
      ? out.get(node.step)
      : node.use
        ? ivsOf(node.use)
        : undefined
  // Steps are in execution order, so a parent is always already done.
  for (const step of steps) {
    const a = of(step.a)
    const b = of(step.b)
    if (a && b) out.set(step.n, expectedIvs(a, b))
  }
  return out
}
