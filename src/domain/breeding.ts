/**
 * Palworld's breeding rules, and paths through them.
 *
 * ## Where the rules come from
 *
 * `breedingdata.json` upstream ships both the inputs (each species' position on
 * the breeding ladder, plus 253 hand-authored exceptions) and four precomputed
 * pair→child tables. This module derives the tables instead. That is not a guess
 * — the formula below was checked against all 46,355 pairs in those tables and
 * disagrees with none of them, which is why ~67 KB of input replaces 2.7 MB of
 * lookup.
 *
 * ## The two assumptions the answers rest on
 *
 * **Breeding does not consume the parents.** So reachability is a monotone
 * closure rather than an allocation problem: one pal can be a parent in
 * unlimited pairs, and no step "uses up" an earlier one.
 *
 * **Gender is concrete at the root and a coin flip after it.** A pair of species
 * you *own* is only breedable if you hold opposite genders across the two, and a
 * same-species pair needs both a male and a female of it. Anything you have
 * *bred*, though, is treated as available in either gender — offspring gender is
 * a 50/50 roll and the player can hatch again. That is optimistic in exactly one
 * direction, so the view says so rather than leaving it implied.
 *
 * Pals whose gender the save does not record, and pals with no owner at all, are
 * gaps to report, never stock to quietly fold in.
 */

import type { BreedingData } from '../refdata/refdata.ts'
import type { Gender, Guid, Pal, SaveIndex } from './types.ts'
import { ivTotal } from './index.ts'

/* -------------------------------------------------------------------------
   The table
   ------------------------------------------------------------------------- */

export interface BreedingTable {
  /** Lowercased asset id → combi rank. The universe: 304 species. */
  rank: Map<string, number>
  /** Ids the formula may produce, ascending by rank. 183 of the 304. */
  candidates: string[]
  /**
   * Averaged parent rank → the child it resolves to.
   *
   * Indexed by target, so `childOf` is an array read rather than a scan over
   * 183 candidates. Spans the full rank range, not just the candidates': one
   * species carries a sentinel 9999 while the top candidate is 3080, so a
   * target can land well above every real child and must clamp to the top one.
   */
  byTarget: (string | undefined)[]
  /** `a|b` with ids sorted → child, so either argument order finds it. */
  unique: Map<string, string>
  /**
   * Species that two *different* species can never produce.
   *
   * Deliberately not called "unbreedable". Rule 2 of `childOf` matches the
   * same-species case before the candidate set is ever consulted, so a male and
   * a female of one of these still breed true — the pair just cannot be
   * anything else. Five species are in neither this app's nor upstream's
   * child tables, and saying they "cannot be bred" would be a lie.
   */
  crossSpeciesImpossible: Set<string>
}

/** `a|b` with the ids sorted, so a pair has one key whichever way round. */
export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

