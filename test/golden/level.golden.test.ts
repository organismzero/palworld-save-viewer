/**
 * Full-pipeline test against a real save.
 *
 * `data/` is gitignored, so this suite self-skips when no save is present and
 * CI stays green. Locally it is the only thing that exercises the readers
 * against the real sparsity, the real GUID spellings and the real scale.
 *
 * The expected counts below were measured from the reference save. They are
 * deliberately exact: if a Palworld update changes the save format, a count
 * moving is the signal, and a fuzzy assertion would hide it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

import { buildIndexes } from '@/parse/worker/buildIndexes.ts'
import { buildSaveIndex, ivTotal, speciesCounts } from '@/domain/index.ts'
import { savToMapAuto } from '@/domain/coords.ts'
import type { SaveIndex } from '@/domain/types.ts'

const LEVEL_JSON = resolve(process.cwd(), 'data/Level.json')
const hasSave = existsSync(LEVEL_JSON)

/** Measured from the reference save. */
const EXPECTED = {
  characters: 1108,
  players: 10,
  pals: 1098,
  /**
   * Distinct species *after* stripping the `BOSS_` prefix. The raw
   * `CharacterID` values number 140, because alphas are stored as a separate
   * `BOSS_Foo` id alongside the ordinary `Foo`; collapsing them is the point.
   */
  species: 116,
  speciesRaw: 140,
  structures: 1504,
  /**
   * 967 map objects carry an `ItemContainer` module, but one of them — an
   * `Expedition` object — has a zero-GUID `target_container_id`, which is not
   * a real link and is dropped. 966 chests actually resolve.
   */
  chestStructures: 966,
  containers: 1317,
  orphanContainers: 351,
  charContainers: 32,
  guilds: 1,
  organizations: 7,
  bases: 2,
  dungeons: 149,
  dynamicItems: 221,
} as const

