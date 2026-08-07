/**
 * The M5 acceptance criteria, against a real save.
 *
 * Everything asserted here is a number I measured from the reference save, for
 * the same reason as the other golden suites: a count moving is the earliest
 * signal that a Palworld update changed the format, and a fuzzy assertion
 * would swallow it.
 *
 * Self-skips without `data/Level.json`, so CI stays green.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildIndexes } from '@/parse/worker/buildIndexes.ts'
import { buildSaveIndex } from '@/domain/index.ts'
import { posToMap, worldToMap } from '@/domain/coords.ts'
import {
  containerLocation,
  searchItems,
  slotGridSize,
  storageTotals,
} from '@/domain/bases.ts'
import type { SaveIndex, Structure } from '@/domain/types.ts'

const LEVEL_JSON = resolve(process.cwd(), 'data/Level.json')
const hasSave = existsSync(LEVEL_JSON)

/** Measured from the reference save. */
const EXPECTED = {
  bases: 2,
  /** Structures per base, largest first. */
  baseStructures: [265, 130],
  /** Chests inside a base camp, and out in the world. */
  baseChests: 98,
  worldChests: 868,
  containers: 1317,
  orphans: 351,
  /** How the 351 orphans break down after inference. */
  orphanPal: 262,
  orphanGuild: 1,
  orphanUnknown: 88,
  /** Distinct item ids anywhere in the save. */
  distinctItems: 333,
  /**
   * Objects carrying a `PasswordLock` module, against those actually locked.
   * The gap is the whole point: reading `lock_state` as a boolean would mark
   * 38 of the 42 as locked, which is why the reader tests the password.
   */
  withLockModule: 42,
  locked: 5,
} as const

