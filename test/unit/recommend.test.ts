/**
 * Party and base recommendations.
 *
 * The passives below copy their effects from the real `skills.json` rows they
 * are named after, because the point of several tests is that the real numbers
 * come out the right way round — Musclehead's −50% work speed, Diet Lover's
 * negative-is-good hunger. The species are invented.
 */

import { describe, expect, it } from 'vitest'

import {
  advisePassives,
  bestFighters,
  bestMounts,
  bestWorkers,
  breedablePicks,
  fightReason,
  mountGaps,
  partyAdvice,
  locator,
  matchup,
  ownedFighters,
  ownedWorkers,
  scorePassive,
  sidesFor,
  opponentPool,
  speciesPool,
  strongSkills,
  workLevel,
  type GoalInput,
  type SideSpec,
} from '@/domain/recommend.ts'
import { against, multiplier, strongAgainst } from '@/domain/typeChart.ts'
import type {
  PassiveEffect,
  PassiveInfo,
  Refdata,
  SpeciesInfo,
} from '@/refdata/refdata.ts'
import type { Pal, SaveIndex } from '@/domain/types.ts'

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

const fx = (
  type: string,
  value: number,
  target: PassiveEffect['target'] = 'self',
): PassiveEffect => ({ type, value, target })

const passive = (
  name: string,
  effects: PassiveEffect[],
  source: PassiveInfo['source'] = 'random',
): PassiveInfo => ({ name, rank: 1, source, effects })

const PASSIVES: Record<string, PassiveInfo> = {
  artisan: passive('Artisan', [fx('CraftSpeed', 50)]),
  musclehead: passive('Musclehead', [
    fx('ShotAttack', 30),
    fx('CraftSpeed', -50),
  ]),
  dietlover: passive('Diet Lover', [fx('FullStomatch_Decrease', -15)]),
  glutton: passive('Glutton', [fx('FullStomatch_Decrease', 10)]),
  insomnia: passive('Insomnia', [fx('Nocturnal', 0)]),
  nightowl: passive('Night Owl', [fx('NightOwl', 0)]),
  babysitter: passive(
    'Babysitter',
    [
      fx('PalEggHatchingSpeed', 30, 'base'),
      fx('BreedSpeed_InBaseCamp', 30, 'base'),
    ],
    'mutation',
  ),
  philanthropist: passive('Philanthropist', [fx('BreedSpeed', 100)]),
  leader: passive('Motivational Leader', [fx('CraftSpeed', 25, 'trainer')]),
  foreman: passive('Mine Foreman', [fx('Mining', 25, 'trainer')]),
  pyro: passive('Pyromaniac', [fx('ElementBoost_Fire', 10)]),
  legend: passive(
    'Legend',
    [fx('ShotAttack', 20), fx('Defense', 20), fx('MoveSpeed', 20)],
    'exclusive',
  ),
  immortality: passive(
    'Immortality',
    [fx('LifeSteal', 5), fx('AutoHPRegeneRate', 100), fx('ShotAttack', 15)],
    'mutation',
  ),
  ranchmaster: passive('Ranch Master', [
    fx('WorkSuitabilityAddRank_MonsterFarm', 2),
  ]),
}

const species = (s: Partial<SpeciesInfo>): SpeciesInfo => ({
  name: 'x',
  ...s,
})

const stats = (attack: number, craftSpeed = 100, food = 3, rideSpeed = 0) => ({
  hp: 100,
  attack,
  melee: 100,
  defense: 100,
  craftSpeed,
  food,
  runSpeed: 400,
  rideSpeed,
})

