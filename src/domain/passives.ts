/**
 * Passive inheritance: the odds, and who carries what.
 *
 * ## Where the numbers come from, and where they do not
 *
 * Everything else this app computes is derived from the save or from
 * PalworldSaveTools' data files. This module is the exception, and it says so
 * loudly: `breedingdata.json` carries combi ranks and unique combos and nothing
 * whatsoever about passive inheritance, so there is no upstream table to check
 * against the way `pnpm verify:breeding` checks the combi formula against all
 * 46,355 of its pairs. The game's own exported tables contain no inheritance
 * probabilities either — no per-passive chance, no count, no reroll odds.
 *
 * {@link INHERIT_COUNT} is therefore community reverse engineering from a
 * sampled build, held in one named constant so that a better number is a
 * one-line change and every route re-ranks correctly behind it. Nothing else in
 * here is a guess — given that one array, the rest is arithmetic.
 *
 * ## The rule being modelled
 *
 * Five steps, in this order:
 *
 * 1. Both parents' passive lists are combined and deduplicated — one pool.
 * 2. Roll `x` from {@link INHERIT_COUNT} — how many to inherit from that pool.
 *    **An upper limit, not a requirement**: a pool smaller than the roll is
 *    inherited whole.
 * 3. Take that many from the pool, uniformly at random.
 * 4. Roll `y` from the *same* distribution. The child gets `max(0, y - x)`
 *    random passives from the global table — measured against the number
 *    **rolled**, not the number actually inherited.
 * 5. Add them until that count is reached or the four-slot limit is hit.
 *
 * Step 4 is the one place two readings exist. An earlier version of this file
 * rolled the second count independently, which is a guess this code had no
 * evidence for; the coupled form above is what the wiki describes and is the
 * more specific account, so it is what is implemented. Neither is
 * decompilation-grade. The difference is entirely in the junk rate — a mean of
 * 0.54 extra passives per hatch rather than 1.0 — and junk is what drives the
 * "bigger pool is worse" result, so it is worth knowing which is in force.
 *
 * Two consequences drive the whole planner:
 *
 * - A passive reaches the final egg only through an unbroken chain of parents
 *   carrying it. Step 4 can technically produce one, but the random-eligible
 *   pool is the 85 passives flagged `add_pal` upstream, and the draw is
 *   *weighted* — the game's `DT_PassiveSkill_Main` has a `LotteryWeight` column
 *   that no public export carries. So even "1 in 85" is a uniform upper bound
 *   rather than a probability, and it is modelled as never supplying a wanted
 *   passive: a lottery ticket is not a route.
 * - **A bigger pool is worse.** Junk competes for the same slots, and step 4
 *   adds one junk passive per hatch on average whatever you do. Two clean
 *   parents beat two loaded ones, which is why the planner picks the *cleanest*
 *   carrier rather than the best one, and why junk is tracked rather than
 *   ignored.
 *
 * The arithmetic that follows is the reason the feature exists. One wanted
 * passive from a pool of four is an even-money hatch; four specific ones from
 * two fully loaded parents is about 700 eggs. A planner that could not tell
 * those apart would be worse than none.
 *
 * ## What is assumed, and in which direction
 *
 * Every assumption here leans pessimistic on purpose — a planner that flattered
 * itself would be worse than no planner:
 *
 * - The two parents' junk is assumed **disjoint**, which over-states the pool.
 *   Knowably wrong when a player happens to own two pals sharing a trait.
 * - Random fills are assumed never to be a passive you wanted.
 * - Special breeding cakes override step 2 and force all four parental passives
 *   down. Not modelled, so a player using them does better than shown.
 * - A passive can be put on an existing pal outright, at the Pal Surgery Table,
 *   for gold and an implant. Nothing here knows that, so the planner may advise
 *   a long grind for something purchasable. Likewise the Pal Merchant and Black
 *   Marketeer sell pals whose passives can be read before buying, and their
 *   stock rerolls on reload — often a faster way to a carrier than breeding one.
 */