export function buildBreedingTable(data: BreedingData): BreedingTable {
  const rank = new Map<string, number>()
  for (const [id, info] of Object.entries(data.pals)) {
    rank.set(id, info.combiRank)
  }

  const unique = new Map<string, string>()
  const uniqueChildren = new Set<string>()
  for (const c of data.uniqueCombos) {
    // `X × X → X` entries are dropped. They are redundant against rule 2 of
    // `childOf`, which already breeds every species true with itself, and
    // keeping them actively misleads in two places:
    //
    // - 26 species — the legendaries, Jetragon and Frostallion among them —
    //   have *only* a self-referential combo. Treating that as a unique combo
    //   makes them look reachable via a pairing and produces the advice "you
    //   need a Jetragon, which you cannot breed". They belong in
    //   `crossSpeciesImpossible`: catch two, or do without.
    // - 90 more carry a self entry *alongside* a real pair, where it is noise
    //   in any list of what a player is actually missing.
    if (c.a === c.b && c.child === c.a) continue
    unique.set(pairKey(c.a, c.b), c.child)
    uniqueChildren.add(c.child)
  }

  // What the generic formula is allowed to produce. Two exclusions: species
  // flagged `ignoreCombi` (they can still be parents), and any species that a
  // unique combo produces — those are reachable only through their own combo.
  //
  // Sorted by rank, with the id as a secondary key. The 183 ranks are in fact
  // all distinct, so the id never decides anything today; it is here so that a
  // future data refresh introducing a collision cannot make `childOf`
  // non-deterministic between two runs over the same input.
  const candidates = [...rank.keys()]
    .filter((id) => !data.pals[id]?.ignoreCombi && !uniqueChildren.has(id))
    .sort((x, y) => rank.get(x)! - rank.get(y)! || x.localeCompare(y))

  // Neither producible by the formula nor by an exception. A unique-combo child
  // is excluded from `candidates` but two different species *do* produce it —
  // just only the one specific pair — so it does not belong here.
  const candidateSet = new Set(candidates)
  const crossSpeciesImpossible = new Set(
    [...rank.keys()].filter(
      (id) => !candidateSet.has(id) && !uniqueChildren.has(id),
    ),
  )

  return {
    rank,
    candidates,
    byTarget: buildTargets(candidates, rank),
    unique,
    crossSpeciesImpossible,
  }
}

/**
 * One sweep up the rank axis, rather than a nearest-search per lookup.
 *
 * `hi` is the first candidate at or above the target and `lo` the one below it,
 * both advancing monotonically, so the whole array costs one pass.
 */
function buildTargets(
  candidates: string[],
  rank: Map<string, number>,
): (string | undefined)[] {
  if (candidates.length === 0) return []

  const max = Math.max(...rank.values())
  const out: (string | undefined)[] = new Array(max + 1)
  let hi = 0

  for (let t = 0; t <= max; t++) {
    while (hi < candidates.length && rank.get(candidates[hi]!)! < t) hi++
    const lo = hi - 1
    const dHi =
      hi < candidates.length ? rank.get(candidates[hi]!)! - t : Infinity
    const dLo = lo >= 0 ? t - rank.get(candidates[lo]!)! : Infinity
    // `<=` is the tie rule: equidistant candidates resolve to the HIGHER rank.
    // The direction is load-bearing — the other way round produces the wrong
    // child for 182 of the 906 reachable targets.
    out[t] = dHi <= dLo ? candidates[hi] : candidates[lo]
  }

  return out
}

/**
 * What a pair produces, or nothing if either species is unknown here.
 *
 * The order of the three branches *is* the specification.
 */
export function childOf(
  table: BreedingTable,
  a: string,
  b: string,
): string | undefined {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  const rx = table.rank.get(x)
  const ry = table.rank.get(y)
  if (rx === undefined || ry === undefined) return undefined

  // 1. Exceptions beat the formula. Upstream's own tables list 212 pairs under
  //    two different children — the unique-combo one and the formula one — and
  //    the unique combo is what the game actually does.
  const exception = table.unique.get(pairKey(x, y))
  if (exception) return exception

  // 2. A species breeds true with itself, variants and `ignoreCombi` species
  //    included. Checked before the candidate set, which is why an
  //    `ignoreCombi` species is not the same thing as an unbreedable one.
  if (x === y) return x

  // 3. Otherwise the ranks average — rounding up, so the two argument orders
  //    cannot disagree — and the nearest producible species wins.
  return table.byTarget[Math.floor((rx + ry + 1) / 2)]
}

/* -------------------------------------------------------------------------
   Stock: what one player actually has
   ------------------------------------------------------------------------- */

export interface StockSpecies {
  id: string
  male: Pal[]
  female: Pal[]
  /** Gender absent from the save. Reported, not assumed either way. */
  unknown: Pal[]
}