const DATA = {
  species: {
    miner: species({
      element1: 'Earth',
      work: { Mining: 3 },
      stats: stats(90, 100, 5),
    }),
    frugal: species({
      element1: 'Earth',
      work: { Mining: 3 },
      stats: stats(90, 100, 2),
    }),
    digger: species({
      element1: 'Normal',
      work: { Mining: 4 },
      stats: stats(70, 80, 6),
    }),
    splash: species({
      element1: 'Water',
      work: { Watering: 2 },
      stats: stats(100),
    }),
    flame: species({ element1: 'Fire', stats: stats(120) }),
    bird: species({
      element1: 'Normal',
      mount: 'flying',
      stats: stats(80, 100, 3, 1400),
    }),
    jet: species({
      element1: 'Dragon',
      mount: 'flying',
      stats: stats(140, 100, 3, 3300),
    }),
    npc: species({ element1: 'Normal', work: { Mining: 9 } }),
  },
  passives: PASSIVES,
  work: [],
  landmarks: [],
  items: {},
  structures: {},
  expTable: [],
  breeding: {
    pals: Object.fromEntries(
      ['miner', 'frugal', 'digger', 'splash', 'flame', 'bird', 'jet'].map(
        (id) => [id, { combiRank: 1, ignoreCombi: false }],
      ),
    ),
    uniqueCombos: [],
  },
  skills: {
    fireball: { name: 'Fireball', element: 'Fire', power: 150, cooldown: 30 },
    spark: { name: 'Spark', element: 'Fire', power: 30, cooldown: 2 },
    unique_flame_bite: {
      name: 'Flame Bite',
      element: 'Fire',
      power: 999,
      cooldown: 1,
    },
    aqua: { name: 'Aqua Gun', element: 'Water', power: 40, cooldown: 4 },
  },
  elements: {},
} satisfies Refdata

const INPUT: GoalInput = { work: [], opponentElements: [], attackElements: [] }

const side = (goal: Parameters<typeof sidesFor>[0], input = INPUT, s = 0) =>
  sidesFor(goal, input)[s]!

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
    ...overrides,
  }
}

const nowhere = () => 'unknown' as const

/* -------------------------------------------------------------------------
   The element chart
   ------------------------------------------------------------------------- */

describe('typeChart', () => {
  it('follows both cycles, with fire beating two', () => {
    expect(multiplier('Leaf', 'Earth')).toBe(2)
    expect(multiplier('Earth', 'Electricity')).toBe(2)
    expect(multiplier('Electricity', 'Water')).toBe(2)
    expect(multiplier('Water', 'Fire')).toBe(2)
    expect(multiplier('Fire', 'Leaf')).toBe(2)
    expect(multiplier('Fire', 'Ice')).toBe(2)
    expect(multiplier('Ice', 'Dragon')).toBe(2)
    expect(multiplier('Dragon', 'Dark')).toBe(2)
    expect(multiplier('Dark', 'Normal')).toBe(2)
  })

  it('makes the reverse direction weak and anything else neutral', () => {
    expect(multiplier('Earth', 'Leaf')).toBe(0.5)
    expect(multiplier('Normal', 'Dark')).toBe(0.5)
    expect(multiplier('Normal', 'Fire')).toBe(1)
    expect(multiplier('Water', 'Water')).toBe(1)
  })

  it('reads display names and enum tokens as well as internal names', () => {
    expect(multiplier('Grass', 'EPalElementType::Earth')).toBe(2)
  })

  it('multiplies across a dual-element defender', () => {
    // Fire beats Leaf and Ice both.
    expect(against('Fire', ['Leaf', 'Ice'])).toBe(4)
    // Ground beats Electric, and Grass beats Ground — even.
    expect(against('Earth', ['Electricity', 'Leaf'])).toBe(1)
  })

  it('lists what beats a defender, hardest first', () => {
    expect(strongAgainst(['Leaf', 'Ice'])).toEqual([
      { element: 'Fire', multiplier: 4 },
    ])
    expect(strongAgainst(['Electricity']).map((s) => s.element)).toEqual([
      'Earth',
    ])
  })
})

/* -------------------------------------------------------------------------
   Passives
   ------------------------------------------------------------------------- */

