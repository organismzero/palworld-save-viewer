/**
 * What two particular pals hatch, and how good each hatch is for a purpose.
 *
 * ## The forward question
 *
 * The planner in `breeding.ts` and `passiveBreeding.ts` works backwards from a
 * target. This answers the other way round: "these two, here — what comes out?"
 * The species is not in doubt, since `childOf` is a function of the pair, so
 * every outcome worth listing is a *passive* outcome.
 *
 * ## Same rule, exact pool
 *
 * The inheritance rule and both of its distributions are the ones in
 * `passives.ts`, and everything that module's header says about where they come
 * from applies here unchanged. What differs is the pool. `combine` reduces a pal
 * to a profile — wanted bits plus a *count* of junk — and so has to assume the
 * two parents' junk is disjoint. Two concrete pals need no such assumption: their
 * passives are known by name, so the pool is their actual union and a trait both
 * carry is in it once. That makes these odds exact under the rule, where the
 * planner's are deliberately pessimistic.
 *
 * Step 4's random fills stay anonymous. The draw is weighted by a column no
 * public export carries, so which passive a fill turns out to be is not
 * something this can say; it reports how many there are and scores them as
 * nothing.
 *
 * ## What is not predicted
 *
 * IVs. Nothing in the app models how a child's talents follow its parents', so
 * nothing here pretends to.
 */

import type { PassiveInfo, Refdata } from '../refdata/refdata.ts'
import { childOf, pairKey, type BreedingTable } from './breeding.ts'
import { INHERIT_COUNT, MAX_SLOTS, RANDOM_ADD, choose } from './passives.ts'
import {
  BREEDING_WORK,
  scorePassive,
  sidesFor,
  type Counted,
  type GoalId,
  type SideSpec,
} from './recommend.ts'
import type { Pal } from './types.ts'

/* -------------------------------------------------------------------------
   The child
   ------------------------------------------------------------------------- */

export interface PairChild {
  /** Lowercased asset id, or nothing if either parent is unknown here. */
  child?: string
  /** Whether a unique combo, rather than the rank formula, decided it. */
  unique: boolean
}

export function pairChild(
  table: BreedingTable,
  a: string,
  b: string,
): PairChild {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return {
    child: childOf(table, x, y),
    unique: x !== y && table.unique.has(pairKey(x, y)),
  }
}

/** Why two pals cannot be paired, if they cannot. */
export type PairProblem = 'same-pal' | 'same-gender' | 'unknown-gender'

/**
 * The gender rule from `breeding.ts`, applied to two pals someone owns.
 *
 * `unknown-gender` is only a problem when the caller has not been told to
 * assume: the save simply does not record it, and the Breed rail's
 * "assume unknown gender" switch is the user saying it does not matter.
 */
export function pairProblem(
  a: Pal,
  b: Pal,
  assumeUnknownGender: boolean,
): PairProblem | undefined {
  if (a.instanceId === b.instanceId) return 'same-pal'
  if (!a.gender || !b.gender) {
    return assumeUnknownGender ? undefined : 'unknown-gender'
  }
  if (a.gender === b.gender) return 'same-gender'
  return undefined
}

/* -------------------------------------------------------------------------
   The outcomes
   ------------------------------------------------------------------------- */

export interface PairOutcome {
  /** Passives taken from the parents, lowercased and sorted. */
  inherited: string[]
  /** Anonymous random passives added on top. */
  random: number
  prob: number
}

/**
 * Every hatch two pals can produce, and with what probability.
 *
 * Walks the rule in `passives.ts` step for step over the real pool: roll a
 * ceiling from {@link INHERIT_COUNT}, take a uniform subset of that size, then
 * top up from {@link RANDOM_ADD} as far as the four-slot limit allows. At most
 * eight passives in the pool, so a few hundred outcomes at most.
 */
export function pairOutcomes(a: Pal, b: Pal): PairOutcome[] {
  const pool = [...new Set([...passivesOf(a), ...passivesOf(b)])].sort()
  const m = pool.length

  const acc = new Map<string, PairOutcome>()
  const add = (inherited: string[], random: number, p: number) => {
    if (p <= 0) return
    const key = `${inherited.join(',')}+${random}`
    const hit = acc.get(key)
    if (hit) hit.prob += p
    else acc.set(key, { inherited, random, prob: p })
  }

  if (m === 0) {
    for (let r = 0; r < RANDOM_ADD.length; r++) {
      add([], Math.min(r, MAX_SLOTS), RANDOM_ADD[r]!)
    }
    return [...acc.values()]
  }

  for (let n = 1; n < INHERIT_COUNT.length; n++) {
    const pn = INHERIT_COUNT[n]!
    if (pn === 0) continue
    // A ceiling, not a requirement: a smaller pool is inherited whole.
    const t = Math.min(n, m)
    const each = pn / choose(m, t)
    for (const drawn of combinations(pool, t)) {
      for (let r = 0; r < RANDOM_ADD.length; r++) {
        add(drawn, Math.min(r, MAX_SLOTS - t), each * RANDOM_ADD[r]!)
      }
    }
  }

  return [...acc.values()]
}

/** A pal's passives, lowercased, deduped and clamped to what the game shows. */
function passivesOf(pal: Pal): string[] {
  return [...new Set(pal.passives.map((p) => p.toLowerCase()))].slice(
    0,
    MAX_SLOTS,
  )
}

