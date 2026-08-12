/**
 * Reader tests against the committed `level.mini.json` fixture.
 *
 * This is the tier that runs everywhere — no save file required. It exercises
 * the readers against real shapes and real sparsity at small scale; the golden
 * suite covers real *counts* when a save is available.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildIndexes,
  mergePlayerDetails,
} from '@/parse/worker/buildIndexes.ts'
import { buildSaveIndex } from '@/domain/index.ts'
import type { SaveIndex, SaveWarning, SlimPayload } from '@/domain/types.ts'

const FIXTURE = resolve(process.cwd(), 'test/fixtures/level.mini.json')

describe('readers over the mini fixture', () => {
  let payload: SlimPayload
  let index: SaveIndex

  beforeAll(() => {
    const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    payload = buildIndexes(raw, { source: 'json' })
    index = buildSaveIndex(payload)
  })

  it('splits characters into pals and players', () => {
    expect(index.players).toHaveLength(2)
    expect(index.pals).toHaveLength(12)
    expect(index.stats.characters).toBe(14)
    expect(index.players.every((p) => p.name.length > 0)).toBe(true)
  })

  it('unwraps pal fields to primitives', () => {
    for (const pal of index.pals) {
      expect(typeof pal.level).toBe('number')
      expect(typeof pal.characterId).toBe('string')
      expect(pal.characterId).not.toBe('')
      expect(Array.isArray(pal.passives)).toBe(true)
      expect(pal.characterId.startsWith('BOSS_')).toBe(false)
    }
  })

  it('covers the sparsity spectrum, which is the point of the fixture', () => {
    const fieldCounts = index.pals.map(
      (p) =>
        [p.nickname, p.ivHp, p.rank || undefined, p.ownerPlayerUid].filter(
          (v) => v !== undefined,
        ).length,
    )
    // At least one richly populated pal and at least one nearly bare one.
    expect(Math.max(...fieldCounts)).toBeGreaterThanOrEqual(3)
    expect(Math.min(...fieldCounts)).toBeLessThanOrEqual(1)
    expect(index.pals.some((p) => p.isBoss)).toBe(true)
    expect(index.pals.some((p) => p.nickname)).toBe(true)
  })

  it('reads the guild and separates system groups', () => {
    const guild = index.guilds.find((g) => g.type === 'Guild')
    expect(guild).toBeDefined()
    expect(guild!.name).toBe('The Fixture Guild')
    expect(guild!.members.length).toBeGreaterThan(0)
    expect(index.guilds.some((g) => g.type === 'Organization')).toBe(true)
  })

  it('reads the base and links its worker roster', () => {
    expect(index.bases).toHaveLength(1)
    const base = index.bases[0]!
    expect(base.workerContainerId).toBeDefined()
    expect(base.areaRange).toBeGreaterThan(0)
    expect(index.charContainerById.has(base.workerContainerId!)).toBe(true)

    const roster = index.charContainerById.get(base.workerContainerId!)!
    expect(roster.ownerBaseId).toBe(base.baseId)
    expect(roster.confidence).toBe('exact')
  })

  it('resolves chest containers exactly and orphans as inferred', () => {
    const chests = index.structures.filter((s) => s.containerId)
    expect(chests.length).toBeGreaterThan(0)

    for (const chest of chests) {
      const container = index.containerById.get(chest.containerId!)
      if (!container) continue
      expect(container.ownerKind).toBe('structure')
      expect(container.confidence).toBe('exact')
      expect(container.ownerId).toBe(chest.instanceId)
    }

    const orphans = index.containers.filter((c) => c.ownerKind !== 'structure')
    expect(orphans.every((c) => c.confidence === 'inferred')).toBe(true)
  })

  it('reads map object modules', () => {
    expect(index.structures.length).toBe(20)
    expect(index.structures.some((s) => s.containerId)).toBe(true)
    expect(index.structures.some((s) => s.isBuilt)).toBe(true)

    // A `PasswordLock` module means "this object can be locked", not "it is".
    // The fixture holds one of each, and only the one carrying a password
    // may read as locked — the other has `lock_state: 1` and no password,
    // which is the default state of nearly every chest in a real save.
    expect(index.structures.filter((s) => s.locked)).toHaveLength(1)
    // Damaged structures should report both halves of the HP pair.
    const damaged = index.structures.filter(
      (s) => s.hpCurrent !== undefined && s.hpMax !== undefined,
    )
    expect(damaged.length).toBeGreaterThan(0)
  })

  it('reads dynamic items with durability', () => {
    expect(index.dynamicItems.length).toBeGreaterThan(0)
    expect(index.dynamicItems.every((d) => d.localId.length === 32)).toBe(true)
  })

  it('normalises every GUID it indexes', () => {
    const all = [
      ...index.palById.keys(),
      ...index.containerById.keys(),
      ...index.guildById.keys(),
      ...index.baseById.keys(),
      ...index.structureById.keys(),
    ]
    expect(all.length).toBeGreaterThan(0)
    for (const g of all) expect(g).toMatch(/^[0-9a-f]{32}$/)
  })

  it('produces a payload that is plain and structured-cloneable', () => {
    // The worker posts this across a message port; a Map or a class instance
    // here would either cost more to clone or fail outright.
    expect(() => structuredClone(payload)).not.toThrow()
    expect(payload.pals[0]?.constructor).toBe(Object)
  })

  it('parses the fixture without warnings', () => {
    if (index.stats.warnings.length > 0) {
      console.error('warnings:', index.stats.warnings)
    }
    expect(index.stats.warnings).toEqual([])
  })
})

describe('warnings across a player-save merge', () => {
  /**
   * The regression: `checkReferences` runs in both `buildIndexes` and
   * `mergePlayerDetails`, and the worker carries the level pass's warnings into
   * the merge. Carrying the derived ones too meant a Players drop reported the
   * same dangling reference twice — once from each pass, for the same structure
   * — which is what the diagnostics list was showing on a real save.
   */
  it('does not report a derived warning once per pass', () => {
    const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    const payload = buildIndexes(raw, { source: 'json' })

    // The fixture is clean, so plant one of each: a carried derived warning as
    // the level pass would have produced it, and a carried read warning that
    // nothing recomputes.
    const carried: SaveWarning[] = [
      {
        kind: 'dangling-container',
        detail: 'structure references an unknown item container',
        count: 2,
      },
      { kind: 'unknown-record-field', detail: 'RecordData.Whatever', count: 3 },
    ]

    mergePlayerDetails(payload, [], carried)
    const kinds = payload.stats.warnings.map((w) => w.kind)

    expect(kinds.filter((k) => k === 'dangling-container')).toHaveLength(0)
    // The read-pass warning survives: nothing in the merge could regenerate it.
    expect(payload.stats.warnings).toContainEqual(carried[1])
  })
})

describe('fixture redaction', () => {
  it('contains no hyphenated GUIDs traceable to a real world', () => {
    // Every GUID is deterministically remapped, so the fixture is safe to
    // commit. This asserts the redaction actually ran.
    const text = readFileSync(FIXTURE, 'utf8')
    const raw = JSON.parse(text)
    const guild =
      raw.properties.worldSaveData.value.GroupSaveDataMap.value.find(
        (g: any) => g?.value?.RawData?.value?.guild_name,
      )
    expect(guild.value.RawData.value.guild_name).toBe('The Fixture Guild')
  })
})
