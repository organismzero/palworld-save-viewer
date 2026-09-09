/**
 * Breeding routes that carry the passives you asked for.
 *
 * ## Why this is a separate search and not a flag on the old one
 *
 * `breeding.ts` answers "how do I get that species" and answers it in eggs.
 * Naming passives changes the question rather than decorating it: the one-egg
 * route whose parents carry nothing is worthless if you wanted Legend on the
 * result, and a three-egg route through the two pals that actually carry your
 * passives is the real answer. The costs are not even in the same units — eggs
 * that have to go right, against hatches you expect to need.
 *
 * So the species engine is left exactly as it was, and `BreedView` branches:
 * no passives asked for, `planFor` runs and the answer is unchanged to the
 * byte. That parity is structural rather than emergent, which matters, because
 * this search is not merely different from `reachFrom` — it is *stronger*.
 * `reachFrom` only ever records the pairs that reach a species at its minimal
 * depth, so a cheaper route through a deeper parent is invisible to it. This one
 * has no such restriction and can legitimately beat it.
 *
 * ## The state, and why junk is part of it
 *
 * A state is **one species carrying one profile**: at least these wanted
 * passives, at most this much junk. Both halves are load-bearing.
 *
 * Tracking only "which passives" and hanging the junk count off the cheapest
 * route to it is the mistake that looks like an optimisation and is not: a pal
 * reached more cheaply but carrying more junk is *worse* for whatever consumes
 * it, because junk dilutes the next roll. Keeping one entry per (species, mask)
 * throws away the clean-but-costlier carrier that the next step actually needs.
 * A pal holds four passives, so the whole profile space is 48 entries for a
 * four-passive target — cheap enough that there is no excuse for getting it
 * wrong.
 *
 * A state used as a parent is priced as *exactly* its profile, not as whatever
 * it might luckily exceed. Pessimistic, like everything else here.
 *
 * ## The cost, and why Dijkstra still works
 *
 * ```
 * cost(x) = cost(a) + cost(b) + 1 / p(a, b → x)
 * ```
 *
 * the same recursion `costs()` uses with the constant 1 replaced by the hatches
 * that step expects, resting on the same assumption that **breeding does not
 * consume the parents**: obtain one good instance and it works forever.
 *
 * That is a *superior function* in Knuth's sense — non-decreasing in both
 * arguments and at least as large as either — so his 1977 generalisation of
 * Dijkstra applies directly. Settle the cheapest unsettled state, relax it
 * against everything already settled, and the answer is exact in one pass. No
 * rounds, no re-relaxation, no depth budget: unlike the species closure, cost
 * here is *not* monotone in generations, so a round-committed fixpoint would be
 * the wrong shape as well as slower.
 *
 * ## What it refuses to do
 *
 * Search forever. Odds decay fast enough that four specific passives off two
 * fully loaded parents is seven hundred eggs, and past {@link MAX_EXPECTED_EGGS}
 * the honest advice is "go and catch one", not a plan.
 *
 * The two limits are reported differently, on purpose. The egg ceiling is a
 * *decision* rather than a failure — a route beyond it was found and rejected —
 * so it surfaces as `passive-unreachable`, and the view names the number so the
 * player knows the difference between "impossible" and "not worth it". Only
 * {@link MAX_STATES}, which is a guard against a pathological stock rather than
 * an expected limit, sets `truncated`: that one means the search may have missed
 * a better answer, which is a different thing to admit.
 *
 * ## What it costs, measured
 *
 * `pnpm bench:passives`, against the reference save — 1,083 pals over 102
 * species, 258 of the 304 reachable:
 *
 * | passives wanted | search   | states  |
 * | --------------- | -------- | ------- |
 * | 1               | ~135 ms   | ~2,300  |
 * | 2               | ~650 ms   | ~4,100  |
 * | 3               | ~2.6 s    | ~7,200  |
 * | 4               | 10–11 s   | ~12,300 |
 *
 * Planning one target against a finished search is 10–35 ms, so the split that
 * makes the species list feel instant survives. The search itself does not fit
 * in a frame at any size, which is why it runs in `views/breed/search.worker.ts` rather
 * than in a memo — see that file for the reasoning.
 *
 * The growth is the state space, not the constant: 255 reachable species times
 * the 48 distinct (mask, junk) profiles a four-passive target admits is 12,240
 * states, and on a real stock essentially all of them are reachable *and*
 * non-dominated — a bigger mask always costs more and less junk always costs
 * more, so the whole grid is a genuine Pareto frontier. Three ways of cutting it
 * were measured and rejected, and are recorded here so they are not tried twice:
 *
 * - **Restrict to the target's ancestor cone.** The cone is 304 species of 304
 *   for a typical target: rank-averaging makes almost everything an ancestor of
 *   almost everything. It prunes nothing.
 * - **Cap the junk a bred intermediate may carry.** Sound but expensive in
 *   quality — capping at one costs 8% more eggs for 2.5× the speed, and capping
 *   at zero makes real targets unreachable. Junk earns its dimension.
 * - **Prune a state whose cost far exceeds the cheapest anywhere for its mask.**
 *   Unsound: the cheapest carrier of a mask is on some *other* species, so the
 *   rule throws away the state on the species actually being asked for.
 */

