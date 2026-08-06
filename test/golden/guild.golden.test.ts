/**
 * The M4 acceptance criteria, against a real save.
 *
 * Self-skips without `data/Level.json`, so CI stays green.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildIndexes } from '@/parse/worker/buildIndexes.ts'
import { buildSaveIndex, playerGuilds, systemGroups } from '@/domain/index.ts'
import {
  elementDistribution,
  guildTotals,
  levelHistogram,
  passiveFrequency,
  playerSummary,
  workCoverage,
} from '@/domain/guild.ts'
import { savToMapAuto } from '@/domain/coords.ts'
import { WORK_TYPES } from '@/lib/color.ts'
import type { SaveIndex } from '@/domain/types.ts'

const LEVEL_JSON = resolve(process.cwd(), 'data/Level.json')
const hasSave = existsSync(LEVEL_JSON)

/**
 * Measured from the reference save.
 *
 * Deliberately no guild or player *names* here. They identify real people,
 * this file is committed, and `leak.golden.test.ts` enforces it — asserting
 * the shape of a name is as much as a public test may say about it.
 */
const EXPECTED = {
  members: 10,
  /** `memberCount` in the save — every pal handle, not a headcount. */
  handles: 1108,
  bases: 2,
  campLevel: 13,
  markers: 4,
  pals: 1098,
  structures: 395,
  organizations: 7,
  /** Distinct passive assets across the whole roster. */
  passives: 83,
} as const

describe.skipIf(!hasSave)('golden: guild dashboard', () => {
  let index: SaveIndex

  beforeAll(() => {
    const raw = JSON.parse(readFileSync(LEVEL_JSON, 'utf8'))
    index = buildSaveIndex(buildIndexes(raw, { source: 'json' }))
  })

  it('renders one guild and hides seven empty organizations', () => {
    const guilds = playerGuilds(index)
    expect(guilds).toHaveLength(1)
    expect(guilds[0]!.name.length).toBeGreaterThan(0)

    const groups = systemGroups(index)
    expect(groups).toHaveLength(EXPECTED.organizations)
    // The reason they are hidden by default: they would render as seven empty
    // cards and make the app look broken.
    expect(groups.every((g) => g.members.length === 0)).toBe(true)
  })

  it('counts members and handles as different things', () => {
    const guild = playerGuilds(index)[0]!
    const totals = guildTotals(index, guild)

    expect(guild.members).toHaveLength(EXPECTED.members)
    expect(totals.handles).toBe(EXPECTED.handles)
    expect(guild.baseCampLevel).toBe(EXPECTED.campLevel)
    expect(totals.bases).toBe(EXPECTED.bases)
    expect(totals.pals).toHaveLength(EXPECTED.pals)
    expect(totals.structures).toBe(EXPECTED.structures)
    expect(guild.markers).toHaveLength(EXPECTED.markers)

    // The trap this test exists for.
    expect(totals.handles).not.toBe(guild.members.length)
  })

  it('accounts for every pal in the element donut', () => {
    const guild = playerGuilds(index)[0]!
    const pals = index.palsByGuild.get(guild.groupId) ?? []
    expect(pals).toHaveLength(EXPECTED.pals)

    // With reference data absent — the degraded path — everything still adds
    // up, in one honest bucket.
    const degraded = elementDistribution(pals, () => undefined)
    expect(degraded.reduce((n, s) => n + s.count, 0)).toBe(EXPECTED.pals)
    expect(degraded).toHaveLength(1)
    expect(degraded[0]!.display).toBe('Unclassified')

    // And with it, the slices still sum to the roster rather than to the
    // roster plus its dual-element pals.
    const classified = elementDistribution(pals, (id) =>
      id.startsWith('K') ? { element1: 'Fire', element2: 'Dark' } : undefined,
    )
    expect(classified.reduce((n, s) => n + s.count, 0)).toBe(EXPECTED.pals)
  })

  it('bins every pal into the level histogram exactly once', () => {
    const pals = index.palsByGuild.get(playerGuilds(index)[0]!.groupId) ?? []
    const bins = levelHistogram(pals)
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(pals.length)
    expect(bins.at(-1)!.to).toBe(Math.max(...pals.map((p) => p.level)))
  })

  it('reports work coverage over all 13 work types', () => {
    const pals = index.palsByGuild.get(playerGuilds(index)[0]!.groupId) ?? []
    const rows = workCoverage(pals, () => undefined, WORK_TYPES)
    expect(rows).toHaveLength(WORK_TYPES.length)

    // Without reference data, only the pals' own bonuses contribute — so the
    // chart is sparse rather than absent, which is the designed behaviour.
    const withBonus = pals.filter(
      (p) => Object.keys(p.workSuitabilityBonus).length > 0,
    )
    expect(rows.reduce((n, r) => n + r.pals, 0)).toBeGreaterThan(0)
    expect(withBonus.length).toBeGreaterThan(0)
  })

  it('finds the roster’s passives', () => {
    const pals = index.palsByGuild.get(playerGuilds(index)[0]!.groupId) ?? []
    const all = passiveFrequency(pals, () => undefined, 1000)
    expect(all).toHaveLength(EXPECTED.passives)
    // Ranked descending, and every count is real.
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.count).toBeGreaterThanOrEqual(all[i]!.count)
    }
    expect(all.reduce((n, p) => n + p.count, 0)).toBe(
      pals.reduce((n, p) => n + p.passives.length, 0),
    )
  })

  it('summarises all ten players and plots each of their positions', () => {
    const guild = playerGuilds(index)[0]!
    expect(index.players).toHaveLength(EXPECTED.members)

    let attributedPals = 0
    for (const player of index.players) {
      const summary = playerSummary(index, player, guild)
      attributedPals += summary.pals.length
      expect(summary.role).toBeDefined()

      const pos = summary.player.pos
      if (pos) {
        const at = savToMapAuto(pos.x, pos.y)
        expect(Number.isFinite(at.mx)).toBe(true)
        expect(Number.isFinite(at.my)).toBe(true)
      }
    }

    // Every owned pal belongs to exactly one player, so the per-player counts
    // must not exceed the roster.
    expect(attributedPals).toBe(
      index.pals.filter((p) => p.ownerPlayerUid).length,
    )
    expect(attributedPals).toBeLessThanOrEqual(EXPECTED.pals)

    // Exactly one master, and the admin is a real member.
    expect(guild.members.filter((m) => m.role === 1)).toHaveLength(1)
    expect(
      guild.members.some((m) => m.playerUid === guild.adminPlayerUid),
    ).toBe(true)
  })
})