import type { Pal } from './types.ts'

/**
 * Passive slots on a pal. The reason every quantity in this file is a small
 * integer: the inherit count is 1–4, one parent's pool is 0–4, and the union of
 * two parents is 0–8. Nothing here needs a factorial at runtime.
 */
export const MAX_SLOTS = 4

/** The largest union pool two parents can present. */
const MAX_POOL = MAX_SLOTS * 2

/**
 * How many passives a child inherits from its parents' pool, by probability.
 *
 * Indexed by count, so `INHERIT_COUNT[2]` is the chance of inheriting two.
 * Index 0 is present and zero: every hatch inherits at least one when the
 * parents have anything between them.
 *
 * **Community reverse engineering, not game data.** See the module header.
 */
export const INHERIT_COUNT: readonly number[] = [0, 0.4, 0.3, 0.2, 0.1]

/* -------------------------------------------------------------------------
   The odds
   ------------------------------------------------------------------------- */

/** Binomial coefficients up to the only sizes this file ever asks for. */
const CHOOSE: number[][] = (() => {
  const c: number[][] = []
  for (let n = 0; n <= MAX_POOL; n++) {
    c[n] = [1]
    for (let k = 1; k <= n; k++) {
      c[n]![k] = (c[n - 1]![k - 1] ?? 0) + (c[n - 1]![k] ?? 0)
    }
  }
  return c
})()

function choose(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0
  return CHOOSE[n]![k] ?? 0
}

/**
 * The chance a hatch from a pool of `m` carries all `k` passives you want,
 * ignoring what else comes along.
 *
 * ```
 * p(m, k) = Σ  P(n) · [ m ≤ n ? 1 : C(m−k, n−k) / C(m, n) ]
 * ```
 *
 * `C(m−k, n−k)/C(m, n)` is the hypergeometric chance that a uniform n-subset of
 * the pool contains all k wanted items; the `m ≤ n` branch is the case where the
 * child inherits the whole pool and no draw happens.
 *
 * The planner uses {@link combine} rather than this, because it has to price the
 * junk too. This is the legible form of the same rule — the one worth reading to
 * understand the feature, and the one the tests pin the distribution against.
 */
export function pInherit(pool: number, needed: number): number {
  if (needed <= 0) return 1
  if (needed > MAX_SLOTS || needed > pool) return 0
  const m = Math.min(pool, MAX_POOL)
  let total = 0
  for (let n = 1; n < INHERIT_COUNT.length; n++) {
    const p = INHERIT_COUNT[n]!
    if (p === 0) continue
    total += p * (m <= n ? 1 : choose(m - needed, n - needed) / choose(m, n))
  }
  return total
}

/**
 * Hatches to expect before one comes out right.
 *
 * `Infinity` for an impossible ask, which is what keeps a route the wanted
 * passives cannot survive out of the search rather than merely last in it.
 */
export function expectedEggs(p: number): number {
  return p > 0 ? 1 / p : Infinity
}

/* -------------------------------------------------------------------------
   Profiles
   ------------------------------------------------------------------------- */

/**
 * A pal reduced to what the planner needs: which wanted passives it carries,
 * and how many other ones are in the way.
 *
 * Junk is a **count, not a set**, which is what keeps the state space small
 * enough to search. The cost is the disjoint-junk assumption in {@link combine};
 * the benefit is that a target of four passives has only 48 distinct profiles,
 * so a pal's whole relevance to a route fits in two small integers.
 *
 * `popcount(mask) + junk` never exceeds {@link MAX_SLOTS}.
 */
export interface Profile {
  /** Bits of the wanted set this pal carries. */
  mask: number
  /** Its other passives, as a count. */
  junk: number
}

/** One outcome a pair can hatch, and how likely it is. */
export interface Outcome extends Profile {
  prob: number
}