import {
  borrowedIn,
  childOf,
  height,
  planFor,
  type StepProgress,
  type BreedNode,
  type BreedPair,
  type BreedStep,
  type BreedingPlan,
  type BreedingTable,
  type Reach,
  type Stock,
} from './breeding.ts'
import {
  MAX_SLOTS,
  attainable,
  carrierCounts,
  expectedEggs,
  pAtLeast,
  popcount,
  profileOf,
  wantedFrom,
  type Profile,
  type Wanted,
} from './passives.ts'
import { ivTotal } from './index.ts'
import type { Gender, Guid, Pal } from './types.ts'

/**
 * Where a route stops being advice.
 *
 * Not a performance knob primarily — it is the point past which the answer is
 * useless. Two hundred hatches is a fortnight of evenings; the player wants to
 * hear "nobody you can reach carries this", not a plan they will abandon.
 */
export const MAX_EXPECTED_EGGS = 200


/** A guard against a pathological stock, not an expected limit. */
export const MAX_STATES = 20_000

/**
 * What a bred filler pal is assumed to carry.
 *
 * The mask-0 layer comes straight from `reach.cost`, which knows how many eggs
 * a species costs but nothing about what those eggs come out holding. Four is
 * the worst case and therefore the one to assume — which has the useful side
 * effect of making the planner prefer a clean pal you already own over a bred
 * one, exactly as a competent player would.
 */
const BRED_FILLER_JUNK = MAX_SLOTS


/* -------------------------------------------------------------------------
   States
   ------------------------------------------------------------------------- */

/**
 * A state, packed into one integer: `species × 128 + mask × 8 + junk`.
 *
 * Not premature. The relaxation loop runs the pair count times the goal count —
 * millions of times on a real stock — and the obvious `${species}|${mask}|${junk}`
 * string key allocates on every one of them. Against a five-species fixture that
 * alone was the difference between 170 ms and 4 ms, so the whole search runs on
 * flat typed arrays indexed by this and hands back a Map only at the end.
 *
 * A mask is four bits and junk is three, so 128 states per species is exact
 * rather than generous.
 */
const STRIDE = 128

/** The owned pals backing a root state, one per gender. */
interface RootPick {
  male?: Pal
  female?: Pal
}

export interface State {
  species: string
  profile: Profile
  /** Hatches expected to obtain one. Zero for a pal already in the box. */
  eggs: number
  /** The two states this is bred from. Absent for roots and bred fillers. */
  via?: { a: StateKey; b: StateKey }
  /** The specific pals, when this is a pal the player already holds. */
  root?: RootPick
  /**
   * How to breed another, when you already have one.
   *
   * A pal in the box costs nothing, so it beats every route to breeding one and
   * the search rightly stops looking. "Breed another" is still a fair question
   * though — it is half of what the Breed view is for — so the cheapest pair
   * that would have produced this state is kept here, off to the side, where it
   * cannot affect what anything is paired with. `planFor` makes the same
   * allowance for the same reason.
   */
  alt?: { eggs: number; via: { a: StateKey; b: StateKey } }
}

/*
 * A state with neither `via` nor `root` is a *filler*: a species the plain
 * closure reached, seeded here at its known egg cost with no passive to its
 * name. The plan splices `planFor`'s own subtree in for those rather than
 * inventing a second way to describe an ordinary breeding route. It needs no
 * flag of its own — having got here by neither route is the definition.
 */

/** `species|mask|junk`, for the plan's benefit rather than the search's. */
export type StateKey = string

export interface PassiveReach {
  /** What the search actually planned for: the ask, minus `missing`. */
  wanted: Wanted
  /** Everything the caller asked for, including what could not be searched. */
  asked: Wanted
  /** Settled states, keyed by species, mask and junk. */
  states: Map<StateKey, State>
  /** Asked-for passives no pal in the pool carries, so no route can deliver. */
  missing: string[]
  /** How many pals in the pool carry each wanted passive. */
  carriers: Map<string, number>
  /** The search stopped at a limit, so a better route may exist unfound. */
  truncated: boolean
  statesExplored: number
}

/* -------------------------------------------------------------------------
   The search
   ------------------------------------------------------------------------- */

/**
 * Everything this stock can breed while carrying the wanted passives.
 *
 * Keyed on the stock and the wanted set, not on the target, so clicking through
 * the species list stays as instant as it is today — the expensive work happens
 * when the passive selection changes, which is far rarer.
 */
