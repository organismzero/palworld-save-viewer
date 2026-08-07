/**
 * `LocalData.sav` against the real thing.
 *
 * The assertion that matters here is the **alignment** one. The fog mask is a
 * bare texture with no coordinate metadata of any kind — nothing in the file
 * says which corner is the origin, which way the rows run, or what map extent
 * it covers. All of that is inferred, and the only way to hold the inference
 * honest is to check it against positions the level save records independently.
 *
 * Player-built structures are the right probe: you cannot build somewhere you
 * have not been, so every one of them must land on explored ground. In the
 * reference save all 396 do, under the identity mapping and under no other.
 *
 * Self-skips without `data/LocalData.sav` and `data/Level.json`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { mapToPixel, savToMapAuto } from '@/domain/coords.ts'
import { buildSaveIndex } from '@/domain/index.ts'
import { inferOwner } from '@/store/saveStore.ts'
import { decodeSav } from '@/parse/sav/decode.ts'
import { readGvas } from '@/parse/sav/gvas.ts'
import { buildIndexes } from '@/parse/worker/buildIndexes.ts'
import { readLocalData } from '@/parse/worker/readers/localData.ts'
import { Warnings } from '@/parse/warnings.ts'
import type { FogMask, LocalDataPayload, SlimPayload } from '@/domain/types.ts'

const DATA = resolve(process.cwd(), 'data')
const LOCAL_SAV = join(DATA, 'LocalData.sav')
const LEVEL_JSON = join(DATA, 'Level.json')
const hasBoth = existsSync(LOCAL_SAV) && existsSync(LEVEL_JSON)

function arrayBufferOf(path: string): ArrayBuffer {
  const buf = readFileSync(path)
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer
}

describe.skipIf(!hasBoth)('golden: LocalData.sav', () => {
  let local: LocalDataPayload
  let level: SlimPayload
  let warnings: Warnings
  let overworld: FogMask

  beforeAll(async () => {
    const decoded = await decodeSav(arrayBufferOf(LOCAL_SAV))
    if (!decoded.ok) throw new Error(`decode failed: ${decoded.message}`)
    warnings = new Warnings()
    local = readLocalData(readGvas(decoded.gvas), 'LocalData.sav', warnings)
    overworld = local.fog.find((f) => f.map === 'overworld')!
    level = buildIndexes(JSON.parse(readFileSync(LEVEL_JSON, 'utf8')), {
      source: 'json',
    })
  }, 120_000)

  it('decompresses Oodle to the size the header promised', async () => {
    const decoded = await decodeSav(arrayBufferOf(LOCAL_SAV))
    expect(decoded.ok).toBe(true)
    expect(decoded.container?.format).toBe('PlM')
    expect(decoded.ok && decoded.gvas.length).toBe(5_540_626)
  })

  it('reads every SaveData key without a warning', () => {
    // 17 keys, all accounted for. A new one here is the first sign of a
    // save-format change, which is the whole reason the warning exists.
    expect(warnings.list()).toEqual([])
    expect(local.warnings).toEqual([])
  })

  it('finds one mask per map, at the sizes the game stores', () => {
    expect(local.fog.map((f) => [f.map, f.size])).toEqual([
      ['overworld', 1024],
      ['tree', 512],
    ])
    // A quarter of the file's bytes, because RGB carries nothing.
    expect(overworld.alpha.length).toBe(1024 * 1024)
  })

  it('agrees with the world about how much has been explored', () => {
    expect(overworld.exploredFraction).toBeCloseTo(0.069, 3)
    // The World Tree is untouched in this save, and its mask says so with the
    // only two byte values it contains.
    expect(local.fog.find((f) => f.map === 'tree')!.exploredFraction).toBe(0)
  })

  /**
   * The alignment assertion.
   *
   * `mapToPixel(mx, my, size, size)` is the transform every marker on the map
   * already uses, and the claim is that the mask needs nothing else — no flip,
   * no transpose, no offset. If a patch ever moves the mask, this fails loudly
   * instead of the fog quietly sliding off the terrain it describes.
   */
  it('lines up with every structure a player built', () => {
    const built = level.structures.filter(
      (s) => s.pos && s.buildPlayerUid !== undefined,
    )
    expect(built.length).toBe(396)

    const unexplored = built.filter((s) => {
      const at = savToMapAuto(s.pos!.x, s.pos!.y)
      if (at.map !== 'overworld') return false
      const { px, py } = mapToPixel(
        at.mx,
        at.my,
        overworld.size,
        overworld.size,
      )
      const i = Math.round(py) * overworld.size + Math.round(px)
      return !(overworld.alpha[i]! < 128)
    })

    expect(unexplored).toEqual([])
  })

  /**
   * The same probe, run against the seven other ways the texture could have
   * been laid out. Without this the test above proves far less than it looks:
   * the explored region is a blob near the middle, and a wrong orientation can
   * still catch a cluster of buildings by luck.
   */
  it('rules out every flip and transpose of the mask', () => {
    const N = overworld.size
    const orientations: [string, (x: number, y: number) => [number, number]][] =
      [
        ['flipX', (x, y) => [N - 1 - x, y]],
        ['flipY', (x, y) => [x, N - 1 - y]],
        ['flipXY', (x, y) => [N - 1 - x, N - 1 - y]],
        ['transpose', (x, y) => [y, x]],
        ['rot90', (x, y) => [N - 1 - y, x]],
        ['rot270', (x, y) => [y, N - 1 - x]],
        ['antitranspose', (x, y) => [N - 1 - y, N - 1 - x]],
      ]

    // Every overworld structure, not just the built ones: the world's own
    // scenery is spread across the whole island, so it discriminates where a
    // cluster of buildings cannot.
    const points = level.structures
      .filter((s) => s.pos)
      .map((s) => savToMapAuto(s.pos!.x, s.pos!.y))
      .filter((at) => at.map === 'overworld')
      .map((at) => mapToPixel(at.mx, at.my, N, N))
    expect(points.length).toBe(1504)

    const score = (f: (x: number, y: number) => [number, number]) =>
      points.filter((p) => {
        const [x, y] = f(Math.round(p.px), Math.round(p.py))
        if (x < 0 || y < 0 || x >= N || y >= N) return false
        return overworld.alpha[y * N + x]! < 128
      }).length / points.length

    const identity = score((x, y) => [x, y])
    // Against a map that is only 6.9% explored, this is not a near-miss.
    expect(identity).toBeGreaterThan(0.8)
    for (const [name, f] of orientations) {
      expect(`${name} ${score(f) < identity}`).toBe(`${name} true`)
    }
  })

  it('resolves every pal in every party preset', () => {
    const byId = new Map(level.pals.map((p) => [p.instanceId, p]))
    const ids = local.presets.flatMap((p) => p.palIds)

    expect(local.presets).toHaveLength(6)
    expect(ids).toHaveLength(30)
    expect(ids.filter((id) => !byId.has(id))).toEqual([])
  })

  it('names one owner, unanimously', () => {
    // The file itself names nobody — its PlayerUId fields are the zero GUID —
    // so attribution rests entirely on the preset pals agreeing. Run through
    // the real function rather than a copy of it, or this asserts nothing
    // about the code that ships.
    const index = buildSaveIndex(level)
    const uid = inferOwner(local, index)

    expect(uid).toBeDefined()
    expect(index.playerByUid.get(uid!)?.name).toBeTypeOf('string')
  })

  it('refuses to name an owner when the presets disagree', () => {
    // Two pals with different owners is a traded pal or a stale id, and
    // guessing there would put the wrong name on somebody's exploration.
    const index = buildSaveIndex(level)
    const owners = [...new Set(level.pals.map((p) => p.ownerPlayerUid))].filter(
      Boolean,
    )
    expect(owners.length).toBeGreaterThan(1)

    const oneOfEach = owners
      .slice(0, 2)
      .map((o) => level.pals.find((p) => p.ownerPlayerUid === o)!.instanceId)

    expect(
      inferOwner(
        { ...local, presets: [{ name: '', palIds: oneOfEach }] },
        index,
      ),
    ).toBeUndefined()
  })

  it('reads the map pin the player placed', () => {
    expect(local.markers).toHaveLength(1)
    expect(local.markers[0]!.at.map).toBe('overworld')
  })
})