/**
 * Every profile a pair can produce, and with what probability.
 *
 * The full joint distribution over (which wanted passives, how much junk),
 * because the two cannot be priced separately: the junk a child arrives with is
 * exactly what dilutes the *next* generation, and a model that tracked only the
 * wanted passives would be optimistic by roughly a factor of two per step,
 * compounding all the way down a route.
 *
 * Walks the five steps of the rule directly. `v` of the `w` wanted passives in
 * the pool are drawn along with `u` of the `J` junk ones — a multivariate
 * hypergeometric — and then step 4 tops the child up with random junk to
 * whatever the four-slot limit allows.
 *
 * Memoised on the pair of profiles, since the search asks the same few thousand
 * questions millions of times.
 */
export function combine(a: Profile, b: Profile): Outcome[] {
  const key = packPair(a, b)
  const hit = COMBINE_CACHE.get(key)
  if (hit) return hit
  const out = computeCombine(a, b)
  COMBINE_CACHE.set(key, out)
  return out
}

const COMBINE_CACHE = new Map<number, Outcome[]>()

/** Order-independent, because a pair is unordered and so is its outcome. */
function packPair(a: Profile, b: Profile): number {
  const x = (a.mask << 3) | a.junk
  const y = (b.mask << 3) | b.junk
  return x <= y ? (x << 7) | y : (y << 7) | x
}

function computeCombine(a: Profile, b: Profile): Outcome[] {
  const union = a.mask | b.mask
  const wantedBits = bitsOf(union)
  const w = wantedBits.length
  // THE assumption, in one expression: neither parent's junk is the other's.
  // Over-states the pool, so it under-states the odds, which is the direction
  // this whole feature errs in on purpose.
  const junk = Math.min(a.junk + b.junk, MAX_POOL - w)
  const m = w + junk

  const acc = new Map<number, number>()
  const add = (mask: number, j: number, p: number) => {
    if (p <= 0) return
    const k = (mask << 3) | j
    acc.set(k, (acc.get(k) ?? 0) + p)
  }

  if (m === 0) {
    // Two blank parents still get the second roll's fills, and nothing else.
    // With nothing inherited the first roll is still made, so the difference
    // `y - x` is what lands.
    for (let x = 1; x < INHERIT_COUNT.length; x++) {
      for (let y = 1; y < INHERIT_COUNT.length; y++) {
        const filled = Math.min(Math.max(0, y - x), MAX_SLOTS)
        add(0, filled, INHERIT_COUNT[x]! * INHERIT_COUNT[y]!)
      }
    }
    return finish(acc)
  }

  for (let x = 1; x < INHERIT_COUNT.length; x++) {
    const pn = INHERIT_COUNT[x]!
    if (pn === 0) continue
    // The first roll is a ceiling: a pool smaller than it is taken whole.
    const t = Math.min(x, m)

    for (let v = Math.max(0, t - junk); v <= Math.min(t, w); v++) {
      const u = t - v
      // Multivariate hypergeometric, then split evenly across which `v` of the
      // wanted passives were the ones drawn — they are interchangeable to the
      // game and distinguishable to us, which is the only reason to divide.
      const ways = choose(w, v) * choose(junk, u)
      if (ways === 0) continue
      const pDraw = (pn * ways) / choose(m, t)
      const perSubset = pDraw / choose(w, v)

      for (const drawn of subsetsOfSize(wantedBits, v)) {
        for (let y = 1; y < INHERIT_COUNT.length; y++) {
          // `y - x`, not `y - t`: the wiki is explicit that the second roll is
          // measured against the number *rolled*, not the number there were
          // actually enough passives to inherit. The four-slot limit then
          // truncates the fill rather than failing it.
          const filled = Math.min(Math.max(0, y - x), MAX_SLOTS - t)
          add(drawn, u + filled, perSubset * INHERIT_COUNT[y]!)
        }
      }
    }
  }

  return finish(acc)
}