export function reachWithPassives(
  stock: Stock,
  table: BreedingTable,
  reach: Reach,
  ids: Iterable<string>,
): PassiveReach {
  const carriers = carrierCounts(allPals(stock))
  // Asked for, but carried by nothing that can go in a pen. Searching for these
  // is not merely futile, it is *destructive*: a passive no state can ever hold
  // makes the full mask unreachable, so one uncarried ask would throw away a
  // perfectly good route for the three that are carried. They come out of the
  // search and are reported instead, which is the honest division of labour —
  // the planner routes what breeding can deliver, and the view says plainly
  // what has to be caught, bought or traded for first.
  const asked = wantedFrom(ids)
  const missing = asked.ids.filter((id) => (carriers.get(id) ?? 0) === 0)
  const wanted = wantedFrom(asked.ids.filter((id) => !missing.includes(id)))

  const names = [...table.rank.keys()]
  for (const id of stock.bySpecies.keys()) if (!table.rank.has(id)) names.push(id)
  const indexOf = new Map(names.map((id, i) => [id, i]))
  const n = names.length

  const eggs = new Float64Array(n * STRIDE).fill(Infinity)
  const viaA = new Int32Array(n * STRIDE).fill(-1)
  const viaB = new Int32Array(n * STRIDE).fill(-1)
  const settled = new Uint8Array(n * STRIDE)
  const roots = new Map<number, RootPick>()
  // The same information as `roots`, in the form the inner loop can read
  // without a hash lookup on every one of its billions of iterations.
  const rootMale = new Uint8Array(n * STRIDE)
  const rootFemale = new Uint8Array(n * STRIDE)
  // The "breed another" shadow of a root state: see `State.alt`. Only ever
  // written for states a pal already satisfies, so it costs one array read per
  // pair in the hot loop and nothing else.
  const altEggs = new Float64Array(n * STRIDE).fill(Infinity)
  const altA = new Int32Array(n * STRIDE).fill(-1)
  const altB = new Int32Array(n * STRIDE).fill(-1)

  // `childOf` walks two maps and an array; the pair loop asks it the same
  // question over and over, so the answers are cached the first time each pair
  // comes up. −2 is "not asked yet", −1 is "these two make nothing".
  const children = new Int32Array(n * n).fill(-2)
  const childIndex = (a: number, b: number): number => {
    const at = a * n + b
    let c = children[at]!
    if (c === -2) {
      const name = childOf(table, names[a]!, names[b]!)
      c = name === undefined ? -1 : (indexOf.get(name) ?? -1)
      children[at] = c
      children[b * n + a] = c
    }
    return c
  }

  // A lazily-deleted binary heap: settling never has to find its own entry
  // again, so a stale one is simply skipped when it surfaces.
  const heap: number[] = []
  const heapCost: number[] = []
  let truncated = false
  let touched = 0

  const relax = (state: number, cost: number) => {
    if (!(cost < eggs[state]!) || cost > MAX_EXPECTED_EGGS) return false
    if (eggs[state] === Infinity) {
      if (touched >= MAX_STATES) {
        truncated = true
        return false
      }
      touched++
    }
    eggs[state] = cost
    heapPush(heap, heapCost, state, cost)
    return true
  }

  for (const [species, entry] of stock.bySpecies) {
    const si = indexOf.get(species)
    if (si === undefined) continue
    for (const [profile, pick] of rootProfiles(entry, wanted, stock.ownerUid)) {
      const state = si * STRIDE + (profile.mask << 3) + profile.junk
      if (!relax(state, 0)) continue
      roots.set(state, pick)
      rootMale[state] = pick.male ? 1 : 0
      rootFemale[state] = pick.female ? 1 : 0
    }
  }

  // The mask-0 layer is the plain closure's answer, imported rather than
  // recomputed. It also means a pair of blank pals is never relaxed below:
  // that search has already been run, and running it again with junk attached
  // would multiply the state space to rediscover the same routes.
  for (const [species, cost] of reach.cost) {
    if ((reach.depth.get(species) ?? 0) === 0) continue
    const si = indexOf.get(species)
    if (si === undefined) continue
    relax(si * STRIDE + BRED_FILLER_JUNK, cost)
  }

  /** Settled, non-dominated state indices, per species, for the pair loop. */
  const bySpecies = new Map<number, number[]>()
  /** The species with any of those, flattened — the inner loop walks it a lot. */
  const liveSpecies: number[] = []
  /**
   * Every settled state, dominated ones included.
   *
   * Dominance answers "is this worth pairing with", which is not the same
   * question as "is this worth reporting". A pal already in the box dominates
   * every route to breeding another of it — it is free and it is right there —
   * but "how do I breed another" is exactly what the Breed view is for, and
   * dropping the route from the *output* leaves that question with no answer at
   * all. So dominance keeps them out of `bySpecies` and nothing else.
   */
  const settledList: number[] = []
  let statesExplored = 0

  while (heap.length > 0) {
    const u = heapPop(heap, heapCost)
    if (settled[u]) continue
    settled[u] = 1
    settledList.push(u)
    statesExplored++

    const us = (u / STRIDE) | 0
    const uPacked = u - us * STRIDE
    const uMask = uPacked >> 3
    if (isDominated(u, us, uMask, u & 0b111, bySpecies, eggs)) continue
    if (!bySpecies.has(us)) liveSpecies.push(us)
    push(bySpecies, us, u)

    const uEggs = eggs[u]!
    const uMale = rootMale[u]!
    const uFemale = rootFemale[u]!
    const uRoot = uMale | uFemale

    for (const vs of liveSpecies) {
      // Child *species* depends only on the two species, so it is settled once
      // per species pair rather than once per profile pair.
      const ci = childIndex(us, vs)
      if (ci < 0) continue
      const base = ci * STRIDE
      for (const v of bySpecies.get(vs)!) {
        const vPacked = v - vs * STRIDE
        // Two pals with nothing between them is the search `reachFrom` already
        // ran, and its answer is already seeded above. Skipping it here is what
        // keeps the state space to the routes passives actually change — and it
        // is the *only* skip on the pair itself: a filler still has to be
        // expandable as a source, or a pairing found after it settles is lost.
        if (uMask === 0 && vPacked >> 3 === 0) continue
        if (uRoot && (rootMale[v]! | rootFemale[v]!)) {
          // Two pals already in the box, so the gender rule binds — and on
          // instances now, not counts. A state's male and female picks are two
          // different pals, which is also what stops a lone carrier pairing
          // with itself.
          const ok =
            u === v
              ? uMale && uFemale
              : (uMale && rootFemale[v]!) || (uFemale && rootMale[v]!)
          if (!ok) continue
        }
        const total = uEggs + eggs[v]!
        if (total > MAX_EXPECTED_EGGS) continue

        const goals = attainable(uPacked, vPacked)
        // Entry zero is the strongest goal this pair has — everything both
        // parents hold and none of the junk — and it dominates every other goal
        // the pair could reach. If the child already holds that, for less than
        // this pair costs before it even starts, the whole pair is wasted work.
        // This one line is most of why the search finishes.
        //
        // Unless what the child "already holds" is a pal in the box, which
        // costs nothing and would therefore skip every pair that could breed
        // another one. Those are rare — a species held in exactly that profile
        // — so letting them through costs nothing measurable and is the whole
        // of `State.alt`.
        const best = base + goals[0]!
        if (
          settled[best] &&
          eggs[best]! <= total &&
          !(rootMale[best]! | rootFemale[best]!)
        ) {
          continue
        }

        for (let i = 0; i < goals.length; i += 2) {
          const child = base + goals[i]!
          const cost = total + goals[i + 1]!
          if (relax(child, cost)) {
            viaA[child] = u
            viaB[child] = v
          } else if (
            (rootMale[child]! | rootFemale[child]!) &&
            cost < altEggs[child]! &&
            cost <= MAX_EXPECTED_EGGS
          ) {
            altEggs[child] = cost
            altA[child] = u
            altB[child] = v
          }
        }
      }
    }
  }

  return {
    wanted,
    asked,
    states: collect(names, settledList, eggs, viaA, viaB, roots, {
      eggs: altEggs,
      a: altA,
      b: altB,
    }),
    missing,
    carriers,
    truncated,
    statesExplored,
  }
}

