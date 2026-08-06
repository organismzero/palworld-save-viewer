/**
 * The M7 acceptance criterion: `.sav` and `.json` must agree.
 *
 * Both paths run the *same* `buildIndexes` over trees produced two completely
 * different ways — one from `JSON.parse`, one from a binary GVAS reader — and
 * the result has to be identical. That makes this a real cross-check rather
 * than a snapshot: a bug in the binary reader shows up as a disagreement with
 * a known-good file, not as a test that needs updating.
 *
 * Self-skips without `data/Level.sav` and `data/Level.json`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { decodeSav } from '@/parse/sav/decode.ts'
import { readGvas } from '@/parse/sav/gvas.ts'
import { buildIndexes } from '@/parse/worker/buildIndexes.ts'
import { readPlayerSave } from '@/parse/worker/readers/playerSave.ts'
import { Warnings } from '@/parse/warnings.ts'
import type { SlimPayload, Structure } from '@/domain/types.ts'

const DATA = resolve(process.cwd(), 'data')
const LEVEL_SAV = join(DATA, 'Level.sav')
const LEVEL_JSON = join(DATA, 'Level.json')
const hasBoth = existsSync(LEVEL_SAV) && existsSync(LEVEL_JSON)

function arrayBufferOf(path: string): ArrayBuffer {
  const buf = readFileSync(path)
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer
}

describe.skipIf(!hasBoth)(
  'golden: .sav and .json produce the same index',
  () => {
    let fromSav: SlimPayload
    let fromJson: SlimPayload
    let gvasBytes = 0

    beforeAll(async () => {
      const decoded = await decodeSav(arrayBufferOf(LEVEL_SAV))
      if (!decoded.ok) throw new Error(`decode failed: ${decoded.message}`)
      gvasBytes = decoded.gvas.length
      fromSav = buildIndexes(readGvas(decoded.gvas), { source: 'sav' })
      fromJson = buildIndexes(JSON.parse(readFileSync(LEVEL_JSON, 'utf8')), {
        source: 'json',
      })
    }, 120_000)

    it('decompresses Oodle to the size the header promised', () => {
      expect(gvasBytes).toBe(13_793_869)
    })

    it('agrees on every entity, exactly', () => {
      // `source` is the one field that must differ — it records which path ran.
      expect(fromSav.meta.source).toBe('sav')
      expect(fromJson.meta.source).toBe('json')
      expect({ ...fromSav.meta, source: null }).toEqual({
        ...fromJson.meta,
        source: null,
      })

      expect(fromSav.pals).toEqual(fromJson.pals)
      expect(fromSav.players).toEqual(fromJson.players)
      expect(fromSav.guilds).toEqual(fromJson.guilds)
      expect(fromSav.bases).toEqual(fromJson.bases)
      expect(fromSav.containers).toEqual(fromJson.containers)
      expect(fromSav.charContainers).toEqual(fromJson.charContainers)
      expect(fromSav.dynamicItems).toEqual(fromJson.dynamicItems)
      expect(fromSav.dungeons).toEqual(fromJson.dungeons)
      expect(fromSav.stats).toEqual(fromJson.stats)
    })

    /**
     * Structures are compared field by field because of one known, explainable
     * divergence: `concreteModelType` is not stored in the save, it is looked up
     * from the object's id in a table that ships with the converter. This
     * project's table is newer than the one that produced `data/Level.json`, so
     * the `.sav` path can name a model the JSON left blank — in the reference
     * save, exactly one `SkinChange` object.
     *
     * The invariant asserted is therefore "identical, except that the binary
     * path may know a model name the JSON path did not". A disagreement in any
     * other field, or a case where the JSON knows a name the binary path does
     * not, is a real bug.
     */
    it('agrees on structures, up to a newer model-name table', () => {
      expect(fromSav.structures).toHaveLength(fromJson.structures.length)

      let extraNames = 0
      for (const [i, sav] of fromSav.structures.entries()) {
        const json = fromJson.structures[i]!
        expect(sav.instanceId).toBe(json.instanceId)

        const { concreteModelType: savType, ...savRest } = sav
        const { concreteModelType: jsonType, ...jsonRest } = json
        expect(savRest).toEqual(jsonRest)

        if (savType === jsonType) continue
        // Only ever a gain, never a loss or a disagreement.
        expect(jsonType).toBeUndefined()
        expect(savType).toBeTypeOf('string')
        extraNames += 1
      }

      // Pinned so the drift stays visible: if a regenerated Level.json closes
      // the gap this drops to 0, and if it grows something else has changed.
      expect(extraNames).toBe(1)
    })

    it('resolves every structure the JSON path resolved', () => {
      // The cheapest proof that the concrete-model and module blobs decoded:
      // the chest → container links all come out of them.
      const chests = (s: Structure[]) => s.filter((x) => x.containerId).length
      expect(chests(fromSav.structures)).toBe(chests(fromJson.structures))
      expect(chests(fromSav.structures)).toBe(966)
    })

    it('reads player saves from .sav as well as .json', async () => {
      const players = join(DATA, 'Players')
      if (!existsSync(players)) return

      const savs = readdirSync(players).filter(
        (f) => f.endsWith('.sav') && !f.includes('_dps'),
      )
      expect(savs.length).toBeGreaterThan(0)

      for (const name of savs) {
        const decoded = await decodeSav(arrayBufferOf(join(players, name)))
        expect(decoded.ok, `${name} should decode`).toBe(true)
        if (!decoded.ok) continue

        const warn = new Warnings()
        const fromBinary = readPlayerSave(readGvas(decoded.gvas), name, warn)

        const jsonPath = join(players, name.replace(/\.sav$/, '.json'))
        if (!existsSync(jsonPath)) continue
        const fromText = readPlayerSave(
          JSON.parse(readFileSync(jsonPath, 'utf8')),
          name,
          new Warnings(),
        )
        // `sourceFileName` is the only field allowed to differ, and here it does
        // not because both were handed the same name.
        expect(fromBinary).toEqual(fromText)
      }
    }, 120_000)
  },
)