describe('scorePassive', () => {
  const base = side('work', { ...INPUT, work: ['Mining'] }, 1)
  const fight = side('fight', {
    ...INPUT,
    opponentElements: ['Leaf'],
    attackElements: ['Fire'],
  })

  it('sinks Musclehead for a worker and raises it for a fight', () => {
    expect(scorePassive('m', PASSIVES.musclehead!, base).score).toBe(-50)
    expect(scorePassive('m', PASSIVES.musclehead!, fight).score).toBe(30)
  })

  it('reads less hunger as good', () => {
    expect(scorePassive('d', PASSIVES.dietlover!, base).score).toBe(15)
    expect(scorePassive('g', PASSIVES.glutton!, base).score).toBe(-10)
  })

  it('keeps switches out of the score, in the direction the purpose wants', () => {
    const insomnia = scorePassive('i', PASSIVES.insomnia!, base)
    expect(insomnia.score).toBe(0)
    expect(insomnia.extra).toBeGreaterThan(0)
    expect(scorePassive('n', PASSIVES.nightowl!, base).extra).toBeLessThan(0)
  })

  it('adds only stat multipliers for a fight, and lists regeneration', () => {
    // +100% regen is a percentage of a small base rate, not of a stat.
    const s = scorePassive('i', PASSIVES.immortality!, fight)
    expect(s.score).toBe(15)
    expect(s.counted.map((c) => c.effect.type)).toContain('AutoHPRegeneRate')
  })

  it('counts an element boost only for the element that wins', () => {
    expect(scorePassive('p', PASSIVES.pyro!, fight).score).toBe(10)
    const vsFire = side('fight', {
      ...INPUT,
      opponentElements: ['Fire'],
      attackElements: ['Water'],
    })
    expect(scorePassive('p', PASSIVES.pyro!, vsFire).score).toBe(0)
  })
})

describe('party against base', () => {
  const work = sidesFor('work', { ...INPUT, work: ['Mining'] })
  const party = work.find((s) => s.side === 'party')!
  const base = work.find((s) => s.side === 'base')!

  it('puts trainer-targeted passives in the party and nowhere else', () => {
    expect(scorePassive('l', PASSIVES.leader!, party).score).toBe(25)
    expect(scorePassive('l', PASSIVES.leader!, base).score).toBe(0)
    expect(scorePassive('f', PASSIVES.foreman!, party).score).toBe(25)
  })

  it('does not count a pal’s own work speed while it is in the party', () => {
    expect(scorePassive('a', PASSIVES.artisan!, party).score).toBe(0)
    expect(scorePassive('a', PASSIVES.artisan!, base).score).toBe(50)
  })

  it('only asks for Mine Foreman when mining is one of the jobs', () => {
    const logging = side('work', { ...INPUT, work: ['Deforest'] })
    expect(scorePassive('f', PASSIVES.foreman!, logging).score).toBe(0)
  })

  it('counts building-targeted passives at the breeding base', () => {
    const [breedBase, farm] = sidesFor('breeding', {
      ...INPUT,
      work: ['MonsterFarm'],
    }) as [SideSpec, SideSpec]
    expect(scorePassive('b', PASSIVES.babysitter!, breedBase).score).toBe(60)
    expect(scorePassive('p', PASSIVES.philanthropist!, farm).score).toBe(100)
    expect(scorePassive('p', PASSIVES.philanthropist!, breedBase).score).toBe(0)
    // Ranching was picked, so the rank count is listed.
    expect(scorePassive('r', PASSIVES.ranchmaster!, breedBase).extra).toBe(2)
  })
})

describe('advisePassives', () => {
  const base = side('work', { ...INPUT, work: ['Mining'] }, 1)
  const advice = advisePassives(PASSIVES, base)

  it('sorts into best, also and avoid', () => {
    expect(advice.best.map((s) => s.id)).toEqual(['artisan', 'dietlover'])
    expect(advice.also.map((s) => s.id)).toEqual(['insomnia'])
    expect(advice.avoid.map((s) => s.id)).toEqual([
      'musclehead',
      'glutton',
      'nightowl',
    ])
  })

  it('offers the Breed view only passives a hatch can roll', () => {
    const fight = advisePassives(
      PASSIVES,
      side('fight', { ...INPUT, attackElements: ['Fire'] }),
    )
    // Legend scores highest but comes with its species.
    expect(fight.best[0]!.id).toBe('legend')
    expect(breedablePicks(fight, PASSIVES)).not.toContain('legend')
    expect(breedablePicks(fight, PASSIVES)).toContain('musclehead')
  })
})