describe.skipIf(!hasSave)('golden: bases and inventories', () => {
  let index: SaveIndex

  beforeAll(() => {
    const raw = JSON.parse(readFileSync(LEVEL_JSON, 'utf8'))
    index = buildSaveIndex(buildIndexes(raw, { source: 'json' }))
  })

  const nameOfStructure = (s: Structure) => s.mapObjectId
  const nameOfBase = () => 'Base'

  it('lists every structure of both bases', () => {
    expect(index.bases).toHaveLength(EXPECTED.bases)

    const counts = index.bases
      .map((b) => index.structuresByBase.get(b.baseId)?.length ?? 0)
      .sort((a, b) => b - a)
    expect(counts).toEqual([...EXPECTED.baseStructures])

    // Every base structure must point back at the base that claims it, or the
    // centre pane would show a structure the left pane does not count.
    for (const base of index.bases) {
      for (const s of index.structuresByBase.get(base.baseId) ?? []) {
        expect(s.baseCampId).toBe(base.baseId)
      }
    }
  })

  it('resolves every chest container to the structure holding it', () => {
    const chests = index.structures.filter((s) => s.containerId)
    for (const s of chests) {
      const container = index.containerById.get(s.containerId!)
      expect(container).toBeDefined()
      expect(container!.ownerKind).toBe('structure')
      expect(container!.ownerId).toBe(s.instanceId)
      expect(container!.confidence).toBe('exact')
    }

    expect(chests.filter((s) => s.baseCampId)).toHaveLength(EXPECTED.baseChests)
    expect(chests.filter((s) => !s.baseCampId)).toHaveLength(
      EXPECTED.worldChests,
    )
  })

  it('gives every orphan container an inferred owner or an explicit none', () => {
    const orphans = index.containers.filter((c) => c.ownerKind !== 'structure')
    expect(orphans).toHaveLength(EXPECTED.orphans)

    const by = (kind: string) =>
      orphans.filter((c) => c.ownerKind === kind).length
    expect(by('pal')).toBe(EXPECTED.orphanPal)
    expect(by('guild')).toBe(EXPECTED.orphanGuild)
    expect(by('unknown')).toBe(EXPECTED.orphanUnknown)
    expect(by('pal') + by('guild') + by('unknown')).toBe(EXPECTED.orphans)

    // Every one of them must render with a label — including the 88 that
    // nothing claims, which the explorer shows rather than hides.
    for (const c of orphans) {
      const where = containerLocation(index, c, nameOfStructure, nameOfBase)
      expect(where.label.length).toBeGreaterThan(0)
      expect(where.exact).toBe(false)
    }
  })

  /**
   * The map splits structures on `buildPlayerUid`, not `isBuilt`. This pins
   * why: the two fields nearly agree and are not interchangeable, so using
   * `isBuilt` as a player-built proxy silently mislabels the difference.
   */
  it('distinguishes player-built from base-camp membership', () => {
    const withBuilder = index.structures.filter(
      (s) => s.buildPlayerUid !== undefined,
    )
    const inBase = index.structures.filter((s) => s.isBuilt)
    const both = index.structures.filter(
      (s) => s.buildPlayerUid !== undefined && s.isBuilt,
    )

    expect(withBuilder).toHaveLength(396)
    expect(inBase).toHaveLength(395)
    expect(both).toHaveLength(392)

    // The whole point: neither is a subset of the other.
    expect(withBuilder.length).not.toBe(both.length)
    expect(inBase.length).not.toBe(both.length)

    // `isBuilt` is exactly "has a base camp", nothing more.
    for (const s of index.structures) {
      expect(s.isBuilt).toBe(s.baseCampId !== undefined)
    }

    // And every builder names a real player, which is what lets the Bases
    // view and the map show a name rather than a GUID.
    for (const s of withBuilder) {
      expect(index.playerByUid.has(s.buildPlayerUid!)).toBe(true)
    }
  })

  it('leaves most loot chests unbuilt, which is why they get their own layer', () => {
    const containers = index.structures.filter((s) => s.containerId)
    const built = containers.filter((s) => s.buildPlayerUid !== undefined)

    expect(containers).toHaveLength(966)
    // ~90% of containers are world loot. If player-built chests were left in
    // the chest layer, turning chests off would hide your own storage too.
    expect(built).toHaveLength(95)
    expect(built.length / containers.length).toBeLessThan(0.2)
  })

  it('marks only genuinely password-locked structures as locked', () => {
    // Counted from the raw tree, so this fails if the module ever moves.
    const raw = JSON.parse(readFileSync(LEVEL_JSON, 'utf8'))
    const objects =
      raw.properties.worldSaveData.value.MapObjectSaveData.value.values
    let withModule = 0
    for (const o of objects) {
      const modules = o?.ConcreteModel?.value?.ModuleMap?.value ?? []
      if (
        modules.some((m: { key?: string }) =>
          m?.key?.endsWith('::PasswordLock'),
        )
      ) {
        withModule += 1
      }
    }
    expect(withModule).toBe(EXPECTED.withLockModule)

    const locked = index.structures.filter((s) => s.locked)
    expect(locked).toHaveLength(EXPECTED.locked)
    expect(locked.length).toBeLessThan(withModule)
  })

  it('finds every stack of a known item, wherever it is', () => {
    expect(index.containersByItem.size).toBe(EXPECTED.distinctItems)

    // Brute force over all 1,317 containers, as the ground truth the inverted
    // index has to match.
    for (const staticId of ['Wood', 'Stone', 'PalSphere']) {
      let expectedTotal = 0
      const expectedContainers = new Set<string>()
      for (const c of index.containers) {
        for (const slot of c.slots) {
          if (slot.staticId !== staticId) continue
          expectedTotal += slot.count
          expectedContainers.add(c.containerId)
        }
      }
      if (expectedTotal === 0) continue

      const hits = searchItems(index, staticId, (id) => id)
      const hit = hits.find((h) => h.staticId === staticId)
      expect(hit, `${staticId} should be found`).toBeDefined()
      // An exact id must outrank a longer one that merely contains it —
      // `PalSphere_Giga` is far more numerous than `PalSphere`.
      expect(hits[0]!.staticId).toBe(staticId)
      expect(hit!.total).toBe(expectedTotal)
      expect(new Set(hit!.places.map((p) => p.containerId))).toEqual(
        expectedContainers,
      )
    }
  })

  it('reaches a container it found through search', () => {
    const hit = searchItems(index, 'Wood', (id) => id).find(
      (h) => h.staticId === 'Wood',
    )
    expect(hit).toBeDefined()
    for (const place of hit!.places) {
      const container = index.containerById.get(place.containerId)
      expect(container).toBeDefined()
      const where = containerLocation(
        index,
        container!,
        nameOfStructure,
        nameOfBase,
      )
      // Exactly the invariant the UI relies on to jump: an exact hit always
      // has a structure to select, and any structure inside a base has a base.
      if (where.exact) {
        expect(where.structure).toBeDefined()
        expect(where.structure!.containerId).toBe(place.containerId)
        if (where.structure!.baseCampId) expect(where.base).toBeDefined()
      }
    }
  })

  it('plots a base plan that agrees with the world map', () => {
    for (const base of index.bases) {
      const origin = posToMap(base.pos)
      expect(origin).toBeDefined()
      expect(origin!.map).toBe('overworld')

      const structures = index.structuresByBase.get(base.baseId) ?? []
      const offsets = structures.flatMap((s) => {
        const at = posToMap(s.pos)
        return at && at.map === origin!.map
          ? [Math.hypot(at.mx - origin!.mx, at.my - origin!.my)]
          : []
      })
      expect(offsets).toHaveLength(structures.length)

      // Taken from the transform rather than written down again here. A
      // hard-coded 725 in this spot went unnoticed for as long as the wrong
      // scale did. A 3,500-unit radius comes out at ~7.6 map units.
      const radius = worldToMap(base.areaRange)
      const median = offsets.sort((a, b) => a - b)[
        Math.floor(offsets.length / 2)
      ]!
      expect(median).toBeLessThan(radius)
      expect(Math.max(...offsets)).toBeLessThan(radius * 10)
    }
  })

  it('sizes container grids from real slot indices', () => {
    let withGaps = 0
    for (const c of index.containers) {
      const size = slotGridSize(c.slots, 6)
      expect(size % 6).toBe(0)
      for (const slot of c.slots) expect(slot.slot).toBeLessThan(size)
      if (c.slots.some((s, i) => s.slot !== i)) withGaps += 1
    }
    // The proof that slot indices are positional rather than sequential, and
    // therefore that the grid must render its gaps.
    expect(withGaps).toBeGreaterThan(0)
  })

  it('totals base storage without double-counting', () => {
    const perBase = index.bases.map((base) =>
      storageTotals(
        index,
        (index.structuresByBase.get(base.baseId) ?? []).flatMap((s) =>
          s.containerId ? [s.containerId] : [],
        ),
      ),
    )
    expect(perBase.reduce((n, t) => n + t.containers, 0)).toBe(
      EXPECTED.baseChests,
    )

    const all = storageTotals(
      index,
      index.containers.map((c) => c.containerId),
    )
    expect(all.containers).toBe(EXPECTED.containers)
    expect(all.stacks).toBe(
      index.containers.reduce((n, c) => n + c.slots.length, 0),
    )
  })
})
