/**
 * Routes that carry the passives you asked for.
 *
 * Same invented species as `breeding.test.ts` — `aa` at 100, `bb` at 200, `mid`
 * at 150 — and invented passives `swift` and `legend`, for the same reason: the
 * subject is which route the search prefers and why, and real names would only
 * make it harder to see which number is doing the work.
 *
 * The load-bearing test is the first one. Asking for no passives at all has to
 * produce byte-for-byte what the species planner produces, because that is the
 * promise this whole feature rests on.
 */

import { describe, expect, it } from 'vitest'

import {
  buildBreedingTable,
  buildStock,
  planFor,
  reachFrom,
  type BreedingTable,
  type Stock,
} from '@/domain/breeding.ts'
import {
  MAX_EXPECTED_EGGS,
  planWithPassives,
  reachWithPassives,
} from '@/domain/passiveBreeding.ts'
import type { BreedingData } from '@/refdata/refdata.ts'
import type { Gender, Pal, SaveIndex } from '@/domain/types.ts'

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

const OWNER = 'aaaaaaaa'.padEnd(32, '0')
const MATE = 'bbbbbbbb'.padEnd(32, '0')
const GUILD = 'cccccccc'.padEnd(32, '0')

let n = 0
function pal(
  characterId: string,
  gender: Gender,
  passives: string[] = [],
  overrides: Partial<Pal> = {},
): Pal {
  n++
  return {
    instanceId: `${n}`.padStart(32, '0'),
    characterId,
    isBoss: false,
    isRare: false,
    gender,
    level: 10,
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
    ownerPlayerUid: OWNER,
    groupId: GUILD,
    ...overrides,
  }
}

function data(
  pals: Record<string, [rank: number, ignore?: boolean]>,
  uniqueCombos: BreedingData['uniqueCombos'] = [],
): BreedingData {
  const out: BreedingData['pals'] = {}
  for (const [id, [combiRank, ignore]] of Object.entries(pals)) {
    out[id] = { combiRank, ignoreCombi: ignore === true }
  }
  return { pals: out, uniqueCombos }
}

function index(pals: Pal[]): SaveIndex {
  const byOwner = new Map<string, Pal[]>()
  const byGuild = new Map<string, Pal[]>()
  const push = (m: Map<string, Pal[]>, k: string | undefined, p: Pal) => {
    if (!k) return
    const at = m.get(k)
    if (at) at.push(p)
    else m.set(k, [p])
  }
  for (const p of pals) {
    push(byOwner, p.ownerPlayerUid, p)
    push(byGuild, p.groupId, p)
  }
  const players = [
    { playerUid: OWNER, name: 'Own', groupId: GUILD },
    { playerUid: MATE, name: 'Mate', groupId: GUILD },
  ]
  return {
    pals,
    palsByOwner: byOwner,
    palsByGuild: byGuild,
    playerByUid: new Map(players.map((p) => [p.playerUid, p])),
    guildById: new Map([
      [GUILD, { groupId: GUILD, type: 'Guild', name: 'The Guild' }],
    ]),
  } as unknown as SaveIndex
}

function stockOf(
  table: BreedingTable,
  pals: Pal[],
  opts: { includeGuild?: boolean } = {},
) {
  return buildStock(index(pals), table, OWNER, opts)
}

const POOL = { includeGuild: true }

/** A plan with passives, from the raw pieces. */
function plan(
  table: BreedingTable,
  stock: Stock,
  target: string,
  wanted: string[],
  prefer?: { a: string; b: string },
) {
  const reach = reachFrom(stock, table)
  const passive = reachWithPassives(stock, table, reach, wanted)
  return planWithPassives(table, reach, passive, stock, target, prefer)
}

/** The usual ladder: `aa` and `bb` make `mid`, and `mid` breeds true. */
const LADDER = () =>
  buildBreedingTable(data({ aa: [100], bb: [200], mid: [150] }))

/* -------------------------------------------------------------------------
   The promise
   ------------------------------------------------------------------------- */