/* -------------------------------------------------------------------------
   Species
   ------------------------------------------------------------------------- */

describe('species rankings', () => {
  const pool = speciesPool(DATA)

  it('only ranks real pals', () => {
    expect(pool).not.toContain('npc')
  })

  it('offers tower and raid bosses as opponents, once each', () => {
    const boss = (name: string, element1?: string) => ({ ...species({ element1 }), name }) // prettier-ignore
    const data = {
      ...DATA,
      species: {
        ...DATA.species,
        gym_flame: boss('Tower Boss', 'Fire'),
        // A second phase of the same fight.
        gym_flame_2: boss('Tower Boss', 'Fire'),
        raid_jet: boss('Raid Boss', 'Dragon'),
        // An alpha is the ordinary species again, and a row with no element
        // is nothing to build a party against.
        boss_flame: boss('Flame (Boss)', 'Fire'),
        gym_blank: boss('Blank'),
      },
    } as unknown as Refdata
    const got = opponentPool(data)
    expect(got).toEqual(expect.arrayContaining(speciesPool(data)))
    expect(got.filter((id) => !speciesPool(data).includes(id))).toEqual([
      'gym_flame',
      'raid_jet',
    ])
    // The ranked pool is still only what can be owned.
    expect(speciesPool(data)).not.toContain('gym_flame')
  })

  it('ranks workers by level, then work speed, then appetite', () => {
    expect(bestWorkers(DATA, pool, 'Mining', 5).map((r) => r.id)).toEqual([
      'digger',
      'frugal',
      'miner',
    ])
  })

  it('ranks fighters by matchup before raw attack', () => {
    const rows = bestFighters(DATA, pool, ['Fire'], 3)
    expect(rows[0]!.id).toBe('splash')
    expect(rows[0]!.dealt).toBe(2)
    // Fire hitting Fire is even; it is ranked below the neutral pals that
    // take nothing extra only by what it takes back.
    expect(matchup(DATA, 'flame', ['Fire']).dealt).toBe(1)
  })

  it('leaves unique skills out of the move list', () => {
    expect(strongSkills(DATA, ['Fire'], 3).map((s) => s.id)).toEqual([
      'fireball',
      'spark',
    ])
  })

  it('ranks mounts by riding speed within a kind', () => {
    expect(bestMounts(DATA, pool, 'flying', 5).map((r) => r.id)).toEqual([
      'jet',
      'bird',
    ])
    expect(bestMounts(DATA, pool, 'water', 5)).toEqual([])
  })
})

/* -------------------------------------------------------------------------
   The player's own pals
   ------------------------------------------------------------------------- */