export interface Stock {
  ownerUid: Guid
  bySpecies: Map<string, StockSpecies>
  /** Pals that made it into `bySpecies`. */
  counted: number
  /** Owned pals whose gender the save does not record. */
  skippedNoGender: number
  /** Owned pals of a species the breeding data has never heard of. */
  skippedUnknownSpecies: number
  /** Pals anywhere in this world with no owner — they count for nobody. */
  unownedInWorld: number
  /** Held in one gender only, so they cannot pair with themselves. */
  singleGender: string[]
  /** Whether unknown-gender pals were folded in at the caller's request. */
  assumedUnknownGender: boolean
}

/**
 * One player's breeding stock.
 *
 * `palsByOwner` is the whole point: it is keyed on `ownerPlayerUid`, so this is
 * "the pals this player owns" and never the guild's. A pal a guildmate caught
 * is not one this player can put in a breeding pen.
 */
export function buildStock(
  index: SaveIndex,
  table: BreedingTable | undefined,
  ownerUid: Guid | undefined,
  opts: { assumeUnknownGender?: boolean } = {},
): Stock {
  const assumedUnknownGender = opts.assumeUnknownGender === true
  const bySpecies = new Map<string, StockSpecies>()
  let counted = 0
  let skippedNoGender = 0
  let skippedUnknownSpecies = 0

  for (const pal of ownerUid ? (index.palsByOwner.get(ownerUid) ?? []) : []) {
    // Lowercased on the way in. Level-save ids are not, reference data is —
    // the casing trap that bites every lookup in this app.
    const id = pal.characterId.toLowerCase()
    if (table && !table.rank.has(id)) {
      skippedUnknownSpecies++
      continue
    }

    let entry = bySpecies.get(id)
    if (!entry) {
      entry = { id, male: [], female: [], unknown: [] }
      bySpecies.set(id, entry)
    }

    if (pal.gender === 'Male') entry.male.push(pal)
    else if (pal.gender === 'Female') entry.female.push(pal)
    else {
      entry.unknown.push(pal)
      skippedNoGender++
    }
    counted++
  }

  // Asked for explicitly, and still reported in `skippedNoGender` either way —
  // the count is what the footer needs to stay honest about the assumption.
  if (assumedUnknownGender) {
    for (const entry of bySpecies.values()) {
      for (const pal of entry.unknown) {
        if (entry.male.length <= entry.female.length) entry.male.push(pal)
        else entry.female.push(pal)
      }
    }
  }

  // The one gap the per-owner map cannot show. A single pass over ~1,100 pals.
  let unownedInWorld = 0
  for (const pal of index.pals) if (!pal.ownerPlayerUid) unownedInWorld++

  const singleGender = [...bySpecies.values()]
    .filter((s) => s.male.length === 0 || s.female.length === 0)
    .map((s) => s.id)

  return {
    ownerUid: ownerUid ?? '',
    bySpecies,
    counted,
    skippedNoGender,
    skippedUnknownSpecies,
    unownedInWorld,
    singleGender,
    assumedUnknownGender,
  }
}

/* -------------------------------------------------------------------------
   Reachability
   ------------------------------------------------------------------------- */

export interface BreedPair {
  a: string
  b: string
}

export interface Reach {
  /** Species → generations from the stock. 0 means already owned. */
  depth: Map<string, number>
  /** Species → every pair that first produced it, at its minimal depth. */
  parents: Map<string, BreedPair[]>
  /**
   * Species → how many eggs its cheapest subtree costs. 0 means owned.
   *
   * Distinct from `depth`, and the distinction matters more than it sounds.
   * Minimising *generations* produces routes that are shallow and enormously
   * wide — against a real save, the fewest-generations path to Anubis was twelve
   * deep and fifty-one eggs, which is a true answer to a question nobody asked.
   * Players hatch eggs, so eggs are the cost.
   */
  cost: Map<string, number>
  /** Species → the pair achieving `cost`. */
  best: Map<string, BreedPair>
  rounds: number
}

/**
 * A guard against a future data change introducing a pathological ladder, not
 * an expected limit. Real stocks converge in three to eight rounds.
 */
const MAX_ROUNDS = 24