describe('planWithPassives — with nothing asked for', () => {
  it('is the species plan, unchanged', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Male', ['runner']),
      pal('bb', 'Female'),
    ])
    const reach = reachFrom(stock, table)
    const passive = reachWithPassives(stock, table, reach, [])
    const withPassives = planWithPassives(table, reach, passive, stock, 'mid')
    const species = planFor(table, reach, stock, 'mid')

    // Everything the species planner decides is untouched; the passive planner
    // only adds its own fields on top.
    expect(withPassives.steps).toEqual(species.steps)
    expect(withPassives.tree).toEqual(species.tree)
    expect(withPassives.options).toEqual(species.options)
    expect(withPassives.generations).toBe(species.generations)
    expect(withPassives.borrowed).toEqual(species.borrowed)
    expect(withPassives.status).toBe('plan')
  })

  it('leaves a species-level failure to the species planner', () => {
    const table = buildBreedingTable(data({ aa: [100], odd: [900, true] }))
    const stock = stockOf(table, [pal('aa', 'Male'), pal('aa', 'Female')])
    const p = plan(table, stock, 'odd', ['swift'])
    expect(p.status).toBe('unreachable')
    // Not a passive reason: "this can never come out of a pen" is the useful
    // half, and burying it under "nobody has swift" would be a worse answer.
    expect(p.reason).not.toBe('passive-not-in-stock')
  })
})

/* -------------------------------------------------------------------------
   Carrying a passive
   ------------------------------------------------------------------------- */

describe('planWithPassives — carrying a passive', () => {
  it('names the passive the egg has to come out with', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Male', ['swift']),
      pal('bb', 'Female'),
    ])
    const p = plan(table, stock, 'mid', ['swift'])
    expect(p.status).toBe('plan')
    expect(p.steps).toHaveLength(1)
    expect(p.steps[0]!.carries).toEqual(['swift'])
    expect(p.wanted).toEqual(['swift'])
  })

  it('prices the hatch, not just the egg', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Male', ['swift']),
      pal('bb', 'Female'),
    ])
    const p = plan(table, stock, 'mid', ['swift'])
    // A lone carrier always passes its passive on, and junk on the *final* pal
    // is nobody's problem — so this really is one hatch. The number only parts
    // company with the egg count when the route has to keep a pal clean for the
    // generation below it.
    expect(p.steps).toHaveLength(1)
    expect(p.expectedEggs).toBeCloseTo(1, 10)
    expect(p.steps[0]!.chance).toBeCloseTo(1, 10)

    // Two carriers to merge is where it starts to bite.
    const merged = plan(
      table,
      stockOf(table, [
        pal('mid', 'Male', ['swift']),
        pal('mid', 'Female', ['legend']),
      ]),
      'mid',
      ['swift', 'legend'],
    )
    expect(merged.steps).toHaveLength(1)
    expect(merged.expectedEggs!).toBeGreaterThan(1.6)
  })

  it('picks the carrier over the better pal that carries nothing', () => {
    const table = LADDER()
    const carrier = pal('aa', 'Male', ['swift'], {
      ivHp: 1,
      ivAttack: 1,
      ivDefense: 1,
    })
    const better = pal('aa', 'Male', [], {
      ivHp: 100,
      ivAttack: 100,
      ivDefense: 100,
    })
    const stock = stockOf(table, [carrier, better, pal('bb', 'Female')])
    const p = plan(table, stock, 'mid', ['swift'])
    const side = p.steps[0]!.a.species === 'aa' ? p.steps[0]!.a : p.steps[0]!.b
    expect(side.kind).toBe('owned')
    // The whole point: `ownedNode` in breeding.ts would have taken the 300-IV
    // one, which carries none of what was asked for.
    expect(side.kind === 'owned' && side.use?.instanceId).toBe(
      carrier.instanceId,
    )
    expect(side.kind === 'owned' && side.carries).toEqual(['swift'])
  })

  it('prefers the clean carrier to the loaded one', () => {
    const table = LADDER()
    const clean = pal('aa', 'Male', ['swift'])
    const loaded = pal('aa', 'Male', ['swift', 'x', 'y', 'z'], {
      ivHp: 100,
      ivAttack: 100,
      ivDefense: 100,
    })
    const stock = stockOf(table, [clean, loaded, pal('bb', 'Female')])
    const p = plan(table, stock, 'mid', ['swift'])
    const side = p.steps[0]!.a.species === 'aa' ? p.steps[0]!.a : p.steps[0]!.b
    expect(side.kind === 'owned' && side.use?.instanceId).toBe(clean.instanceId)
  })

  it('costs more when the parents are loaded with junk', () => {
    const table = LADDER()
    const cheap = plan(
      table,
      stockOf(table, [pal('aa', 'Male', ['swift']), pal('bb', 'Female')]),
      'mid',
      ['swift'],
    )
    const dear = plan(
      table,
      stockOf(table, [
        pal('aa', 'Male', ['swift', 'x', 'y', 'z']),
        pal('bb', 'Female', ['p', 'q', 'r', 's']),
      ]),
      'mid',
      ['swift'],
    )
    expect(dear.expectedEggs!).toBeGreaterThan(cheap.expectedEggs!)
  })

  it('merges two carriers, from two different pals', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('mid', 'Male', ['swift']),
      pal('mid', 'Female', ['legend']),
    ])
    const p = plan(table, stock, 'mid', ['swift', 'legend'])
    expect(p.status).toBe('plan')
    expect(p.steps[0]!.carries).toEqual(['swift', 'legend'])
    const { a, b } = p.steps[0]!
    // Gotcha worth a test of its own: `borrowed` dedupes by instance, so a plan
    // that pinned one pal to both sides would silently look *cheaper*.
    expect(a.kind === 'owned' && a.use?.instanceId).not.toBe(
      b.kind === 'owned' ? b.use?.instanceId : undefined,
    )
  })

  it('follows the carrier’s gender, not the usual ♂×♀', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Female', ['swift']),
      pal('aa', 'Male'),
      pal('bb', 'Male'),
      pal('bb', 'Female'),
    ])
    const p = plan(table, stock, 'mid', ['swift'])
    const aa = p.steps[0]!.a.species === 'aa' ? p.steps[0]!.a : p.steps[0]!.b
    expect(aa.kind === 'owned' && aa.gender).toBe('Female')
  })
})