/** The packed states, unpacked into the shape the plan walks. */
function collect(
  names: string[],
  settledList: number[],
  eggs: Float64Array,
  viaA: Int32Array,
  viaB: Int32Array,
  roots: Map<number, RootPick>,
  alt: { eggs: Float64Array; a: Int32Array; b: Int32Array },
): Map<StateKey, State> {
  const nameOf = (state: number) => {
    const si = (state / STRIDE) | 0
    return `${names[si]}|${(state - si * STRIDE) >> 3}|${state & 0b111}`
  }
  const out = new Map<StateKey, State>()
  for (const state of settledList) {
    const si = (state / STRIDE) | 0
    out.set(nameOf(state), {
      species: names[si]!,
      profile: { mask: (state - si * STRIDE) >> 3, junk: state & 0b111 },
      eggs: eggs[state]!,
      via:
        viaA[state]! >= 0
          ? { a: nameOf(viaA[state]!), b: nameOf(viaB[state]!) }
          : undefined,
      root: roots.get(state),
      alt:
        alt.a[state]! >= 0
          ? {
              eggs: alt.eggs[state]!,
              via: { a: nameOf(alt.a[state]!), b: nameOf(alt.b[state]!) },
            }
          : undefined,
    })
  }
  return out
}

/* -------------------------------------------------------------------------
   A binary heap, lazily deleted
   ------------------------------------------------------------------------- */

function heapPush(
  heap: number[],
  cost: number[],
  state: number,
  value: number,
): void {
  heap.push(state)
  cost.push(value)
  for (let i = heap.length - 1; i > 0; ) {
    const parent = (i - 1) >> 1
    if (cost[parent]! <= cost[i]!) break
    swap(heap, cost, i, parent)
    i = parent
  }
}

