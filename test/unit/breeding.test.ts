/**
 * Breeding rules and routes.
 *
 * The species here are invented — `aa` at rank 100, `bb` at 200 — because the
 * subject of most of these tests is arithmetic, and real names would only
 * obscure which number is doing the work. The formula's agreement with the real
 * game data is a separate, larger claim, checked by `pnpm verify:breeding`
 * against all 46,355 pairs in upstream's precomputed tables.
 */

import { describe, expect, it } from 'vitest'

import {
  buildBreedingTable,
  buildStock,
  childOf,
  pairKey,
  planFor,
  reachFrom,
  type BreedingTable,
  type Stock,
} from '@/domain/breeding.ts'
import type { BreedingData } from '@/refdata/refdata.ts'
import type { Pal, SaveIndex } from '@/domain/types.ts'

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

let n = 0
function pal(characterId: string, overrides: Partial<Pal> = {}): Pal {
  n++
  return {
    instanceId: `${n}`.padStart(32, '0'),
    characterId,
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
    ownerPlayerUid: OWNER,
    // Inert unless a test pools the guild in, which is what makes "toggle off is
    // unchanged" testable against the same fixtures.
    groupId: GUILD,
    ...overrides,
  }
}

const OWNER = 'aaaaaaaa'.padEnd(32, '0')
/** A guildmate, for the pooled-stock cases. */
const MATE = 'bbbbbbbb'.padEnd(32, '0')
const GUILD = 'cccccccc'.padEnd(32, '0')

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

/**
 * A `SaveIndex` with only the fields the breeding code reads: the two pal
 * groupings, the player table and the guild table. Two members, one guild.
 *
 * Both groupings mirror `groupBy`'s behaviour of dropping pals with no key, which
 * is what makes the "a pal outside the guild stays out of the pool" case real.
 */
function index(
  pals: Pal[],
  opts: { guildless?: boolean; type?: 'Guild' | 'Organization' } = {},
): SaveIndex {
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

  const groupId = opts.guildless ? undefined : GUILD
  const players = [
    { playerUid: OWNER, name: 'Own', groupId },
    { playerUid: MATE, name: 'Mate', groupId },
  ]
  return {
    pals,
    palsByOwner: byOwner,
    palsByGuild: byGuild,
    playerByUid: new Map(players.map((p) => [p.playerUid, p])),
    guildById: new Map([
      [
        GUILD,
        { groupId: GUILD, type: opts.type ?? 'Guild', name: 'The Guild' },
      ],
    ]),
  } as unknown as SaveIndex
}

function stockOf(
  table: BreedingTable | undefined,
  pals: Pal[],
  opts = {},
  idxOpts = {},
) {
  return buildStock(index(pals, idxOpts), table, OWNER, opts)
}

/** Shorthand for the pooled-stock option. */
const POOL = { includeGuild: true }

function plan(
  table: BreedingTable,
  stock: Stock,
  target: string,
  prefer?: { a: string; b: string },
) {
  return planFor(table, reachFrom(stock, table), stock, target, prefer)
}

/* -------------------------------------------------------------------------
   The formula
   ------------------------------------------------------------------------- */