describe('planWithPassives — when you already have one', () => {
  it('still shows how to breed another', () => {
    const table = LADDER()
    // A `mid` carrying swift is already in the box. "How do I get one" is then
    // a question about the *next* one, and a plan with no steps in it is not an
    // answer — `planFor` refuses the same shortcut.
    const stock = stockOf(table, [
      pal('mid', 'Male', ['swift']),
      pal('aa', 'Male', ['swift']),
      pal('bb', 'Female'),
    ])
    const p = plan(table, stock, 'mid', ['swift'])
    expect(p.status).toBe('plan')
    expect(p.steps.length).toBeGreaterThan(0)
    expect(p.options.length).toBeGreaterThan(0)
  })

  it('counts only the ones that already satisfy the ask', () => {
    const table = LADDER()
    const carrier = pal('mid', 'Male', ['swift'])
    const stock = stockOf(table, [
      carrier,
      // Same species, none of the passives. "Already have 2" over a plan for
      // one that carries swift would be a straightforwardly wrong number.
      pal('mid', 'Female', ['junk']),
      pal('aa', 'Male', ['swift']),
      pal('bb', 'Female'),
    ])
    const p = plan(table, stock, 'mid', ['swift'])
    expect(p.ownedTarget.map((x) => x.instanceId)).toEqual([carrier.instanceId])
  })
})

/* -------------------------------------------------------------------------
   The honest failures
   ------------------------------------------------------------------------- */