/**
 * Everything this stock can reach, and how it got there.
 *
 * Rounds are committed at the end of each pass rather than as pairs are found,
 * so a species records *all* the pairs that reach it at its minimal depth. That
 * is where the alternate routes come from — finding one pair and moving on would
 * make the "4 other routes" count silently wrong.
 *
 * Cost: at most 304 available species, so 304·305/2 ≈ 46,400 unordered pairs per
 * round, each a couple of map reads. Measured at 70–85 ms over a real save with
 * 60–70 species in stock, converging in 9–11 rounds.
 *
 * That is why the view memoises this on the player rather than on the target:
 * once per player selection is unnoticeable, once per click in a 304-row species
 * list would not be. Planning a single target against a finished closure is
 * 5–8 ms, which is the interaction that actually repeats.
 */
export function reachFrom(stock: Stock, table: BreedingTable): Reach {
  const depth = new Map<string, number>()
  const parents = new Map<string, BreedPair[]>()

  /**
   * Whether a pair can actually be put in a pen.
   *
   * Only root×root pairs need a gender check: anything bred is available in
   * either gender by assumption, so it complements whatever it is paired with.
   * That collapse is why the closure carries no gender bookkeeping past round 1.
   */
  const breedable = (a: string, b: string): boolean => {
    const da = depth.get(a)
    const db = depth.get(b)
    if (da === undefined || db === undefined) return false
    if (da > 0 || db > 0) return true

    const sa = stock.bySpecies.get(a)
    const sb = stock.bySpecies.get(b)
    if (!sa || !sb) return false
    if (a === b) return sa.male.length > 0 && sa.female.length > 0
    return (
      (sa.male.length > 0 && sb.female.length > 0) ||
      (sa.female.length > 0 && sb.male.length > 0)
    )
  }

  for (const id of stock.bySpecies.keys()) depth.set(id, 0)

  let rounds = 0
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const available = [...depth.keys()]
    const found = new Map<string, BreedPair[]>()

    for (let i = 0; i < available.length; i++) {
      const a = available[i]!
      for (let j = i; j < available.length; j++) {
        const b = available[j]!
        if (!breedable(a, b)) continue
        const child = childOf(table, a, b)
        if (!child || depth.has(child)) continue
        const at = found.get(child)
        if (at) at.push({ a, b })
        else found.set(child, [{ a, b }])
      }
    }

    if (found.size === 0) break
    rounds = round
    for (const [child, pairs] of found) {
      depth.set(child, round)
      parents.set(child, pairs)
    }
  }

  return { depth, parents, ...costs(depth, parents), rounds }
}

/**
 * How many eggs each species costs, cheapest-first.
 *
 * Filled in increasing `depth` order, which is what makes a single pass
 * sufficient: every pair recorded for a species has both parents at a strictly
 * smaller depth, so their costs are already final by the time this reads them.
 *
 * The sum `1 + cost(a) + cost(b)` deliberately ignores the saving when two
 * branches share an intermediate — counting that exactly is the NP-hard version
 * of this problem. It therefore over-estimates, never under-estimates, and the
 * step list dedupes the sharing afterwards, so the number the user is shown is
 * the real one.
 */
function costs(
  depth: Map<string, number>,
  parents: Map<string, BreedPair[]>,
): { cost: Map<string, number>; best: Map<string, BreedPair> } {
  const cost = new Map<string, number>()
  const best = new Map<string, BreedPair>()

  const byDepth = [...depth.entries()].sort((x, y) => x[1] - y[1])
  for (const [species, d] of byDepth) {
    if (d === 0) {
      cost.set(species, 0)
      continue
    }
    let cheapest = Infinity
    let via: BreedPair | undefined
    for (const pair of parents.get(species) ?? []) {
      const ca = cost.get(pair.a)
      const cb = cost.get(pair.b)
      if (ca === undefined || cb === undefined) continue
      // Ties broken by id so the chosen route is stable across reloads.
      const total = 1 + ca + cb
      if (
        total < cheapest ||
        (total === cheapest &&
          via &&
          (pair.a + pair.b).localeCompare(via.a + via.b) < 0)
      ) {
        cheapest = total
        via = pair
      }
    }
    if (via) {
      cost.set(species, cheapest)
      best.set(species, via)
    }
  }

  return { cost, best }
}