describe('childOf', () => {
  it('picks the candidate nearest the averaged rank', () => {
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], mid: [150], far: [900] }),
    )
    // (100 + 200 + 1) / 2 → 150
    expect(childOf(t, 'aa', 'bb')).toBe('mid')
  })

  it('breaks a tie towards the HIGHER rank', () => {
    // The direction is load-bearing. Against upstream's tables, "lower wins"
    // produces the wrong child for 182 of the 906 reachable targets.
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], low: [140], high: [160] }),
    )
    expect(childOf(t, 'aa', 'bb')).toBe('high')
  })

  it('rounds the average up, so the two argument orders agree', () => {
    // The parents are flagged so they cannot be their own children here; the
    // point of the test is which of `down` and `up` the target lands on.
    const t = buildBreedingTable(
      data({ aa: [100, true], bb: [101, true], down: [100], up: [101] }),
    )
    // (100 + 101 + 1) / 2 → 101, not 100.
    expect(childOf(t, 'aa', 'bb')).toBe('up')
    expect(childOf(t, 'bb', 'aa')).toBe('up')
  })

  it('lets a unique combo override the formula, either way round', () => {
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], mid: [150], odd: [900] }, [
        { a: 'aa', b: 'bb', child: 'odd' },
      ]),
    )
    expect(childOf(t, 'aa', 'bb')).toBe('odd')
    expect(childOf(t, 'bb', 'aa')).toBe('odd')
  })

  it('breeds a species true with itself', () => {
    const t = buildBreedingTable(data({ aa: [100], bb: [200], mid: [150] }))
    expect(childOf(t, 'aa', 'aa')).toBe('aa')
  })

  it('breeds an ignoreCombi species true with itself', () => {
    // The same-species branch runs before the candidate set is consulted, which
    // is why "cannot be a formula child" is not "cannot be bred".
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], mid: [150], orphan: [500, true] }),
    )
    expect(childOf(t, 'orphan', 'orphan')).toBe('orphan')
    expect(t.crossSpeciesImpossible.has('orphan')).toBe(true)
  })

  it('breeds a unique-combo child true with itself', () => {
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], mid: [150], variant: [150] }, [
        { a: 'aa', b: 'bb', child: 'variant' },
      ]),
    )
    expect(childOf(t, 'variant', 'variant')).toBe('variant')
  })

  it('never produces an ignoreCombi species or a unique child from a mixed pair', () => {
    const t = buildBreedingTable(
      data(
        { aa: [100, true], bb: [200, true], plain: [150], hidden: [150, true], uniq: [151] }, // prettier-ignore
        [{ a: 'aa', b: 'aa', child: 'uniq' }],
      ),
    )
    expect(t.candidates).toEqual(['plain'])
    expect(childOf(t, 'aa', 'bb')).toBe('plain')
  })

  it('does not count a unique child as cross-species impossible', () => {
    // Two different species do produce it — just only that one pair.
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], mid: [150], variant: [150] }, [
        { a: 'aa', b: 'bb', child: 'variant' },
      ]),
    )
    expect(t.crossSpeciesImpossible.has('variant')).toBe(false)
    expect(t.candidates).not.toContain('variant')
  })

  it('treats a self-referential unique combo as no combo at all', () => {
    // 26 species — the legendaries — list only `X × X → X`. Honouring that as a
    // unique combo makes them look pairable and yields the advice "you need a
    // Jetragon, which you cannot breed". They are cross-species impossible.
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], mid: [150], legend: [900, true] }, [
        { a: 'legend', b: 'legend', child: 'legend' },
      ]),
    )
    expect(t.unique.size).toBe(0)
    expect(t.crossSpeciesImpossible.has('legend')).toBe(true)
    // And it still breeds true with itself, via the same-species rule.
    expect(childOf(t, 'legend', 'legend')).toBe('legend')
  })

  it('keeps a real unique combo when a self entry sits beside it', () => {
    // 90 species carry both. Dropping the self entry must not drop the pair.
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], mid: [150], variant: [150] }, [
        { a: 'variant', b: 'variant', child: 'variant' },
        { a: 'aa', b: 'bb', child: 'variant' },
      ]),
    )
    expect(t.unique.size).toBe(1)
    expect(childOf(t, 'aa', 'bb')).toBe('variant')
    expect(t.crossSpeciesImpossible.has('variant')).toBe(false)
  })

  it('clamps a target above every candidate to the top one', () => {
    // Not hypothetical: five species carry a sentinel rank of 9999 while the
    // top real candidate sits at 3080, so most of `byTarget` is this clamp.
    const t = buildBreedingTable(
      data({ sentinel: [9999, true], aa: [100], top: [300] }),
    )
    expect(childOf(t, 'sentinel', 'sentinel')).toBe('sentinel')
    expect(childOf(t, 'sentinel', 'top')).toBe('top')
  })

  it('returns nothing for a species it has never heard of', () => {
    const t = buildBreedingTable(data({ aa: [100], bb: [200] }))
    expect(childOf(t, 'aa', 'nope')).toBeUndefined()
    expect(childOf(t, 'nope', 'nope')).toBeUndefined()
  })

  it('resolves ids whatever their casing', () => {
    // Level saves do not lowercase `characterId`; reference data does.
    const t = buildBreedingTable(data({ aa: [100], bb: [200], mid: [150] }))
    expect(childOf(t, 'AA', 'Bb')).toBe('mid')
  })

  it('keys a pair identically either way round', () => {
    expect(pairKey('bb', 'aa')).toBe(pairKey('aa', 'bb'))
  })
})