function heapPop(heap: number[], cost: number[]): number {
  const top = heap[0]!
  const lastState = heap.pop()!
  const lastCost = cost.pop()!
  if (heap.length > 0) {
    heap[0] = lastState
    cost[0] = lastCost
    for (let i = 0; ; ) {
      const l = i * 2 + 1
      const r = l + 1
      let small = i
      if (l < heap.length && cost[l]! < cost[small]!) small = l
      if (r < heap.length && cost[r]! < cost[small]!) small = r
      if (small === i) break
      swap(heap, cost, i, small)
      i = small
    }
  }
  return top
}

function swap(heap: number[], cost: number[], i: number, j: number): void {
  ;[heap[i], heap[j]] = [heap[j]!, heap[i]!]
  ;[cost[i], cost[j]] = [cost[j]!, cost[i]!]
}

/* -------------------------------------------------------------------------
   The rules
   ------------------------------------------------------------------------- */

/**
 * Whether an already-settled state makes this one pointless.
 *
 * A stronger guarantee at no greater price: more of what you wanted, no more
 * junk, no more eggs. All three clauses are needed — a superset mask on its own
 * is *not* better, because carrying an extra wanted passive enlarges the pool
 * and dilutes every roll underneath it. That asymmetry is the reason junk is a
 * state dimension in the first place.
 */
function isDominated(
  state: number,
  si: number,
  mask: number,
  junk: number,
  bySpecies: Map<number, number[]>,
  eggs: Float64Array,
): boolean {
  for (const other of bySpecies.get(si) ?? []) {
    if (other === state) continue
    const oMask = (other - si * STRIDE) >> 3
    if (
      (oMask & mask) === mask &&
      (other & 0b111) <= junk &&
      eggs[other]! <= eggs[state]!
    ) {
      return true
    }
  }
  return false
}

/**
 * The pals worth putting forward for each profile a species is held in.
 *
 * Exact profiles only. A pal cannot pretend to carry less than it does, so a
 * "downgraded" state would describe no pal in the box; and carrying *more* of
 * what you wanted is already its own state, found separately if some pal has it.
 *
 * The instance chosen for a profile is the one the plan will name, so the order
 * is the plan's priorities in order: the player's own before a guildmate's,
 * because a route you can walk tonight beats a better one that needs a
 * conversation; then IV total, which is what `ownedNode` has always used and the
 * only thing left to separate two pals that carry the same passives; then the
 * instance id, so two identical pals cannot swap places between reloads.
 */
function rootProfiles(
  entry: { male: Pal[]; female: Pal[] },
  wanted: Wanted,
  ownerUid: Guid,
): Map<Profile, RootPick> {
  const mine = (p: Pal) => (ownerUid && p.ownerPlayerUid !== ownerUid ? 1 : 0)
  const better = (a: Pal, b: Pal) =>
    mine(a) - mine(b) ||
    ivTotal(b) - ivTotal(a) ||
    a.instanceId.localeCompare(b.instanceId)

  const byKey = new Map<string, { profile: Profile; pick: RootPick }>()
  const consider = (pal: Pal, slot: 'male' | 'female') => {
    const profile = profileOf(pal, wanted)
    const k = `${profile.mask}|${profile.junk}`
    const at = byKey.get(k) ?? { profile, pick: {} }
    const held = at.pick[slot]
    if (!held || better(pal, held) < 0) at.pick[slot] = pal
    byKey.set(k, at)
  }
  for (const pal of entry.male) consider(pal, 'male')
  for (const pal of entry.female) consider(pal, 'female')

  const out = new Map<Profile, RootPick>()
  for (const { profile, pick } of byKey.values()) out.set(profile, pick)
  return out
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const at = m.get(k)
  if (at) at.push(v)
  else m.set(k, [v])
}

/**
 * The pals the search can actually put in a pen.
 *
 * `entry.unknown` is deliberately left out: `rootProfiles` only walks the two
 * gendered arrays, so a passive carried solely by pals whose gender the save
 * does not record is one no route can use. Counting it as a carrier would show
 * "1 in stock" in the picker and then fail to find a route, with nothing on
 * screen connecting the two. With `assumeUnknownGender` on, `buildStock` has
 * already pushed those pals into `male`/`female`, so they count then — which is
 * exactly when they are routable.
 */
function allPals(stock: Stock): Pal[] {
  const out: Pal[] = []
  for (const entry of stock.bySpecies.values()) {
    out.push(...entry.male, ...entry.female)
  }
  return out
}

/**
 * Reattach the stock's own pals after a round trip through a worker.
 *
 * `structuredClone` copies the `Pal` objects rather than sharing them, so a
 * plan built straight from a posted result would name pals that are equal to
 * the ones in the stock without being them. Nothing in the app compares a pal by
 * reference today — `borrowedIn` dedupes on `instanceId`, and the view reads
 * fields — but "equal but not identical" is the kind of difference that is
 * invisible until the day something puts a pal in a `Set`.
 */
