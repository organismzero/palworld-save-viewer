/**
 * Guild dashboard aggregates.
 *
 * Each of these has an answer for "reference data is missing" that is part of
 * the contract rather than an accident, so the degraded path is tested as
 * deliberately as the happy one.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  elementDistribution,
  guildTotals,
  levelHistogram,
  levelProgress,
  passiveFrequency,
  playerSummary,
  workCoverage,
} from '@/domain/guild.ts'
import { buildIndexes } from '@/parse/worker/buildIndexes.ts'
import { buildSaveIndex, playerGuilds } from '@/domain/index.ts'
import { WORK_TYPES } from '@/lib/color.ts'
import type { Pal, SaveIndex } from '@/domain/types.ts'

const FIXTURE = resolve(process.cwd(), 'test/fixtures/level.mini.json')

function pal(level: number, overrides: Partial<Pal> = {}): Pal {
  return {
    instanceId: `${level}`.padStart(32, '0'),
    characterId: 'Kitsunebi',
    isBoss: false,
    isRare: false,
    level,
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

describe('levelHistogram', () => {
  it('bins to the roster’s own ceiling, not the game’s', () => {
    // A save whose best pal is level 12 should not be drawn with ten empty
    // bins trailing off to 60.
    const bins = levelHistogram([pal(1), pal(6), pal(12)], 5)
    expect(bins).toHaveLength(3)
    expect(bins.at(-1)!.to).toBe(12)
    expect(bins.map((b) => b.count)).toEqual([1, 1, 1])
  })

  it('puts every pal in exactly one bin', () => {
    const pals = Array.from({ length: 40 }, (_, i) => pal(i + 1))
    const bins = levelHistogram(pals, 5)
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(pals.length)
  })

  it('handles an empty roster', () => {
    expect(levelHistogram([], 5)).toEqual([])
  })
})

describe('elementDistribution', () => {
  const species = (id: string) =>
    id === 'Kitsunebi'
      ? { element1: 'EPalElementType::Fire', element2: 'Dark' }
      : undefined

  it('counts a dual-element pal once, so the slices sum to the roster', () => {
    const pals = [pal(1), pal(2), pal(3)]
    const slices = elementDistribution(pals, species)
    expect(slices.reduce((n, s) => n + s.count, 0)).toBe(pals.length)
    expect(slices).toHaveLength(1)
    expect(slices[0]!.display).toBe('Fire')
  })

  it('shows unclassifiable pals rather than dropping them', () => {
    const pals = [pal(1), pal(2, { characterId: 'MysteryBeast' })]
    const slices = elementDistribution(pals, species)
    expect(slices.reduce((n, s) => n + s.count, 0)).toBe(2)
    expect(slices.some((s) => s.display === 'Unclassified')).toBe(true)
  })

  it('degrades to one unclassified bucket with no reference data', () => {
    const slices = elementDistribution([pal(1), pal(2)], () => undefined)
    expect(slices).toEqual([
      expect.objectContaining({ display: 'Unclassified', count: 2 }),
    ])
  })
})

describe('workCoverage', () => {
  const species = (id: string) =>
    id === 'Kitsunebi' ? { work: { EmitFlame: 2 } } : undefined

  it('stacks a pal’s own bonus on its species base', () => {
    const rows = workCoverage(
      [pal(1, { workSuitabilityBonus: { EmitFlame: 1 } })],
      species,
      WORK_TYPES,
    )
    const flame = rows.find((r) => r.id === 'EmitFlame')!
    expect(flame.pals).toBe(1)
    expect(flame.levels).toBe(3)
  })

  it('counts a bonus for work the species cannot do at all', () => {
    const rows = workCoverage(
      [pal(1, { workSuitabilityBonus: { Watering: 1 } })],
      species,
      WORK_TYPES,
    )
    expect(rows.find((r) => r.id === 'Watering')!.levels).toBe(1)
  })

  it('keeps zero-coverage work types, because the gap is the point', () => {
    const rows = workCoverage([pal(1)], species, WORK_TYPES)
    expect(rows).toHaveLength(WORK_TYPES.length)
    expect(rows.find((r) => r.id === 'Watering')).toEqual({
      id: 'Watering',
      display: 'Watering',
      pals: 0,
      levels: 0,
    })
  })
})

describe('passiveFrequency', () => {
  it('ranks by count and resolves names, falling back to the asset id', () => {
    const pals = [
      pal(1, { passives: ['Runner', 'Legend'] }),
      pal(2, { passives: ['Runner'] }),
    ]
    const rows = passiveFrequency(pals, (a) =>
      a === 'Runner' ? { name: 'Runner', rank: 2 } : undefined,
    )
    expect(rows[0]).toEqual({
      asset: 'Runner',
      name: 'Runner',
      rank: 2,
      count: 2,
    })
    expect(rows[1]).toEqual({
      asset: 'Legend',
      name: 'Legend',
      rank: undefined,
      count: 1,
    })
  })
})

describe('levelProgress', () => {
  const table = [
    { level: 1, total: 0 },
    { level: 2, total: 100 },
    { level: 3, total: 300 },
  ]

  it('measures across the band between this level and the next', () => {
    expect(levelProgress(2, 200, table)).toBeCloseTo(0.5)
    expect(levelProgress(1, 0, table)).toBe(0)
  })

  it('refuses rather than guessing when the curve cannot answer', () => {
    // No table at all, and the top of the table where there is no next level.
    expect(levelProgress(2, 200, undefined)).toBeUndefined()
    expect(levelProgress(3, 400, table)).toBeUndefined()
    expect(levelProgress(9, 0, table)).toBeUndefined()
  })

  it('clamps rather than reporting past the end of a level', () => {
    expect(levelProgress(2, 5_000, table)).toBe(1)
    expect(levelProgress(2, 0, table)).toBe(0)
  })
})

describe('over the mini fixture', () => {
  let index: SaveIndex

  beforeAll(() => {
    const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    index = buildSaveIndex(buildIndexes(raw, { source: 'json' }))
  })

  it('never reports the handle count as a member count', () => {
    const guild = playerGuilds(index)[0]
    expect(guild).toBeDefined()
    const totals = guildTotals(index, guild!)
    // `memberCount` in the save counts pal handles too — 1,108 for a 10-player
    // guild in the real save — so the two must never be conflated.
    expect(totals.handles).toBe(guild!.characterHandleIds.length)
    expect(totals.players.length).toBeLessThanOrEqual(guild!.members.length)
  })

  it('summarises a player against their own pals and structures', () => {
    const guild = playerGuilds(index)[0]
    const player = index.players[0]!
    const summary = playerSummary(index, player, guild)

    expect(summary.pals).toEqual(index.palsByOwner.get(player.playerUid) ?? [])
    expect(summary.built).toBe(
      index.structures.filter((s) => s.buildPlayerUid === player.playerUid)
        .length,
    )
    if (summary.best) expect(summary.pals).toContain(summary.best)
  })
})