/* -------------------------------------------------------------------------
   Planning a route to one target
   ------------------------------------------------------------------------- */

export type BreedNode =
  | {
      kind: 'owned'
      species: string
      /**
       * The specific pal to put in the pen — the highest-IV one of whichever
       * gender this side of the pair needs, since IVs pass down.
       */
      use?: Pal
      /**
       * Which gender this side must be.
       *
       * Decided for the pair, not per side. Choosing independently is how you
       * end up advising "Chikipi ♂ × Chikipi ♂", which is not a pairing.
       */
      gender?: Gender
      /** How many of this species the player holds, in any gender. */
      count: number
    }
  | { kind: 'bred'; species: string; a: BreedNode; b: BreedNode; step: number }

export interface BreedStep {
  /** 1-based execution order, roots first. */
  n: number
  /** The egg this step produces. */
  species: string
  a: BreedNode
  b: BreedNode
  /** Generations from the stock. */
  generation: number
  /** Same species on both sides: hatch until you have a male and a female. */
  selfPair: boolean
}

export interface Blocker {
  pair: BreedPair
  missing: { species: string; why: 'unreachable' | 'gender' }[]
}

export type PlanStatus = 'no-data' | 'not-in-data' | 'plan' | 'unreachable'

export type PlanReason =
  | 'cross-species-impossible'
  | 'needs-unique-parents'
  | 'no-stock'
  | 'nothing-produces-it'

export interface BreedingPlan {
  target: string
  status: PlanStatus
  reason?: PlanReason
  /** Instances the player already holds. Independent of `status`. */
  ownedTarget: Pal[]
  /** Execution order, distinct species only — a shared intermediate is one step. */
  steps: BreedStep[]
  /** The same plan nested. Shared intermediates repeat here, on purpose. */
  tree?: BreedNode
  /** Tree height. `steps.length` is the number of eggs to hatch. */
  generations: number
  /** Every minimal-generation first pair, so the UI can offer other routes. */
  options: BreedPair[]
  /** Why each candidate route fails, when nothing works. */
  blockers: Blocker[]
}

/**
 * The shortest route to one target, plus the alternates that tie with it.
 *
 * `prefer` pins a first pair so an alternate route can live in a link. A stale
 * one that no longer appears in `options` is ignored rather than honoured — a
 * link from a different save must not produce a route this player cannot walk.
 */