export function rehydrate(reach: PassiveReach, stock: Stock): PassiveReach {
  const byId = new Map<Guid, Pal>()
  for (const entry of stock.bySpecies.values()) {
    for (const pal of [...entry.male, ...entry.female, ...entry.unknown]) {
      byId.set(pal.instanceId, pal)
    }
  }
  for (const state of reach.states.values()) {
    if (!state.root) continue
    const { male, female } = state.root
    if (male) state.root.male = byId.get(male.instanceId) ?? male
    if (female) state.root.female = byId.get(female.instanceId) ?? female
  }
  return reach
}

/* -------------------------------------------------------------------------
   Planning a route to one target
   ------------------------------------------------------------------------- */

/**
 * Ties, on floats.
 *
 * `planFor` groups its tied routes with `eggs(p) === cheapest`, which is exact
 * and correct on integers. Expected hatches are not integers, and two genuinely
 * equal routes will differ in the last bit or two — so an exact comparison would
 * silently collapse "5 routes tie" to one and take the `r=` deep link with it.
 */
const TIE = 1e-9

/**
 * The cheapest route to one target that carries every wanted passive.
 *
 * Falls back to `planFor` whenever passives cannot be the reason for the answer:
 * no species route at all, nothing in the data, an empty stock. Those diagnoses
 * are already careful and already tested, and a second opinion on them would only
 * be a second thing to keep in step.
 */
export function planWithPassives(
  table: BreedingTable | undefined,
  reach: Reach | undefined,
  passive: PassiveReach | undefined,
  stock: Stock,
  target: string,
  prefer?: BreedPair,
): BreedingPlan {
  const id = target.toLowerCase()
  const species = planFor(table, reach, stock, id, prefer)
  if (!table || !reach || !passive) return species

  const annotated: BreedingPlan = {
    ...species,
    // Narrowed to the pals that already satisfy the whole ask. `planFor`'s
    // version counts every pal of the species, which with passives named would
    // put "already have 3" above a plan for three that carry none of them.
    ownedTarget: species.ownedTarget.filter(
      (pal) => profileOf(pal, passive.wanted).mask === passive.wanted.all,
    ),
    wanted: passive.wanted.ids,
    ignoredPassives: passive.asked.ignored,
    missingPassives: passive.missing,
    truncated: passive.truncated,
  }

  // Nothing left to plan for — either nothing was asked, or nothing asked for
  // is carried by anything in the pool. Both answer with the species plan whole:
  // in the first case that *is* the answer, down to its tied-route list, and in
  // the second the route to the species is still perfectly good and the view
  // says separately which passives have to be obtained before it is worth
  // anything. Returning it here rather than letting the search rediscover it is
  // what makes the no-passives parity structural — the caller branches too, and
  // this is the same guarantee held where it can be tested.
  if (passive.wanted.ids.length === 0) return annotated

  // The species route itself is the problem, so let `diagnose` say why. A
  // passive reason on top of "this can never come out of a breeding pen" would
  // bury the useful half.
  if (species.status !== 'plan') return annotated

  // A route, not a state: a pal already in the box satisfies the ask but is not
  // a way of getting one, and taking it as one renders "what to do — 0 eggs"
  // over an empty list with no alternates and no `r=` link. For those, `alt`
  // carries the cheapest pair that *would* have produced it — "breed another"
  // being half of what this view is for, and what `planFor` does too.
  const goals: { key: StateKey; eggs: number; via: NonNullable<State['via']> }[] = [] // prettier-ignore
  for (const [key, state] of passive.states) {
    if (state.species !== id) continue
    if (state.profile.mask !== passive.wanted.all) continue
    const route = state.via
      ? { eggs: state.eggs, via: state.via }
      : state.alt
    if (!route) continue
    goals.push({ key, eggs: route.eggs, via: route.via })
  }

  if (goals.length === 0) {
    return {
      ...annotated,
      status: 'unreachable',
      // One reason, because there is only one thing left to say: everything
      // still in the search is carried by something, and no route lands them
      // together. Whatever was asked for and *not* carried never entered the
      // search and is reported on its own, whether or not a route was found.
      reason: 'passive-unreachable',
      steps: [],
      tree: undefined,
      generations: 0,
      options: [],
      borrowed: [],
    }
  }

  // Cheapest first, then by key — a total order, so the route shown is the same
  // one across reloads.
  goals.sort((x, y) => x.eggs - y.eggs || x.key.localeCompare(y.key))

  const cheapest = goals[0]!.eggs
  const byPair = new Map<string, { pair: BreedPair; goal: (typeof goals)[0] }>()
  for (const goal of goals) {
    if (goal.eggs > cheapest + TIE) break
    const a = passive.states.get(goal.via.a)!.species
    const b = passive.states.get(goal.via.b)!.species
    const pair: BreedPair = a <= b ? { a, b } : { a: b, b: a }
    const k = `${pair.a}|${pair.b}`
    if (!byPair.has(k)) byPair.set(k, { pair, goal })
  }

  const routes = [...byPair.values()].sort(
    (x, y) => x.pair.a.localeCompare(y.pair.a) || x.pair.b.localeCompare(y.pair.b), // prettier-ignore
  )
  const options = routes.map((r) => r.pair)

  // A pinned pair from a link is honoured only if it is still one of the
  // shortest, exactly as `planFor` treats a stale `r=`.
  const chosen =
    (prefer &&
      routes.find(
        (r) =>
          r.pair.a === prefer.a.toLowerCase() &&
          r.pair.b === prefer.b.toLowerCase(),
      )) ||
    routes[0]

  const ctx: Ctx = {
    table,
    reach,
    passive,
    stock,
    steps: [],
    stepOf: new Map(),
  }
  const picked = chosen ?? { goal: goals[0]! }
  // The top level is expanded through its pair explicitly, so that a target
  // already sitting in the box still renders as "and here is how to breed
  // another" rather than as a plan with no steps in it.
  const tree = expandState(picked.goal.key, ctx, undefined, picked.goal.via)
  annotateProgress(ctx.steps, stock, passive.wanted)

  return {
    ...annotated,
    status: 'plan',
    steps: ctx.steps,
    tree,
    generations: height(tree),
    options,
    borrowed: borrowedIn(ctx.steps, stock.ownerUid),
    expectedEggs: ctx.steps.reduce((t, s) => t + (s.expectedEggs ?? 1), 0),
  }
}