describe('planWithPassives — when it cannot be done', () => {
  it('plans for what is carried and reports what is not', () => {
    const table = LADDER()
    // The reported case in miniature: one wanted passive is in the pool, one is
    // not. Refusing outright throws away a route that works — the whole point
    // of asking for `swift` does not evaporate because `legend` is unobtainable.
    const stock = stockOf(table, [
      pal('aa', 'Male', ['swift']),
      pal('bb', 'Female'),
    ])
    const p = plan(table, stock, 'mid', ['swift', 'legend'])
    expect(p.status).toBe('plan')
    expect(p.wanted).toEqual(['swift'])
    expect(p.missingPassives).toEqual(['legend'])
    expect(p.steps[0]!.carries).toEqual(['swift'])
  })

  it('adding an unobtainable passive does not spoil the plan', () => {
    const table = LADDER()
    const pals = [pal('aa', 'Male', ['swift']), pal('bb', 'Female')]
    const one = plan(table, stockOf(table, pals), 'mid', ['swift'])
    const two = plan(table, stockOf(table, pals), 'mid', ['swift', 'legend'])
    // Byte for byte the same route; only the reporting differs.
    expect(two.steps).toEqual(one.steps)
    expect(two.expectedEggs).toBe(one.expectedEggs)
  })

  it('still gives the species route when nothing asked for is carried', () => {
    const table = LADDER()
    const stock = stockOf(table, [pal('aa', 'Male'), pal('bb', 'Female')])
    const p = plan(table, stock, 'mid', ['swift', 'legend'])
    // How to breed a `mid` is still a good answer, and the view says separately
    // that neither passive can ride along yet.
    expect(p.status).toBe('plan')
    expect(p.wanted).toEqual([])
    expect(p.missingPassives).toEqual(['swift', 'legend'])
    expect(p.steps.length).toBeGreaterThan(0)
  })

  it('will not pair a lone carrier with itself', () => {
    const table = LADDER()
    // One Swift carrier of `mid`, and `mid` breeds true — but a pal is not a
    // pair. The species planner gets there first, which is the right answer:
    // with one pal in the box there is nothing to say about passives yet.
    const stock = stockOf(table, [pal('mid', 'Male', ['swift'])])
    const p = plan(table, stock, 'mid', ['swift'])
    expect(p.status).toBe('unreachable')
  })

  it('stages the merge rather than pairing two loaded parents', () => {
    const table = LADDER()
    // Both wanted passives are on fully loaded pals. Pairing them directly is a
    // pool of eight and one hatch in seven hundred; the search is expected to
    // strip the junk in stages instead, which is what a player does by hand and
    // what makes junk worth tracking at all.
    const stock = stockOf(table, [
      pal('aa', 'Male', ['w', 'x', 'j1', 'j2']),
      pal('bb', 'Female', ['y', 'z', 'j3', 'j4']),
    ])
    const p = plan(table, stock, 'mid', ['w', 'x', 'y', 'z'])
    expect(p.status).toBe('plan')
    expect(p.steps.length).toBeGreaterThan(1)
    // Comfortably inside the direct pairing's 700, and inside the budget.
    expect(p.expectedEggs!).toBeLessThan(MAX_EXPECTED_EGGS)
    // Every intermediate is cleaner than the parents it came from.
    const junky = p.steps.filter((s) => (s.junk ?? 0) >= 4)
    expect(junky).toHaveLength(0)
  })

  it('carries two passives down two branches and merges them', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Male', ['swift']),
      pal('aa', 'Female'),
      pal('bb', 'Male', ['legend']),
      pal('bb', 'Female'),
    ])
    const p = plan(table, stock, 'mid', ['swift', 'legend'])
    expect(p.status).toBe('plan')
    // Neither parent species can supply both, so the route has to make one
    // `mid` per passive and then pair those.
    expect(p.steps.length).toBeGreaterThan(1)
    expect(p.steps.at(-1)!.carries).toEqual(['swift', 'legend'])
  })

  it('reports what it refused to plan for beyond four', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Male', ['a', 'b', 'c', 'd']),
      pal('bb', 'Female', ['e']),
    ])
    const p = plan(table, stock, 'mid', ['a', 'b', 'c', 'd', 'e'])
    expect(p.wanted).toEqual(['a', 'b', 'c', 'd'])
    expect(p.ignoredPassives).toEqual(['e'])
  })
})

/* -------------------------------------------------------------------------
   Whose pals
   ------------------------------------------------------------------------- */

describe('planWithPassives — the guild', () => {
  it('opens a passive route the player cannot walk alone', () => {
    const table = LADDER()
    const pals = [
      pal('aa', 'Male'),
      pal('bb', 'Female'),
      pal('aa', 'Male', ['swift'], { ownerPlayerUid: MATE }),
    ]
    // Alone: the species route stands, but nothing this player owns carries
    // swift, so it is reported as missing rather than planned for.
    const alone = plan(table, stockOf(table, pals), 'mid', ['swift'])
    expect(alone.status).toBe('plan')
    expect(alone.wanted).toEqual([])
    expect(alone.missingPassives).toEqual(['swift'])

    // Pooled: the guildmate's carrier is in the pool, so it becomes routable.
    const pooled = plan(table, stockOf(table, pals, POOL), 'mid', ['swift'])
    expect(pooled.status).toBe('plan')
    expect(pooled.wanted).toEqual(['swift'])
    expect(pooled.missingPassives).toEqual([])
    expect(pooled.borrowed.map((b) => b.ownerUid)).toEqual([MATE])
  })

  it('prefers the player’s own carrier to a guildmate’s', () => {
    const table = LADDER()
    const own = pal('aa', 'Male', ['swift'])
    const theirs = pal('aa', 'Male', ['swift'], {
      ownerPlayerUid: MATE,
      ivHp: 100,
      ivAttack: 100,
      ivDefense: 100,
    })
    const stock = stockOf(
      table,
      [own, theirs, pal('bb', 'Female')],
      POOL,
    )
    const p = plan(table, stock, 'mid', ['swift'])
    const aa = p.steps[0]!.a.species === 'aa' ? p.steps[0]!.a : p.steps[0]!.b
    expect(aa.kind === 'owned' && aa.use?.instanceId).toBe(own.instanceId)
    expect(p.borrowed).toEqual([])
  })
})