describe.skipIf(!hasSave)('golden: real Level.json', () => {
  let index: SaveIndex
  let parseMs = 0
  let indexMs = 0
  let payloadBytes = 0

  beforeAll(() => {
    const text = readFileSync(LEVEL_JSON, 'utf8')

    let t = performance.now()
    const raw = JSON.parse(text)
    parseMs = performance.now() - t

    t = performance.now()
    const payload = buildIndexes(raw, { source: 'json' })
    indexMs = performance.now() - t

    payloadBytes = JSON.stringify(payload).length
    index = buildSaveIndex(payload)
  })

  it('reads the expected number of characters', () => {
    expect(index.stats.characters).toBe(EXPECTED.characters)
    expect(index.stats.players).toBe(EXPECTED.players)
    expect(index.stats.pals).toBe(EXPECTED.pals)
    expect(index.pals.length + index.players.length).toBe(EXPECTED.characters)
  })

  it('reads the expected species spread', () => {
    expect(index.stats.species).toBe(EXPECTED.species)
    expect(index.palsByCharacterId.size).toBe(EXPECTED.species)
  })

  it('collapses BOSS_ variants onto their base species', () => {
    // Without stripping, alphas would double-count as separate species and a
    // dex view would show BOSS_Alpaca sitting next to Alpaca.
    expect(index.pals.filter((p) => p.characterId.startsWith('BOSS_'))).toEqual(
      [],
    )

    const bosses = index.pals.filter((p) => p.isBoss)
    expect(bosses.length).toBeGreaterThan(0)
    // Every alpha's stripped id must land in the same bucket as its base form.
    for (const boss of bosses) {
      expect(index.palsByCharacterId.has(boss.characterId)).toBe(true)
    }
    // The gap between the raw and collapsed counts is exactly the number of
    // alpha species that *also* occur in ordinary form — those are the ones
    // that merge. Alpha-only species (13 here) still contribute a species
    // each, so the gap is smaller than the alpha species count.
    const plain = new Set(
      index.pals.filter((p) => !p.isBoss).map((p) => p.characterId),
    )
    const bossSpecies = new Set(bosses.map((p) => p.characterId))
    const merged = [...bossSpecies].filter((s) => plain.has(s)).length

    expect(EXPECTED.speciesRaw - EXPECTED.species).toBe(merged)
    expect(bossSpecies.size).toBeGreaterThan(merged)
    expect(plain.size + bossSpecies.size - merged).toBe(EXPECTED.species)
  })

  it('reads guilds and organizations separately', () => {
    expect(index.stats.guilds).toBe(EXPECTED.guilds)
    expect(index.stats.organizations).toBe(EXPECTED.organizations)

    const guild = index.guilds.find((g) => g.type === 'Guild')!
    expect(guild.members.length).toBe(EXPECTED.players)
    expect(guild.baseIds.length).toBe(EXPECTED.bases)
    expect(guild.baseCampLevel).toBeGreaterThan(0)
    // The reference save was written by a client new enough to use the V2 tail.
    expect(guild.hasV2Tail).toBe(true)
    expect(guild.members.every((m) => m.name.length > 0)).toBe(true)
  })

  it('reads bases and their worker rosters', () => {
    expect(index.stats.bases).toBe(EXPECTED.bases)
    for (const base of index.bases) {
      expect(base.workerContainerId).toBeDefined()
      expect(base.areaRange).toBeGreaterThan(0)
      expect(index.charContainerById.has(base.workerContainerId!)).toBe(true)
    }
  })

  it('reads structures and resolves every chest to its container', () => {
    expect(index.stats.structures).toBe(EXPECTED.structures)

    const withContainer = index.structures.filter((s) => s.containerId)
    expect(withContainer.length).toBe(EXPECTED.chestStructures)
    // Every one of those links must resolve — a dangling link here means the
    // ModuleMap path drifted.
    for (const s of withContainer) {
      expect(index.containerById.has(s.containerId!)).toBe(true)
    }
  })

  it('reads containers and marks orphans as inferred', () => {
    expect(index.stats.containers).toBe(EXPECTED.containers)
    expect(index.stats.orphanContainers).toBe(EXPECTED.orphanContainers)
    expect(index.stats.charContainers).toBe(EXPECTED.charContainers)

    const claimed = index.containers.filter((c) => c.ownerKind === 'structure')
    expect(claimed.length).toBe(EXPECTED.chestStructures)
    expect(claimed.every((c) => c.confidence === 'exact')).toBe(true)
    expect(
      index.containers
        .filter((c) => c.ownerKind !== 'structure')
        .every((c) => c.confidence === 'inferred'),
    ).toBe(true)
  })

  it('reads dungeons and dynamic items', () => {
    expect(index.stats.dungeons).toBe(EXPECTED.dungeons)
    expect(index.stats.dynamicItems).toBe(EXPECTED.dynamicItems)
    expect(index.dynamicItems.some((d) => (d.durability ?? 0) > 0)).toBe(true)
  })

  it('unwraps pal fields rather than leaving them as GVAS wrappers', () => {
    // The ByteProperty double-nest would show up here as objects, not numbers.
    for (const pal of index.pals) {
      expect(typeof pal.level).toBe('number')
      expect(Number.isFinite(pal.level)).toBe(true)
      if (pal.ivHp !== undefined) {
        expect(pal.ivHp).toBeGreaterThanOrEqual(0)
        expect(pal.ivHp).toBeLessThanOrEqual(100)
      }
    }
    // A real save has pals across the whole level range.
    const levels = index.pals.map((p) => p.level)
    expect(Math.max(...levels)).toBeGreaterThan(1)
    expect(index.pals.some((p) => ivTotal(p) > 0)).toBe(true)
  })

  it('links pals to their guild, owner and pal container', () => {
    const withGuild = index.pals.filter((p) => p.groupId)
    expect(withGuild.length).toBeGreaterThan(0)
    for (const p of withGuild)
      expect(index.guildById.has(p.groupId!)).toBe(true)

    const owned = index.pals.filter((p) => p.ownerPlayerUid)
    expect(owned.length).toBeGreaterThan(0)

    for (const p of index.pals) {
      if (p.containerId) {
        expect(index.charContainerById.has(p.containerId)).toBe(true)
      }
    }
  })

  it('maps player status points out of Japanese', () => {
    for (const player of index.players) {
      expect(player.name.length).toBeGreaterThan(0)
      for (const key of Object.keys(player.statusPoints)) {
        // A raw Japanese key here means the mapping table missed one.
        expect(key).toMatch(/^[a-zA-Z]+$/)
      }
    }
    expect(
      index.players.some((p) => Object.keys(p.statusPoints).length > 0),
    ).toBe(true)
  })

  it('places every positioned entity on a known map', () => {
    const positioned = [
      ...index.structures.map((s) => s.pos),
      ...index.bases.map((b) => b.pos),
    ]
    for (const pos of positioned) {
      const at = savToMapAuto(pos.x, pos.y)
      expect(at.map === 'overworld' || at.map === 'tree').toBe(true)
      expect(Number.isFinite(at.mx)).toBe(true)
      expect(Number.isFinite(at.my)).toBe(true)
    }

    // Structures should sit inside the overworld bounds, not scattered past
    // them — that is what a wrong scale constant looks like.
    const overworld = index.structures
      .map((s) => savToMapAuto(s.pos.x, s.pos.y))
      .filter((p) => p.map === 'overworld')
    expect(overworld.length).toBeGreaterThan(index.structures.length * 0.9)
    for (const p of overworld) {
      expect(Math.abs(p.mx)).toBeLessThanOrEqual(1000)
      expect(Math.abs(p.my)).toBeLessThanOrEqual(1000)
    }
  })

  it('builds the inverted item index', () => {
    expect(index.containersByItem.size).toBeGreaterThan(0)
    for (const [, rows] of index.containersByItem) {
      // Sorted by count, descending.
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1]!.count).toBeGreaterThanOrEqual(rows[i]!.count)
      }
    }
    const [top] = speciesCounts(index)
    expect(top!.count).toBeGreaterThan(1)
  })

  it('parses within budget and produces a small payload', () => {
    // Reference save measures ~270 ms to parse and ~1.85 MB of payload. The
    // budgets below are headroom over that, and exist to catch a regression
    // that starts dragging the raw tree across the worker boundary — the
    // payload is three orders of magnitude smaller than the 74 MB input and
    // must stay that way.
    expect(parseMs).toBeLessThan(2000)
    expect(indexMs).toBeLessThan(2000)
    expect(payloadBytes).toBeLessThan(2.5e6)
  })

  it('reports no parse warnings for a healthy save', () => {
    // Any warning here means a field moved. Print it rather than just failing.
    if (index.stats.warnings.length > 0) {
      console.error('warnings:', index.stats.warnings)
    }
    expect(index.stats.warnings).toEqual([])
  })
})

describe.skipIf(hasSave)('golden: skipped', () => {
  it('needs data/Level.json — see README', () => {
    expect(hasSave).toBe(false)
  })
})