export function planFor(
  table: BreedingTable | undefined,
  reach: Reach | undefined,
  stock: Stock,
  target: string,
  prefer?: BreedPair,
): BreedingPlan {
  const id = target.toLowerCase()
  const ownedTarget = [
    ...(stock.bySpecies.get(id)?.male ?? []),
    ...(stock.bySpecies.get(id)?.female ?? []),
    ...(stock.bySpecies.get(id)?.unknown ?? []),
  ]

  const empty: BreedingPlan = {
    target: id,
    status: 'no-data',
    ownedTarget,
    steps: [],
    generations: 0,
    options: [],
    blockers: [],
  }

  if (!table || !reach) return empty
  if (!table.rank.has(id)) return { ...empty, status: 'not-in-data' }

  const available = [...reach.depth.keys()]

  // Enumerated even when the target is already owned. The closure only assigns
  // parents to species it had to *reach*, so an owned target has none — and
  // "breed another one" is a perfectly reasonable thing to ask.
  const pairs: BreedPair[] = []
  for (let i = 0; i < available.length; i++) {
    const a = available[i]!
    for (let j = i; j < available.length; j++) {
      const b = available[j]!
      if (childOf(table, a, b) !== id) continue
      if (!pairBreedable(stock, reach, a, b)) continue
      pairs.push({ a, b })
    }
  }

  if (pairs.length === 0) {
    return {
      ...empty,
      status: 'unreachable',
      reason: diagnose(table, reach, stock, id),
      blockers: blockersFor(table, reach, stock, id),
    }
  }

  // Eggs, not generations. A pair whose parents are both already owned costs one
  // egg however deep in the ladder they sit; a pair of deep intermediates costs
  // everything underneath them.
  const eggs = (p: BreedPair) =>
    1 + (reach.cost.get(p.a) ?? Infinity) + (reach.cost.get(p.b) ?? Infinity)
  const cheapest = Math.min(...pairs.map(eggs))
  const options = pairs
    .filter((p) => eggs(p) === cheapest)
    // Deterministic, so `options[0]` is the same pair across runs and reloads.
    // Map iteration order plus an unstable sort is exactly how this feature
    // would otherwise develop a personality between two loads of one save.
    .sort((p, q) => p.a.localeCompare(q.a) || p.b.localeCompare(q.b))

  const chosen =
    (prefer &&
      options.find(
        (o) =>
          pairKey(o.a, o.b) ===
          pairKey(prefer.a.toLowerCase(), prefer.b.toLowerCase()),
      )) ||
    options[0]!

  const steps: BreedStep[] = []
  const stepOf = new Map<string, number>()
  // `chosen` is passed so the top level expands through the pair even when the
  // target is already owned — otherwise "breed another Chikipi" would render as
  // a plan with no steps in it.
  const tree = expand(table, reach, stock, id, chosen, steps, stepOf, 0)

  return {
    target: id,
    status: 'plan',
    ownedTarget,
    steps,
    tree,
    generations: height(tree),
    options,
    blockers: [],
  }
}

/** Generations is the tree's height — how many rounds of hatching deep it goes. */
function height(node: BreedNode): number {
  return node.kind === 'owned'
    ? 0
    : 1 + Math.max(height(node.a), height(node.b))
}

/** The gender rule again, against a finished closure rather than a live one. */
function pairBreedable(
  stock: Stock,
  reach: Reach,
  a: string,
  b: string,
): boolean {
  const da = reach.depth.get(a)
  const db = reach.depth.get(b)
  if (da === undefined || db === undefined) return false
  if (da > 0 || db > 0) return true

  const sa = stock.bySpecies.get(a)
  const sb = stock.bySpecies.get(b)
  if (!sa || !sb) return false
  if (a === b) return sa.male.length > 0 && sa.female.length > 0
  return (
    (sa.male.length > 0 && sb.female.length > 0) ||
    (sa.female.length > 0 && sb.male.length > 0)
  )
}

/**
 * Builds the tree, appending each distinct derived species to `steps` once.
 *
 * Parents always sit at a strictly smaller depth, so this terminates on the
 * data as it stands; the depth budget is there because that guarantee lives in
 * a data file rather than in the code.
 */
function expand(
  table: BreedingTable,
  reach: Reach,
  stock: Stock,
  species: string,
  via: BreedPair | undefined,
  steps: BreedStep[],
  stepOf: Map<string, number>,
  budget: number,
  want?: Gender,
): BreedNode {
  const entry = stock.bySpecies.get(species)
  const depth = reach.depth.get(species) ?? 0
  const blank: StockSpecies = { id: species, male: [], female: [], unknown: [] }

  // `via` is only set by the top-level call, which is what lets an owned target
  // still be expanded into "and here is how to breed another".
  if (!via && depth === 0 && entry) return ownedNode(entry, want)
  if (budget > MAX_ROUNDS) return ownedNode(entry ?? blank, want)

  const pair = via ?? reach.best.get(species)
  if (!pair) return ownedNode(entry ?? blank, want)

  // Genders are settled here, for the pair as a whole, before either side is
  // built. Only a root×root pair is constrained — a bred parent can be hatched
  // again for the other roll, so it takes whatever is left.
  const [wantA, wantB] = assignGenders(stock, reach, pair)

  const a = expand(table, reach, stock, pair.a, undefined, steps, stepOf, budget + 1, wantA) // prettier-ignore
  const b = expand(table, reach, stock, pair.b, undefined, steps, stepOf, budget + 1, wantB) // prettier-ignore

  // A shared intermediate is one egg, not two, so it gets one step number and
  // the tree points both of its uses at the same one.
  let n = stepOf.get(species)
  if (n === undefined) {
    n = steps.length + 1
    stepOf.set(species, n)
    steps.push({
      n,
      species,
      a,
      b,
      generation: depth,
      selfPair: pair.a === pair.b,
    })
  }

  return { kind: 'bred', species, a, b, step: n }
}