/* -------------------------------------------------------------------------
   The search itself
   ------------------------------------------------------------------------- */

describe('reachWithPassives', () => {
  it('counts who carries what, and who carries nothing', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Male', ['Swift']),
      pal('bb', 'Female', ['swift']),
    ])
    const r = reachWithPassives(stock, table, reachFrom(stock, table), [
      'swift',
      'legend',
    ])
    // Cased however the save wrote it; keyed lowercased, like every other map.
    expect(r.carriers.get('swift')).toBe(2)
    expect(r.missing).toEqual(['legend'])
  })

  it('counts only carriers it could actually put in a pen', () => {
    const table = LADDER()
    // A save that records no gender for the only Swift carrier. Counting it
    // would show "1 in stock" in the picker and then fail to find a route,
    // with nothing on screen connecting the two.
    const stock = stockOf(table, [
      pal('aa', 'Male'),
      pal('bb', 'Female'),
      pal('aa', 'Male', ['swift'], { gender: undefined }),
    ])
    const r = reachWithPassives(stock, table, reachFrom(stock, table), [
      'swift',
    ])
    expect(r.carriers.get('swift')).toBeUndefined()
    expect(r.missing).toEqual(['swift'])
  })

  it('counts them once the gender assumption is loosened', () => {
    const table = LADDER()
    const pals = [
      pal('aa', 'Male'),
      pal('bb', 'Female'),
      pal('aa', 'Male', ['swift'], { gender: undefined }),
    ]
    const stock = buildStock(index(pals), table, OWNER, {
      assumeUnknownGender: true,
    })
    const r = reachWithPassives(stock, table, reachFrom(stock, table), [
      'swift',
    ])
    expect(r.carriers.get('swift')).toBe(1)
    expect(r.missing).toEqual([])
  })

  it('never advises a route past the budget', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Male', ['swift', 'x', 'y', 'z']),
      pal('bb', 'Female', ['legend', 'p', 'q', 'r']),
    ])
    const r = reachWithPassives(stock, table, reachFrom(stock, table), [
      'swift',
      'legend',
    ])
    for (const st of r.states.values()) {
      expect(st.eggs).toBeLessThanOrEqual(MAX_EXPECTED_EGGS)
    }
  })

  it('is the same search twice', () => {
    const table = LADDER()
    const pals = [
      pal('aa', 'Male', ['swift']),
      pal('aa', 'Female', ['legend']),
      pal('bb', 'Male'),
      pal('bb', 'Female', ['swift', 'x']),
    ]
    const first = plan(table, stockOf(table, pals), 'mid', ['swift', 'legend'])
    const again = plan(table, stockOf(table, pals), 'mid', ['swift', 'legend'])
    expect(again.steps).toEqual(first.steps)
    expect(again.options).toEqual(first.options)
    expect(again.expectedEggs).toBe(first.expectedEggs)
  })

  it('never makes a bigger ask cheaper', () => {
    const table = LADDER()
    const stock = stockOf(table, [
      pal('aa', 'Male', ['swift']),
      pal('aa', 'Female', ['legend']),
      pal('bb', 'Male'),
      pal('bb', 'Female'),
    ])
    const one = plan(table, stock, 'mid', ['swift'])
    const both = plan(table, stock, 'mid', ['swift', 'legend'])
    expect(both.expectedEggs!).toBeGreaterThanOrEqual(one.expectedEggs!)
  })
})