/* -------------------------------------------------------------------------
   Stock
   ------------------------------------------------------------------------- */

describe('buildStock', () => {
  const table = buildBreedingTable(data({ aa: [100], bb: [200], mid: [150] }))

  it('tallies genders and reports the ones the save does not record', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('aa', { gender: 'Female' }),
      pal('aa'),
    ])
    const aa = s.bySpecies.get('aa')!
    expect(aa.male).toHaveLength(1)
    expect(aa.female).toHaveLength(1)
    expect(aa.unknown).toHaveLength(1)
    expect(s.counted).toBe(3)
    expect(s.skippedNoGender).toBe(1)
  })

  it('folds unknown genders in only when asked, and still reports them', () => {
    const s = stockOf(table, [pal('aa', { gender: 'Male' }), pal('aa')], {
      assumeUnknownGender: true,
    })
    const aa = s.bySpecies.get('aa')!
    expect(aa.female).toHaveLength(1)
    // The count stays, so the footer can say what was assumed.
    expect(s.skippedNoGender).toBe(1)
    expect(s.assumedUnknownGender).toBe(true)
  })

  it('lowercases the level save’s casing', () => {
    const s = stockOf(table, [pal('AA', { gender: 'Male' })])
    expect(s.bySpecies.has('aa')).toBe(true)
  })

  it('skips species the breeding data does not know', () => {
    const s = stockOf(table, [pal('whatever', { gender: 'Male' })])
    expect(s.bySpecies.size).toBe(0)
    expect(s.skippedUnknownSpecies).toBe(1)
  })

  it('counts unowned pals for nobody, but counts them', () => {
    const s = buildStock(
      index([
        pal('aa', { gender: 'Male' }),
        pal('aa', { gender: 'Female', ownerPlayerUid: undefined }),
      ]),
      table,
      OWNER,
    )
    expect(s.counted).toBe(1)
    expect(s.unownedInWorld).toBe(1)
  })

  it('names species held in one gender only', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    expect(s.singleGender).toEqual(['aa'])
  })

  it('is empty rather than broken for a player with no pals', () => {
    const s = stockOf(table, [])
    expect(s.counted).toBe(0)
    expect(s.bySpecies.size).toBe(0)
  })

  it('leaves the guild out unless asked', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
    ])
    expect(s.counted).toBe(1)
    expect(s.includedGuild).toBe(false)
    // The guild is still *named*, so the toggle can offer it.
    expect(s.guild?.name).toBe('The Guild')
    expect(s.guild?.palCount).toBe(2)
  })

  it('pools the guild when asked', () => {
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male' }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    expect(s.counted).toBe(2)
    expect(s.includedGuild).toBe(true)
    expect(s.countedOwn).toBe(1)
    expect(s.countedBorrowed).toBe(1)
    expect(s.byOwner.get(MATE)).toBe(1)
  })

  it('counts base workers only under the toggle', () => {
    const pals = [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female', ownerPlayerUid: undefined }),
    ]
    const alone = stockOf(table, pals)
    expect(alone.counted).toBe(1)
    expect(alone.countedUnowned).toBe(0)
    expect(alone.unownedInWorld).toBe(1)

    const pooled = stockOf(table, pals, POOL)
    expect(pooled.counted).toBe(2)
    expect(pooled.countedUnowned).toBe(1)
    // Ownerless pals must not invent a map key.
    expect(pooled.byOwner.has('')).toBe(false)
  })

  it('leaves a pal outside the guild out of the pool', () => {
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male' }),
        pal('bb', {
          gender: 'Female',
          ownerPlayerUid: MATE,
          groupId: undefined,
        }),
      ],
      POOL,
    )
    expect(s.counted).toBe(1)
  })

  it('never loses the player’s own pals to the wider pool', () => {
    // `palsByGuild` is keyed on the pal's own group_id, so an own pal with no
    // group would vanish if pooling replaced rather than unioned. A toggle that
    // loses stock is a bug nobody suspects.
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male', groupId: undefined }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    expect(s.counted).toBe(2)
    expect(s.bySpecies.has('aa')).toBe(true)
  })

  it('has nothing to pool for a player in no guild', () => {
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male' }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
      { guildless: true },
    )
    expect(s.guild).toBeUndefined()
    expect(s.includedGuild).toBe(false)
    expect(s.counted).toBe(1)
  })

  it('treats an Organization as no guild', () => {
    // `guildById` holds seven empty bookkeeping groups on a real save; pooling
    // one would offer nothing.
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male' }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
      { type: 'Organization' },
    )
    expect(s.guild).toBeUndefined()
    expect(s.includedGuild).toBe(false)
    expect(s.counted).toBe(1)
  })

  it('splits the pool three ways, and they add up', () => {
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male' }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
        pal('mid', { gender: 'Male', ownerPlayerUid: undefined }),
      ],
      POOL,
    )
    expect(s.countedOwn + s.countedBorrowed + s.countedUnowned).toBe(s.counted)
    expect([s.countedOwn, s.countedBorrowed, s.countedUnowned]).toEqual([
      1, 1, 1,
    ])
  })

  it('counts own instances per gender, for the tie-break', () => {
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male' }),
        pal('aa', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    const aa = s.bySpecies.get('aa')!
    expect([aa.male.length, aa.female.length]).toEqual([1, 1])
    expect([aa.ownMale, aa.ownFemale]).toEqual([1, 0])
  })
})