function finish(acc: Map<number, number>): Outcome[] {
  const out: Outcome[] = []
  for (const [k, prob] of acc) {
    out.push({ mask: k >> 3, junk: k & 0b111, prob })
  }
  // Cleanest and richest first, so a consumer scanning for the best outcome
  // finds it early, and so two runs produce identical lists.
  return out.sort(
    (x, y) => y.mask - x.mask || x.junk - y.junk || y.prob - x.prob,
  )
}

/**
 * How likely one hatch from this pair is good enough.
 *
 * "Good enough" is `mask` *at least* and `junk` *at most* — a child that came
 * out carrying more of what you wanted, or less of what you did not, is not a
 * failure. This is the re-roll predicate, so its reciprocal is the eggs that
 * step costs, and it is what makes "strip the junk before you combine" fall out
 * of the search rather than have to be written into it.
 */
export function pAtLeast(
  a: Profile,
  b: Profile,
  mask: number,
  junk: number,
): number {
  let total = 0
  for (const o of combine(a, b)) {
    if ((o.mask & mask) === mask && o.junk <= junk) total += o.prob
  }
  // Clamped because it is a probability, and because summing a distribution in
  // floating point lands a certainty on 0.9999999999999998 — which would then
  // be shown as "1.0000000000000002 eggs expected".
  return Math.min(1, total)
}

/**
 * A profile packed into one integer: `mask × 8 + junk`.
 *
 * The search's inner loop runs billions of times, so it trades the readable
 * object for an integer everywhere it counts — and the object form stays, for
 * everywhere it does not.
 */
export function pack(p: Profile): number {
  return (p.mask << 3) | p.junk
}

export const PROFILES = 128

/**
 * Every goal a pair can be bred toward, and what each costs in hatches.
 *
 * The search's hot primitive, and shaped for it rather than for reading: a flat
 * `Float64Array` of `[packed goal, expected hatches, …]`, so walking it
 * allocates nothing and the reciprocal is already taken. Where {@link combine}
 * says what a hatch *will* be, this says what a hatch can be aimed at.
 *
 * Memoised on the packed pair. There are only 128 × 128 of those and most are
 * never asked for, so the table is a sparse array filled on demand and bounded
 * whatever the stock looks like.
 */
export function attainable(a: number, b: number): Float64Array {
  const key = a <= b ? a * PROFILES + b : b * PROFILES + a
  const hit = ATTAINABLE_CACHE[key]
  if (hit) return hit

  // Accumulated the cheap way round: each outcome contributes to every goal it
  // satisfies, rather than each goal re-scanning every outcome.
  const acc = new Map<number, number>()
  const pa = { mask: a >> 3, junk: a & 0b111 }
  const pb = { mask: b >> 3, junk: b & 0b111 }
  for (const o of combine(pa, pb)) {
    if (o.prob <= 0) continue
    for (const mask of subsets(o.mask)) {
      const room = MAX_SLOTS - popcount(mask)
      for (let j = o.junk; j <= room; j++) {
        const k = (mask << 3) | j
        acc.set(k, (acc.get(k) ?? 0) + o.prob)
      }
    }
  }

  // Strongest goal first — most of what you wanted, least junk. The search
  // reads entry zero to throw away a whole pair in one comparison, which is
  // most of why it finishes.
  const goals = [...acc.keys()].sort(
    (x, y) => popcount(y >> 3) - popcount(x >> 3) || (x & 0b111) - (y & 0b111),
  )
  const out = new Float64Array(goals.length * 2)
  for (let i = 0; i < goals.length; i++) {
    out[i * 2] = goals[i]!
    out[i * 2 + 1] = expectedEggs(Math.min(1, acc.get(goals[i]!)!))
  }
  ATTAINABLE_CACHE[key] = out
  return out
}

const ATTAINABLE_CACHE: (Float64Array | undefined)[] = []

/* -------------------------------------------------------------------------
   The wanted set
   ------------------------------------------------------------------------- */

/**
 * The passives being targeted, as bits.
 *
 * At most {@link MAX_SLOTS} of them, because that is how many a pal can hold —
 * so a mask fits in a nibble and "which of these does this pal carry" is one
 * integer rather than a set.
 */