describe('owned pals', () => {
  it('adds the save’s work bonus to the species level', () => {
    const p = pal('Miner', { workSuitabilityBonus: { Mining: 1 } })
    expect(workLevel(DATA, p, 'Mining')).toBe(4)
    // A bonus cannot give a job the species does not do at all.
    expect(workLevel(DATA, pal('Flame', { workSuitabilityBonus: { Mining: 2 } }), 'Mining')).toBe(0) // prettier-ignore
  })

  it('orders workers by level, then by their passives', () => {
    const base = side('work', { ...INPUT, work: ['Mining'] }, 1)
    const lazy = pal('Miner', { passives: ['Musclehead'] })
    const keen = pal('Miner', { passives: ['Artisan'] })
    const best = pal('Digger')
    const rows = ownedWorkers(DATA, [lazy, keen, best], nowhere, 'Mining', base, 5) // prettier-ignore
    expect(rows.map((r) => r.pal)).toEqual([best, keen, lazy])
  })

  it('orders fighters by matchup and finds their strong moves', () => {
    const fight = side('fight', {
      ...INPUT,
      opponentElements: ['Leaf'],
      attackElements: ['Fire'],
    })
    const water = pal('Splash', { level: 50 })
    const fire = pal('Flame', { level: 5, equipWaza: ['Fireball', 'Aqua'] })
    const rows = ownedFighters(DATA, [water, fire], nowhere, ['Leaf'], fight, 5)
    expect(rows[0]!.pal).toBe(fire)
    expect(rows[0]!.strongMoves).toEqual(['Fireball'])
  })

  it('flags a strong move the pal has learned and is not using', () => {
    const fight = side('fight', {
      ...INPUT,
      opponentElements: ['Leaf'],
      attackElements: ['Fire'],
    })
    // `masteredWaza` includes what is equipped, so Aqua is not "learned".
    const fire = pal('Flame', {
      equipWaza: ['Aqua'],
      masteredWaza: ['Aqua', 'Fireball'],
    })
    const [row] = ownedFighters(DATA, [fire], nowhere, ['Leaf'], fight, 5)
    expect(row!.strongMoves).toEqual([])
    expect(row!.learnedMoves).toEqual(['Fireball'])
  })

  it('says why one fighter ranks above another, by the first difference', () => {
    const fight = side('fight', {
      ...INPUT,
      opponentElements: ['Leaf'],
      attackElements: ['Fire'],
    })
    const pals = [
      pal('Flame', { level: 30 }),
      pal('Flame', { level: 10 }),
      pal('Splash', { level: 60 }),
    ]
    const [high, low, water] = ownedFighters(DATA, pals, nowhere, ['Leaf'], fight, 5) // prettier-ignore
    expect(fightReason(high!, water!)).toBe('a better matchup')
    expect(fightReason(high!, low!)).toBe('a higher level')
    // Not better, so no reason: the ranking never claims it.
    expect(fightReason(low!, high!)).toBe('')
  })

  describe('the party against the ranking', () => {
    const ME = 'a'.repeat(32)
    const MATE = 'b'.repeat(32)
    const row = (
      n: number,
      where: 'party' | 'palbox',
      ownerPlayerUid = ME,
    ) => ({
      pal: pal('Flame', {
        instanceId: `${n}`.padStart(32, '0'),
        ownerPlayerUid,
      }),
      where,
      passiveScore: 0,
    })

    it('keeps who the ranking would pick and pairs off the rest', () => {
      // Best first. The party is ranks 1, 4 and 6; the ideal three are 1 to 3.
      const ranked = [
        row(1, 'party'),
        row(2, 'palbox'),
        row(3, 'palbox'),
        row(4, 'party'),
        row(5, 'palbox'),
        row(6, 'party'),
      ]
      const got = partyAdvice(ranked, ME)
      expect(got.party).toEqual([ranked[0], ranked[3], ranked[5]])
      expect(got.keep).toEqual([ranked[0]])
      // The worst carried goes out for the best that is not.
      expect(got.swaps).toEqual([
        { out: ranked[5], in: ranked[1] },
        { out: ranked[3], in: ranked[2] },
      ])
    })

    it('changes nothing when the party is already the top of the list', () => {
      const ranked = [row(1, 'party'), row(2, 'party'), row(3, 'palbox')]
      expect(partyAdvice(ranked, ME).swaps).toEqual([])
    })

    it('does not take a guildmate’s party for the player’s own', () => {
      const ranked = [row(1, 'party', MATE), row(2, 'party'), row(3, 'palbox')]
      const got = partyAdvice(ranked, ME)
      expect(got.party).toEqual([ranked[1]])
      // And a guildmate's pal can still be the one to bring in.
      expect(got.swaps).toEqual([{ out: ranked[1], in: ranked[0] }])
    })

    it('finds the kinds of mount whose fastest is not carried', () => {
      const mount = (
        n: number,
        kind: 'flying' | 'ground',
        speed: number,
        where: 'party' | 'palbox',
      ) =>
        // prettier-ignore
        ({ ...row(n, where), kind, speed })
      const ranked = [
        mount(1, 'flying', 3000, 'palbox'),
        mount(2, 'flying', 1400, 'party'),
        mount(3, 'ground', 900, 'party'),
        mount(4, 'ground', 500, 'palbox'),
      ]
      const gaps = mountGaps(ranked, ME)
      expect(gaps).toEqual([
        { kind: 'flying', best: ranked[0], carried: ranked[1] },
      ])
      // Nothing of a kind in the party at all is a gap too.
      expect(mountGaps([ranked[0]!], ME)).toEqual([
        { kind: 'flying', best: ranked[0], carried: undefined },
      ])
    })
  })

  // The Fight footnote says condensing orders your pals. For a long time
  // nothing read the field, so each tie-break is pinned here: delete one from
  // the sort and the matching test fails.
  it('breaks a fighter tie on condenser rank, then souls, then attack IV', () => {
    const fight = side('fight', {
      ...INPUT,
      opponentElements: ['Leaf'],
      attackElements: ['Fire'],
    })
    const order = (...pals: Pal[]) =>
      ownedFighters(DATA, pals, nowhere, ['Leaf'], fight, 5).map((r) => r.pal)

    const plain = pal('Flame')
    const condensed = pal('Flame', { rank: 2 })
    expect(order(plain, condensed)).toEqual([condensed, plain])

    const souled = pal('Flame', { rankAttack: 3, rankHp: 1 })
    expect(order(plain, souled)).toEqual([souled, plain])
    // Condensing lifts every stat, so it outranks any number of souls.
    expect(order(souled, pal('Flame', { rank: 1 }))[1]).toBe(souled)

    const keen = pal('Flame', { ivAttack: 90 })
    expect(order(plain, keen)).toEqual([keen, plain])
    expect(order(keen, souled)).toEqual([souled, keen])
  })

  it('still puts level ahead of anything condensing can do', () => {
    const fight = side('fight', {
      ...INPUT,
      opponentElements: ['Leaf'],
      attackElements: ['Fire'],
    })
    const high = pal('Flame', { level: 50 })
    const starred = pal('Flame', { level: 10, rank: 4 })
    const rows = ownedFighters(
      DATA,
      [starred, high],
      nowhere,
      ['Leaf'],
      fight,
      5,
    )
    expect(rows.map((r) => r.pal)).toEqual([high, starred])
  })

  it('breaks a worker tie on work-speed souls, then condenser rank', () => {
    const base = side('work', { ...INPUT, work: ['Mining'] }, 1)
    const order = (...pals: Pal[]) =>
      ownedWorkers(DATA, pals, nowhere, 'Mining', base, 5).map((r) => r.pal)

    const plain = pal('Miner')
    const souled = pal('Miner', { rankCraftSpeed: 2 })
    const condensed = pal('Miner', { rank: 3 })
    expect(order(plain, souled)).toEqual([souled, plain])
    expect(order(plain, condensed)).toEqual([condensed, plain])
    expect(order(condensed, souled)).toEqual([souled, condensed])
    // Neither outranks a passive that actually changes work speed.
    const keen = pal('Miner', { passives: ['Artisan'] })
    expect(order(condensed, keen)).toEqual([keen, condensed])
  })

  it('finds where a pal is from the containers the save names', () => {
    const idx = {
      bases: [{ workerContainerId: 'w' }],
      playerDetails: [{ otomoContainerId: 'o', palboxContainerId: 'b' }],
      charContainerById: new Map([['x', { ownerSlot: 'party' }]]),
    } as unknown as SaveIndex
    const where = locator(idx)
    expect(where(pal('a', { containerId: 'w' }))).toBe('base')
    expect(where(pal('a', { containerId: 'o' }))).toBe('party')
    expect(where(pal('a', { containerId: 'b' }))).toBe('palbox')
    expect(where(pal('a', { containerId: 'x' }))).toBe('party')
    expect(where(pal('a'))).toBe('unknown')
  })
})