/** Every `size`-sized combination of `items`, each in `items`' order. */
function combinations(items: string[], size: number): string[][] {
  const out: string[][] = []
  const walk = (i: number, acc: string[]) => {
    if (acc.length === size) return void out.push(acc)
    if (items.length - i < size - acc.length) return
    walk(i + 1, [...acc, items[i]!])
    walk(i + 1, acc)
  }
  walk(0, [])
  return out
}

/* -------------------------------------------------------------------------
   Ranking
   ------------------------------------------------------------------------- */

export interface RankedOutcome {
  /** Passives taken from the parents, lowercased and sorted. */
  inherited: string[]
  /** Summed over every number of random fills. */
  prob: number
  /** Of `prob`, the share that came with no random fill at all. */
  pClean: number
  /** Chance of each number of random fills, given this inheritance. */
  randomDist: number[]
  /** Signed sum of the purpose's wanted percentages. */
  score: number
  /** The purpose's switches and counts, signed; a tie-break only. */
  extra: number
  /** Which effects counted, per inherited passive, for chip colouring. */
  counted: Map<string, Counted[]>
  /** Chance of this outcome or one ranked above it. */
  atLeast: number
}

/**
 * The outcomes, best for the purpose first.
 *
 * Grouped by what was inherited, because the random fills cannot be scored:
 * which passive a fill becomes is unknowable here, so two hatches that differ
 * only in how many they got are the same outcome as far as a ranking can tell.
 * The count is kept beside it, since a fill is a slot taken either way.
 *
 * Ties on score go to the purpose's switches and counts, then to the likelier
 * outcome, then to the passive ids so two runs agree.
 */
export function rankPairOutcomes(
  outcomes: PairOutcome[],
  passives: Refdata['passives'],
  spec: SideSpec,
): RankedOutcome[] {
  const groups = new Map<string, RankedOutcome>()
  for (const o of outcomes) {
    const key = o.inherited.join(',')
    let g = groups.get(key)
    if (!g) {
      g = {
        inherited: o.inherited,
        prob: 0,
        pClean: 0,
        randomDist: new Array<number>(MAX_SLOTS).fill(0),
        score: 0,
        extra: 0,
        counted: new Map(),
        atLeast: 0,
      }
      for (const id of o.inherited) {
        const info: PassiveInfo | undefined = passives[id]
        if (!info) continue
        const s = scorePassive(id, info, spec)
        g.score += s.score
        g.extra += s.extra
        if (s.counted.length > 0) g.counted.set(id, s.counted)
      }
      groups.set(key, g)
    }
    g.prob += o.prob
    if (o.random === 0) g.pClean += o.prob
    g.randomDist[o.random] = (g.randomDist[o.random] ?? 0) + o.prob
  }

  const ranked = [...groups.values()].sort(
    (x, y) =>
      y.score - x.score ||
      y.extra - x.extra ||
      y.prob - x.prob ||
      x.inherited.join(',').localeCompare(y.inherited.join(',')),
  )
  let running = 0
  for (const r of ranked) {
    running += r.prob
    // Clamped for the same floating-point reason as `pAtLeast`.
    r.atLeast = Math.min(1, running)
    // Conditional on this inheritance, so it reads as "and then, how cluttered".
    r.randomDist = r.randomDist.map((p) => (r.prob > 0 ? p / r.prob : 0))
  }
  // The worst outcome "or better" is every outcome, which is a certainty — not
  // the 0.9999999999999999 a floating-point running sum lands on.
  const last = ranked.at(-1)
  if (last) last.atLeast = 1
  return ranked
}

/* -------------------------------------------------------------------------
   Purposes
   ------------------------------------------------------------------------- */

/** The purposes a passive can actually score for, and the default first. */
export const PAIR_PURPOSES: readonly {
  id: GoalId
  label: string
}[] = [
  { id: 'fight', label: 'Fighting' },
  { id: 'work', label: 'Working a base' },
  { id: 'travel', label: 'Travel' },
  { id: 'breeding', label: 'A breeding base' },
]

export const DEFAULT_PAIR_PURPOSE: GoalId = 'fight'

/** The jobs a work base is scored for, matching the Builds view's default. */
const WORK_JOBS = ['Mining', 'Deforest']

/**
 * One side for a purpose — the one the bred pal would be doing it from.
 *
 * Fighting and travel happen in the party. Working happens at a base, so the
 * trainer-side craft speed the Builds view also lists does not count. A breeding
 * base is both the pal working it and the pal on the farm, so the two sides'
 * wants are pooled.
 *
 * Fishing, food, cakes and ranching are left out: no displayable passive
 * touches them (see `sidesFor`), so every outcome would score zero.
 */
export function pairSpec(goal: GoalId): SideSpec {
  const sides = sidesFor(goal, {
    work: goal === 'breeding' ? BREEDING_WORK : WORK_JOBS,
    opponentElements: [],
    attackElements: [],
  })
  if (goal === 'work') return sides.find((s) => s.side === 'base')!
  if (goal === 'breeding') {
    return {
      side: 'base',
      want: sides.flatMap((s) => s.want),
      extra: sides.flatMap((s) => s.extra),
    }
  }
  return sides[0]!
}