/**
 * Which gender each side of a root pair has to be.
 *
 * `undefined` means unconstrained — the side is a bred intermediate, so the
 * player hatches until it comes out right. A same-species root pair is the case
 * that forces the issue: one of each, or it is not a pairing at all.
 */
function assignGenders(
  stock: Stock,
  reach: Reach,
  pair: BreedPair,
): [Gender | undefined, Gender | undefined] {
  const rootA = (reach.depth.get(pair.a) ?? 0) === 0
  const rootB = (reach.depth.get(pair.b) ?? 0) === 0
  if (!rootA || !rootB) return [undefined, undefined]

  const sa = stock.bySpecies.get(pair.a)
  const sb = stock.bySpecies.get(pair.b)
  if (pair.a === pair.b) return ['Male', 'Female']

  // `reachFrom` already proved one of these two orientations works; this picks
  // whichever it was.
  if ((sa?.male.length ?? 0) > 0 && (sb?.female.length ?? 0) > 0) {
    return ['Male', 'Female']
  }
  return ['Female', 'Male']
}

/** The best instance of the gender this side needs — high IVs pass down. */
function ownedNode(entry: StockSpecies, want?: Gender): BreedNode {
  const bestOf = (pals: Pal[]) =>
    pals.length === 0
      ? undefined
      : [...pals].sort((x, y) => ivTotal(y) - ivTotal(x))[0]

  const pool =
    want === 'Male' ? entry.male : want === 'Female' ? entry.female : []
  // With no constraint, show whichever gender they actually have.
  const use = bestOf(pool) ?? (want ? undefined : bestOf([...entry.male, ...entry.female])) // prettier-ignore

  return {
    kind: 'owned',
    species: entry.id,
    use,
    gender: want ?? use?.gender,
    count: entry.male.length + entry.female.length + entry.unknown.length,
  }
}

/**
 * Why there is no route — in order, because the specific reasons are the
 * useful ones and "nothing produces it" is only true once they are ruled out.
 */
function diagnose(
  table: BreedingTable,
  reach: Reach,
  stock: Stock,
  id: string,
): PlanReason {
  if (stock.counted === 0 || reach.depth.size === 0) return 'no-stock'
  const isUniqueChild = [...table.unique.values()].includes(id)
  if (isUniqueChild) return 'needs-unique-parents'
  if (table.crossSpeciesImpossible.has(id)) return 'cross-species-impossible'
  return 'nothing-produces-it'
}

/**
 * For a unique-combo target, which specific parent is the problem.
 *
 * The most useful message in the feature: the targets people actually want are
 * nearly all unique-combo children, and "you need a Kitsun you cannot reach"
 * is actionable where "no route" is not.
 */
function blockersFor(
  table: BreedingTable,
  reach: Reach,
  stock: Stock,
  id: string,
): Blocker[] {
  const out: Blocker[] = []
  for (const [key, child] of table.unique) {
    if (child !== id) continue
    const [a, b] = key.split('|') as [string, string]
    const missing: Blocker['missing'] = []
    for (const parent of a === b ? [a] : [a, b]) {
      if (!reach.depth.has(parent)) {
        missing.push({ species: parent, why: 'unreachable' })
      }
    }
    if (missing.length === 0 && !pairBreedable(stock, reach, a, b)) {
      missing.push({ species: a, why: 'gender' })
    }
    out.push({ pair: { a, b }, missing })
  }
  return out
}