/* -------------------------------------------------------------------------
   Routes
   ------------------------------------------------------------------------- */

describe('planFor', () => {
  const table = buildBreedingTable(
    data({ aa: [100], bb: [200], mid: [150], top: [175], far: [900] }),
  )

  it('finds a one-step route from a legal pair', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    const p = plan(table, s, 'mid')
    expect(p.status).toBe('plan')
    expect(p.generations).toBe(1)
    expect(p.steps).toHaveLength(1)
    expect(p.steps[0]!.species).toBe('mid')
  })

  it('refuses a pair that is two of the same gender', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Male' }),
    ])
    expect(plan(table, s, 'mid').status).toBe('unreachable')
  })

  it('opens the route once the other gender is present', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    expect(plan(table, s, 'mid').status).toBe('plan')
  })

  it('needs both genders of one species to pair it with itself', () => {
    // Owning one is not a route to another. A lone male has no legal pair, so
    // there is no plan — but `ownedTarget` still says they have it, which is
    // what lets the view distinguish "you have one" from "you cannot get one".
    const one = stockOf(table, [pal('aa', { gender: 'Male' })])
    const lone = plan(table, one, 'aa')
    expect(lone.status).toBe('unreachable')
    expect(lone.ownedTarget).toHaveLength(1)

    // Add a female and the same species becomes a route to itself.
    const both = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('aa', { gender: 'Female' }),
    ])
    expect(plan(table, both, 'aa').status).toBe('plan')
  })

  it('treats a bred species as available in either gender', () => {
    // `mid` comes from aa×bb; reaching `top` then needs mid×bb, which only
    // works because the bred `mid` can be whichever gender is required.
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    const p = plan(table, s, 'top')
    expect(p.status).toBe('plan')
    expect(p.generations).toBe(2)
  })

  it('orders steps so a parent always refers to an earlier one', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    const p = plan(table, s, 'top')
    for (const step of p.steps) {
      for (const parent of [step.a, step.b]) {
        if (parent.kind === 'bred') expect(parent.step).toBeLessThan(step.n)
      }
    }
  })

  it('prefers the shorter route when a target is reachable two ways', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
      // Male, so it can pair with the female `bb` — a second female would be
      // an illegal pair and the route would vanish rather than shorten.
      pal('mid', { gender: 'Male' }),
    ])
    // `top` is mid×bb — one step now that `mid` is owned, not two.
    const p = plan(table, s, 'top')
    expect(p.generations).toBe(1)
  })

  it('counts a shared intermediate once in the steps', () => {
    const t = buildBreedingTable(
      data({ aa: [100], bb: [300], mid: [200], end: [200] }, [
        { a: 'mid', b: 'mid', child: 'end' },
      ]),
    )
    const s = stockOf(t, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    const p = plan(t, s, 'end')
    expect(p.status).toBe('plan')
    // mid appears on both sides of the final pair but is one egg to hatch.
    expect(p.steps.filter((x) => x.species === 'mid')).toHaveLength(1)
    expect(p.steps.at(-1)!.selfPair).toBe(true)
  })

  it('still plans, and reports the instances, for a target already owned', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
      pal('mid', { gender: 'Male' }),
    ])
    const p = plan(table, s, 'mid')
    expect(p.ownedTarget).toHaveLength(1)
    expect(p.status).toBe('plan')
  })

  it('picks the highest-IV instance of each gender', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male', ivHp: 10, ivAttack: 10, ivDefense: 10 }),
      pal('aa', { gender: 'Male', ivHp: 90, ivAttack: 90, ivDefense: 90 }),
      pal('bb', { gender: 'Female' }),
    ])
    const p = plan(table, s, 'mid')
    const owned = [p.steps[0]!.a, p.steps[0]!.b].find(
      (x) => x.kind === 'owned' && x.species === 'aa',
    )
    expect(owned?.kind === 'owned' && owned.use?.ivHp).toBe(90)
  })

  it('gives a same-species pair one of each gender', () => {
    // Picking each side's gender independently is how you end up advising
    // "Chikipi ♂ × Chikipi ♂", which is not a pairing at all.
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('aa', { gender: 'Female' }),
    ])
    const step = plan(table, s, 'aa').steps[0]!
    expect(step.selfPair).toBe(true)
    const genders = [step.a, step.b].map((x) =>
      x.kind === 'owned' ? x.gender : undefined,
    )
    expect(genders).toEqual(['Male', 'Female'])
  })

  it('gives a two-species root pair complementary genders', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Female' }),
      pal('bb', { gender: 'Male' }),
    ])
    const step = plan(table, s, 'mid').steps[0]!
    const genders = [step.a, step.b].map((x) =>
      x.kind === 'owned' ? x.gender : undefined,
    )
    expect([...genders].sort()).toEqual(['Female', 'Male'])
    // And each side is assigned the gender it actually has.
    for (const side of [step.a, step.b]) {
      if (side.kind === 'owned') expect(side.use?.gender).toBe(side.gender)
    }
  })

  it('leaves a bred parent’s gender unconstrained', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    const last = plan(table, s, 'top').steps.at(-1)!
    const bred = [last.a, last.b].find((x) => x.kind === 'bred')
    expect(bred).toBeDefined()
  })

  it('reports every route that ties, and pins one on request', () => {
    // Two distinct pairs both average onto `mid`.
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], cc: [140], dd: [160], mid: [150] }),
    )
    const s = stockOf(t, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
      pal('cc', { gender: 'Male' }),
      pal('dd', { gender: 'Female' }),
    ])
    const p = plan(t, s, 'mid')
    expect(p.options.length).toBeGreaterThan(1)

    const second = p.options[1]!
    const pinned = plan(t, s, 'mid', second)
    expect(pairKey(pinned.options[0]!.a, pinned.options[0]!.b)).toBe(
      pairKey(p.options[0]!.a, p.options[0]!.b),
    )
    expect(pinned.steps[0]!.species).toBe('mid')
    // A stale pin falls back rather than inventing a route.
    const stale = plan(t, s, 'mid', { a: 'aa', b: 'aa' })
    expect(stale.status).toBe('plan')
  })

  it('unlocks a pair a guildmate completes', () => {
    // The whole point of the toggle: you hold the male, they hold the female.
    const pals = [
      pal('aa', { gender: 'Male' }),
      pal('aa', { gender: 'Female', ownerPlayerUid: MATE }),
    ]
    const alone = plan(table, stockOf(table, pals), 'aa')
    expect(alone.status).toBe('unreachable')
    expect(alone.ownedTarget).toHaveLength(1)

    const pooled = plan(table, stockOf(table, pals, POOL), 'aa')
    expect(pooled.status).toBe('plan')
    expect(pooled.steps[0]!.selfPair).toBe(true)
    expect(pooled.borrowed).toHaveLength(1)
    expect(pooled.borrowed[0]!.ownerUid).toBe(MATE)
  })

  it('prefers the route through the player’s own pals when the eggs tie', () => {
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], cc: [140], dd: [160], mid: [150] }),
    )
    const s = stockOf(
      t,
      [
        // Theirs.
        pal('cc', { gender: 'Male' }),
        pal('dd', { gender: 'Female' }),
        // A guildmate's — reachable, and alphabetically first, so the id
        // tie-break alone would have picked this pair.
        pal('aa', { gender: 'Male', ownerPlayerUid: MATE }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    const p = plan(t, s, 'mid')
    expect(p.status).toBe('plan')
    // The set is not narrowed — both are real one-egg routes.
    expect(p.options.length).toBeGreaterThan(1)
    expect([p.options[0]!.a, p.options[0]!.b].sort()).toEqual(['cc', 'dd'])
    expect(p.borrowed).toHaveLength(0)
  })

  it('breaks a sub-route tie on borrowing too', () => {
    // Exercises `costs()` rather than `planFor`'s sort: `mid` is an intermediate
    // here, so its parent pair is chosen inside the closure.
    const t = buildBreedingTable(
      data({ aa: [100], bb: [200], cc: [140], dd: [160], mid: [150], top: [175] }), // prettier-ignore
    )
    const s = stockOf(
      t,
      [
        pal('cc', { gender: 'Male' }),
        pal('dd', { gender: 'Female' }),
        pal('aa', { gender: 'Male', ownerPlayerUid: MATE }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    const reach = reachFrom(s, t)
    expect(reach.borrow.get('mid')).toBe(0)
    expect([reach.best.get('mid')!.a, reach.best.get('mid')!.b].sort()).toEqual(
      ['cc', 'dd'],
    )
  })

  it('orients a root pair towards the pals the player owns', () => {
    // Both orientations are legal here. Scoring one and rendering the other is
    // the failure this guards: the borrow count would contradict the step list.
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Female' }),
        pal('bb', { gender: 'Male' }),
        pal('aa', { gender: 'Male', ownerPlayerUid: MATE }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    const step = plan(table, s, 'mid').steps[0]!
    for (const side of [step.a, step.b]) {
      if (side.kind !== 'owned') continue
      expect(side.use?.ownerPlayerUid).toBe(OWNER)
      expect(side.use?.gender).toBe(side.gender)
    }
    expect(plan(table, s, 'mid').borrowed).toHaveLength(0)
  })

  it('prefers a pal of the player’s own over a better one they must borrow', () => {
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male', ivHp: 10, ivAttack: 10, ivDefense: 10 }),
        pal('aa', {
          gender: 'Male',
          ownerPlayerUid: MATE,
          ivHp: 90,
          ivAttack: 90,
          ivDefense: 90,
        }),
        pal('aa', { gender: 'Female' }),
      ],
      POOL,
    )
    const step = plan(table, s, 'aa').steps[0]!
    const male = [step.a, step.b].find(
      (x) => x.kind === 'owned' && x.gender === 'Male',
    )
    expect(male?.kind === 'owned' && male.use?.ownerPlayerUid).toBe(OWNER)
  })

  it('falls back to a borrowed pal when they own none of that gender', () => {
    const s = stockOf(
      table,
      [
        pal('aa', { gender: 'Male' }),
        pal('aa', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    const step = plan(table, s, 'aa').steps[0]!
    const female = [step.a, step.b].find(
      (x) => x.kind === 'owned' && x.gender === 'Female',
    )
    expect(female?.kind === 'owned' && female.use?.ownerPlayerUid).toBe(MATE)
  })

  it('names every borrowed pal once, even when a step is shared', () => {
    const t = buildBreedingTable(
      data({ aa: [100], bb: [300], mid: [200], end: [200] }, [
        { a: 'mid', b: 'mid', child: 'end' },
      ]),
    )
    const s = stockOf(
      t,
      [
        pal('aa', { gender: 'Male', ownerPlayerUid: MATE }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    const p = plan(t, s, 'end')
    expect(p.status).toBe('plan')
    // `mid` is consumed twice but its two roots are two pals, not four.
    expect(p.borrowed).toHaveLength(2)
    const ids = p.borrowed.map((b) => b.pal.instanceId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('borrows nothing, and reorders nothing, with the guild left out', () => {
    // The safety property behind this whole change.
    const pals = [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ]
    const implicit = plan(table, stockOf(table, pals), 'top')
    const explicit = plan(
      table,
      stockOf(table, pals, { includeGuild: false }),
      'top',
    )
    expect(implicit).toEqual(explicit)
    expect(implicit.borrowed).toHaveLength(0)
    const reach = reachFrom(stockOf(table, pals), table)
    expect([...reach.borrow.values()].every((v) => v === 0)).toBe(true)
  })

  it('is deterministic across runs', () => {
    // Map iteration order plus an unstable sort is exactly how this would
    // otherwise develop a personality between two loads of one save.
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    const a = plan(table, s, 'top')
    const b = plan(table, s, 'top')
    expect(a.steps.map((x) => [x.n, x.species])).toEqual(
      b.steps.map((x) => [x.n, x.species]),
    )
    expect(a.options).toEqual(b.options)

    // And with a pooled stock, where there is a borrow count to be unstable.
    const pooled = stockOf(
      table,
      [
        pal('aa', { gender: 'Male' }),
        pal('bb', { gender: 'Female', ownerPlayerUid: MATE }),
      ],
      POOL,
    )
    const c = plan(table, pooled, 'top')
    const d = plan(table, pooled, 'top')
    expect(c.steps.map((x) => [x.n, x.species])).toEqual(
      d.steps.map((x) => [x.n, x.species]),
    )
    expect(c.options).toEqual(d.options)
    expect(c.borrowed).toEqual(d.borrowed)
  })
})

/* -------------------------------------------------------------------------
   When there is no route
   ------------------------------------------------------------------------- */

describe('planFor — the honest failures', () => {
  const table = buildBreedingTable(
    data({ aa: [100], bb: [200], mid: [150], orphan: [500, true] }),
  )

  it('says no-stock for a player with nothing', () => {
    const p = plan(table, stockOf(table, []), 'mid')
    expect(p.status).toBe('unreachable')
    expect(p.reason).toBe('no-stock')
  })

  it('says cross-species-impossible, not unbreedable', () => {
    const s = stockOf(table, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    const p = plan(table, s, 'orphan')
    expect(p.reason).toBe('cross-species-impossible')
    // And the escape hatch is real: a pair of them breeds true.
    expect(childOf(table, 'orphan', 'orphan')).toBe('orphan')
  })

  it('names the unreachable parent of a unique-combo target', () => {
    const t = buildBreedingTable(
      data(
        { aa: [100], bb: [200], mid: [150], rare: [900, true], variant: [150] }, // prettier-ignore
        [{ a: 'aa', b: 'rare', child: 'variant' }],
      ),
    )
    const s = stockOf(t, [
      pal('aa', { gender: 'Male' }),
      pal('bb', { gender: 'Female' }),
    ])
    const p = plan(t, s, 'variant')
    expect(p.reason).toBe('needs-unique-parents')
    expect(p.blockers[0]!.missing.map((m) => m.species)).toContain('rare')
  })

  it('says not-in-data for a species the reference data lacks', () => {
    const s = stockOf(table, [pal('aa', { gender: 'Male' })])
    expect(plan(table, s, 'nonesuch').status).toBe('not-in-data')
  })

  it('says no-data, and does not throw, without a table', () => {
    const s = stockOf(undefined, [pal('aa', { gender: 'Male' })])
    const p = planFor(undefined, undefined, s, 'mid')
    expect(p.status).toBe('no-data')
    expect(p.steps).toEqual([])
  })
})

/* -------------------------------------------------------------------------
   Scale
   ------------------------------------------------------------------------- */

describe('reachFrom', () => {
  it('converges well inside the round guard on a full-size ladder', () => {
    // 304 species at real-looking rank spacing, from a two-species stock.
    const pals: Record<string, [number]> = {}
    for (let i = 0; i < 304; i++) pals[`s${i}`] = [10 + i * 10]
    const t = buildBreedingTable(data(pals))
    const s = stockOf(t, [
      pal('s0', { gender: 'Male' }),
      pal('s303', { gender: 'Female' }),
    ])
    const r = reachFrom(s, t)
    expect(r.rounds).toBeLessThan(24)
    expect(r.depth.size).toBeGreaterThan(2)
  })
})