interface Ctx {
  table: BreedingTable
  reach: Reach
  passive: PassiveReach
  stock: Stock
  steps: BreedStep[]
  /**
   * Keyed on the **state**, not the species.
   *
   * The bug this prevents is a quiet one: a route that needs `mid` carrying
   * Swift and `mid` carrying Legend needs two eggs and two pens, and a step list
   * keyed on species would collapse them into one line advertising a single egg
   * that satisfies two incompatible requirements. A genuinely shared state — the
   * same species with the same profile, used twice — still collapses to one step,
   * which is right, and is what keeps the self-pair case honest.
   */
  stepOf: Map<StateKey, number>
}

function expandState(
  key: StateKey,
  ctx: Ctx,
  want?: Gender,
  /** Forces expansion through a pair, for the top level. See `planWithPassives`. */
  override?: NonNullable<State['via']>,
): BreedNode {
  const st = ctx.passive.states.get(key)!

  if (st.root && !override) return rootNode(st, ctx, want)
  // A filler carries nothing, so how to breed it is exactly the question
  // `planFor` already answers. Adopting its subtree keeps one implementation of
  // gender assignment and instance choice rather than growing a second.
  const via = override ?? st.via
  if (!via) return adoptPlain(st.species, ctx)

  const a = ctx.passive.states.get(via.a)!
  const b = ctx.passive.states.get(via.b)!
  const [wantA, wantB] = assignRootGenders(a, b, ctx.stock.ownerUid)
  const nodeA = expandState(via.a, ctx, wantA)
  const nodeB = expandState(via.b, ctx, wantB)

  let n = ctx.stepOf.get(key)
  if (n === undefined) {
    n = ctx.steps.length + 1
    ctx.stepOf.set(key, n)
    const chance = pAtLeast(
      a.profile,
      b.profile,
      st.profile.mask,
      st.profile.junk,
    )
    ctx.steps.push({
      n,
      species: st.species,
      a: nodeA,
      b: nodeB,
      generation: ctx.reach.depth.get(st.species) ?? 0,
      selfPair: a.species === b.species,
      carries: idsIn(st.profile.mask, ctx.passive.wanted),
      chance,
      expectedEggs: expectedEggs(chance),
      pool: poolOf(a.profile, b.profile),
      junk: st.profile.junk,
    })
  }
  return { kind: 'bred', species: st.species, a: nodeA, b: nodeB, step: n }
}

/**
 * Which gender each side of a root pair has to be.
 *
 * The same rule `assignGenders` applies in `breeding.ts`, against pinned
 * instances rather than counts: only a root × root pair is constrained, and
 * where both orientations work, the one that borrows fewer of someone else's
 * pals wins. `undefined` leaves a bred side free to be re-hatched for the
 * other roll.
 */
function assignRootGenders(
  a: State,
  b: State,
  ownerUid: Guid,
): [Gender | undefined, Gender | undefined] {
  if (!a.root || !b.root) return [undefined, undefined]
  const borrow = (p?: Pal) =>
    p && (!ownerUid || p.ownerPlayerUid === ownerUid) ? 0 : 1
  const mf =
    a.root.male && b.root.female
      ? borrow(a.root.male) + borrow(b.root.female)
      : Infinity
  const fm =
    a.root.female && b.root.male
      ? borrow(a.root.female) + borrow(b.root.male)
      : Infinity
  // `<=` keeps ♂×♀ as the tie rule, as it is in `breeding.ts`.
  if (mf <= fm) {
    return Number.isFinite(mf) ? ['Male', 'Female'] : [undefined, undefined]
  }
  return ['Female', 'Male']
}