export interface Wanted {
  /** Lowercased asset ids. Bit `i` is `ids[i]`. */
  ids: string[]
  /** Every bit set — the mask a finished target has to reach. */
  all: number
  /**
   * Asked for and dropped, because a pal cannot hold more than four.
   *
   * Reported rather than discarded: the picker caps the selection, but a link
   * can carry any number, and silently planning for a subset of what the URL
   * says would be the kind of quiet lie this app avoids elsewhere.
   */
  ignored: string[]
}

export function wantedFrom(ids: Iterable<string>): Wanted {
  const kept: string[] = []
  const ignored: string[] = []
  for (const raw of ids) {
    const id = raw.toLowerCase()
    if (!id || kept.includes(id) || ignored.includes(id)) continue
    if (kept.length < MAX_SLOTS) kept.push(id)
    else ignored.push(id)
  }
  return { ids: kept, all: (1 << kept.length) - 1, ignored }
}

/** Which of the wanted passives this pal carries, and how much else it has. */
export function profileOf(pal: Pal, wanted: Wanted): Profile {
  const owned = new Set(pal.passives.map((p) => p.toLowerCase()))
  let mask = 0
  for (let i = 0; i < wanted.ids.length; i++) {
    if (owned.has(wanted.ids[i]!)) mask |= 1 << i
  }
  // Clamped because a save can record more than four; the game shows four.
  return {
    mask,
    junk: Math.min(owned.size - popcount(mask), MAX_SLOTS - popcount(mask)),
  }
}

export function popcount(mask: number): number {
  let n = 0
  for (let m = mask; m !== 0; m >>= 1) n += m & 1
  return n
}

/**
 * Every subset of a mask, largest first.
 *
 * The standard submask enumeration. Largest first because the search relaxes
 * toward the target's full mask and finding it early prunes the rest; `0` is
 * included, since carrying nothing forward is a legitimate — and often
 * cheapest — thing for an intermediate to do.
 */
export function subsets(mask: number): number[] {
  const out: number[] = []
  for (let s = mask; ; s = (s - 1) & mask) {
    out.push(s)
    if (s === 0) break
  }
  return out
}

/** The set bits of a mask, low to high. */
function bitsOf(mask: number): number[] {
  const out: number[] = []
  for (let i = 0; (1 << i) <= mask; i++) if (mask & (1 << i)) out.push(1 << i)
  return out
}

/** Every `size`-sized combination of `bits`, as masks. */
function subsetsOfSize(bits: number[], size: number): number[] {
  if (size === 0) return [0]
  if (size === bits.length) return [bits.reduce((a, b) => a | b, 0)]
  const out: number[] = []
  const walk = (i: number, left: number, acc: number) => {
    if (left === 0) return out.push(acc)
    if (bits.length - i < left) return
    walk(i + 1, left - 1, acc | bits[i]!)
    walk(i + 1, left, acc)
  }
  walk(0, size, 0)
  return out
}

/* -------------------------------------------------------------------------
   Who carries what
   ------------------------------------------------------------------------- */

/**
 * How many pals in a pool carry each passive, keyed by lowercased asset id.
 *
 * Deliberately not `passiveFrequency` from `domain/guild.ts`: that one resolves
 * names, sorts, and truncates for a "most common passives" panel, and it keys on
 * the asset id in whatever casing the save wrote. This one is a lookup, so it
 * lowercases to match every other refdata-keyed map in the app, and keeps all of
 * them — a passive nobody carries has to be reportable as zero, not absent.
 */
export function carrierCounts(pals: Iterable<Pal>): Map<string, number> {
  const out = new Map<string, number>()
  for (const pal of pals) {
    // A save can list the same passive twice on one pal; it is still one carrier.
    for (const id of new Set(pal.passives.map((p) => p.toLowerCase()))) {
      out.set(id, (out.get(id) ?? 0) + 1)
    }
  }
  return out
}