/**
 * A pal already in the box.
 *
 * The instance is the one the search pinned when it seeded this state, not one
 * re-derived here. That distinction is the whole point: `ownedNode` in
 * `breeding.ts` picks by IV, which would hand you the wrong pal entirely — the
 * high-IV one that carries none of what you asked for.
 */
function rootNode(st: State, ctx: Ctx, want?: Gender): BreedNode {
  const pick = st.root!
  const use =
    want === 'Male'
      ? pick.male
      : want === 'Female'
        ? pick.female
        : (pick.male ?? pick.female)
  const entry = ctx.stock.bySpecies.get(st.species)
  return {
    kind: 'owned',
    species: st.species,
    use,
    gender: want ?? use?.gender,
    count: entry
      ? entry.male.length + entry.female.length + entry.unknown.length
      : 0,
    carries: idsIn(st.profile.mask, ctx.passive.wanted),
    junk: st.profile.junk,
  }
}

/**
 * A species bred the ordinary way, spliced in.
 *
 * `planFor`'s own subtree, with its step numbers remapped into this plan's.
 * Its intermediates carry no passive requirement, so keying them on species is
 * right here for the same reason it is right there.
 */
function adoptPlain(species: string, ctx: Ctx): BreedNode {
  const sub = planFor(ctx.table, ctx.reach, ctx.stock, species)
  if (!sub.tree) {
    return { kind: 'owned', species, count: 0 }
  }
  return adopt(sub.tree, ctx)
}

function adopt(node: BreedNode, ctx: Ctx): BreedNode {
  if (node.kind === 'owned') return node
  const a = adopt(node.a, ctx)
  const b = adopt(node.b, ctx)
  const key = `plain|${node.species}`
  let n = ctx.stepOf.get(key)
  if (n === undefined) {
    n = ctx.steps.length + 1
    ctx.stepOf.set(key, n)
    ctx.steps.push({
      n,
      species: node.species,
      a,
      b,
      generation: ctx.reach.depth.get(node.species) ?? 0,
      selfPair: node.a.species === node.b.species,
      // No `chance` and no `carries`: this egg has nothing to come out with, so
      // the view shows it as the plain step it is rather than as a 100% one.
    })
  }
  return { kind: 'bred', species: node.species, a, b, step: n }
}

/**
 * What the player already holds towards each step.
 *
 * A post-pass rather than something the two step-building paths each do, so
 * there is one definition of "closest" and no chance of them drifting.
 *
 * Only steps that ask for a passive are annotated. A step spliced in from the
 * plain planner has no requirement to be close to, and "do you own this
 * species" is a question the search settles by seeding owned species as roots.
 */
function annotateProgress(
  steps: BreedStep[],
  stock: Stock,
  wanted: Wanted,
): void {
  for (const step of steps) {
    if (step.carries === undefined) continue
    const entry = stock.bySpecies.get(step.species)
    if (!entry) continue

    const need = new Set(step.carries)
    let best: StepProgress | undefined
    for (const pal of [...entry.male, ...entry.female, ...entry.unknown]) {
      const profile = profileOf(pal, wanted)
      const carried = idsIn(profile.mask, wanted)
      const has = carried.filter((id) => need.has(id))
      if (has.length === 0) continue

      const candidate: StepProgress = {
        pal,
        has,
        junk: profile.junk,
        meets:
          has.length === step.carries.length &&
          profile.junk <= (step.junk ?? MAX_SLOTS),
        beyond: carried.filter((id) => !need.has(id)),
      }
      if (best === undefined || better(candidate, best)) best = candidate
    }
    step.progress = best
  }
}

/**
 * Which of two held pals is the more encouraging thing to be told about.
 *
 * Meeting the step wins outright; after that it is how much of the step it
 * covers, then how much *else* it carries — a pal three passives into a
 * four-passive plan is the most useful thing on the screen even when the step
 * only asked for two. Junk, IV and the instance id break the remaining ties, in
 * that order, so the pal named does not change between two loads of one save.
 */
function better(a: StepProgress, b: StepProgress): boolean {
  return (
    (a.meets ? 1 : 0) - (b.meets ? 1 : 0) ||
    a.has.length - b.has.length ||
    a.beyond.length - b.beyond.length ||
    b.junk - a.junk ||
    ivTotal(a.pal) - ivTotal(b.pal) ||
    b.pal.instanceId.localeCompare(a.pal.instanceId)
  ) > 0
}

/** The wanted passives a mask stands for, in the order they were asked for. */
function idsIn(mask: number, wanted: Wanted): string[] {
  return wanted.ids.filter((_, i) => mask & (1 << i))
}

/**
 * Distinct passives the two parents present between them.
 *
 * Clamped exactly as `combine` clamps it, because this is the number shown
 * beside the odds and the two disagreeing would be worse than showing neither.
 */
function poolOf(a: Profile, b: Profile): number {
  const wanted = popcount(a.mask | b.mask)
  return wanted + Math.min(a.junk + b.junk, MAX_SLOTS * 2 - wanted)
}
