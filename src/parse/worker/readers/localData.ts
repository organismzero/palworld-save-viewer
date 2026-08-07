/**
 * Reads `LocalData.sav` — the client's own save.
 *
 * The game keeps this one next to the *client*, not the server, so it is a
 * separate drop from `Level.sav` and it describes exactly one player. What
 * makes it worth reading is that it holds things no other file does: the fog of
 * war, hand-placed map pins, party presets, and the per-client progress flags.
 *
 * ## The fog of war
 *
 * `WorldMapUISaveDataMap` is keyed by map name — `MainMap` for the overworld
 * and `Tree` for the World Tree interior, matching the two `MapKind`s in
 * `domain/coords.ts` — and each entry holds one `MaskTextureData` byte array.
 *
 * That array is an **RGBA texture**, not a bitmap of flags: 1024×1024 for the
 * overworld (4,194,304 bytes) and 512×512 for the tree. RGB is zero everywhere
 * and says nothing; the alpha channel is the fog, running 255 (unexplored) to
 * 0 (explored) through real intermediate values that give the reveal a soft
 * edge. So {@link readMask} keeps alpha and drops the rest, which is a 4×
 * saving on the largest thing this file has to send anywhere.
 *
 * ## What is deliberately not read
 *
 * The party presets embed a full `PalSaveParameter` per slot — a second copy of
 * pals that already exist in the level save. Each slot also carries the pal's
 * instance GUID, and in the reference save all 30 of them resolve, so this
 * reader keeps the GUIDs and discards the copies rather than shipping pal
 * records that can drift out of step with the real ones.
 */

import type {
  CustomMarker,
  FogMask,
  Guid,
  LocalDataPayload,
  OtomoPreset,
} from '../../../domain/types.ts'
import { savToMapAuto, type MapKind } from '../../../domain/coords.ts'
import { arr, int, str, vec3, type Node } from '../../gvas.ts'
import { normGuid } from '../../guid.ts'
import type { Warnings } from '../../warnings.ts'

/**
 * `SaveData` keys this reader understands.
 *
 * Same contract as `playerSave.ts`'s `KNOWN_RECORD_FIELDS`: anything outside
 * the set raises a counted warning, because a new key here is the first sign
 * of a save-format change and a warning is far cheaper than a blank panel.
 */
const KNOWN_SAVE_DATA_FIELDS = new Set([
  // Read below.
  'WorldMapUISaveDataMap',
  'Local_CustomMarkerSaveData',
  'Local_OtomoLoadoutSaveData',
  'Local_PalEncountFlag',
  'Local_NewUnlockedTechs',
  'Local_NewUnlockedBuilds',
  'Local_HiddenLocationFlagMap',
  'Local_TutorialTriggerSaveData',
  'TrackingQuestId',
  /**
   * Present and deliberately unread: a play counter in an unknown unit.
   *
   * The reference save holds 15,297,485. Seconds would be 177 days and
   * milliseconds 4 hours, so it is neither; 60 Hz ticks give 71 h, centiseconds
   * 42 h and 120 Hz 35 h, and the owner's ~40 h Steam total — some of it on a
   * different world — does not separate the last three. Nothing else in any
   * save file cross-references it: the pal `*Sec` timers cap at 298, so they
   * are friendship accumulators that reset rather than lifetime totals.
   *
   * Settling it needs one measurement: play for a known interval and diff this
   * value. Until then it is not worth showing, because every way of formatting
   * it is a guess presented as a fact.
   */
  'Local_PlayTime',
  // Present and deliberately unread: UI state and cosmetic settings with no
  // consumer. Listed so they do not generate noise.
  'Local_ActivateOtomoCount',
  'Local_LoadoutSelectedIndexMap',
  'Local_MapObjectPaintPalette',
  'Local_NoteCheckedFlag',
  'Local_ShowedCutsceneFlag',
  'Local_IsBuildMenuChecked',
  'Local_IgnoreMaskBossSpawnerNames',
])

/** The game's map names, mapped onto ours. */
const MAP_KIND_BY_KEY: Readonly<Record<string, MapKind>> = {
  MainMap: 'overworld',
  Tree: 'tree',
}

const RGBA = 4

function countTrue(n: Node): number {
  let total = 0
  for (const entry of arr<Node>(n)) if (entry?.value === true) total += 1
  return total
}

/**
 * Extracts the alpha channel of one `MaskTextureData`.
 *
 * The byte array arrives as a `Uint8Array` from the binary reader but as a
 * plain number array when the tree came from a converted `.json`, so both are
 * accepted. A length that is not four bytes times a square is a shape this
 * reader does not understand, and it says so rather than rendering nonsense
 * over the map.
 */
function readMask(
  key: string,
  bytes: Uint8Array | number[],
  warn: Warnings,
): FogMask | undefined {
  const map = MAP_KIND_BY_KEY[key]
  if (!map) {
    warn.add('unknown-map-mask', key)
    return undefined
  }

  const pixels = bytes.length / RGBA
  const size = Math.round(Math.sqrt(pixels))
  if (!Number.isInteger(pixels) || size * size !== pixels) {
    warn.add('malformed-map-mask', `${key} is ${bytes.length} bytes`)
    return undefined
  }

  const alpha = new Uint8Array(pixels)
  let explored = 0
  for (let i = 0; i < pixels; i++) {
    const a = bytes[i * RGBA + 3]!
    alpha[i] = a
    // Half opacity is the natural cut: the soft edge sweeps the whole range, so
    // any threshold is a convention, and this one puts the boundary where the
    // fog stops dominating.
    if (a < 128) explored += 1
  }

  return { map, size, alpha, exploredFraction: explored / pixels }
}

function readMasks(n: Node, warn: Warnings): FogMask[] {
  const out: FogMask[] = []
  for (const entry of arr<Node>(n)) {
    if (typeof entry?.key !== 'string') continue
    const bytes = entry.value?.MaskTextureData?.value?.values
    if (!bytes || typeof bytes.length !== 'number') {
      warn.add('malformed-map-mask', `${entry.key} has no MaskTextureData`)
      continue
    }
    const mask = readMask(entry.key, bytes, warn)
    if (mask) out.push(mask)
  }
  return out
}

function readMarkers(n: Node): CustomMarker[] {
  const out: CustomMarker[] = []
  for (const entry of arr<Node>(n)) {
    const pos = vec3(entry?.IconLocation)
    if (!pos) continue
    out.push({
      pos,
      at: savToMapAuto(pos.x, pos.y),
      iconType: int(entry?.IconType) ?? 0,
    })
  }
  return out
}

function readPresets(n: Node): OtomoPreset[] {
  return arr<Node>(n).map((preset) => ({
    name: str(preset?.PresetName) ?? '',
    palIds: arr<Node>(preset?.LoadoutPals)
      .map((slot) => normGuid(slot?.PalInstanceID?.value?.InstanceId?.value))
      .filter((id): id is Guid => id !== undefined),
  }))
}

export function readLocalData(
  raw: Node,
  fileName: string,
  warn: Warnings,
): LocalDataPayload {
  const sd = raw?.properties?.SaveData
  const body = sd?.value

  // The filename is what routed this file here — `.sav` bytes are compressed,
  // so nothing upstream could check the contents. This is where that check
  // happens, and a renamed player save has to fail here rather than three
  // panels later as an empty map.
  if (!body || sd?.struct_type !== 'PalLocalSaveData') {
    throw new Error(
      `${fileName} does not look like a Palworld LocalData save: expected properties.SaveData to be a PalLocalSaveData${
        sd?.struct_type ? `, found ${sd.struct_type}` : ', found nothing'
      }.`,
    )
  }

  for (const key of Object.keys(body)) {
    if (!KNOWN_SAVE_DATA_FIELDS.has(key)) {
      warn.add('unknown-local-field', `SaveData.${key}`)
    }
  }

  const payload: LocalDataPayload = {
    fileName,
    fog: readMasks(body.WorldMapUISaveDataMap, warn),
    markers: readMarkers(body.Local_CustomMarkerSaveData),
    presets: readPresets(body.Local_OtomoLoadoutSaveData),
    trackingQuestId: str(body.TrackingQuestId) || undefined,
    paldeckEncountered: countTrue(body.Local_PalEncountFlag),
    techsUnlocked: countTrue(body.Local_NewUnlockedTechs),
    buildsUnlocked: arr(body.Local_NewUnlockedBuilds).length,
    hiddenLocations: countTrue(body.Local_HiddenLocationFlagMap),
    tutorialsSeen: arr<Node>(body.Local_TutorialTriggerSaveData).filter(
      (t) => t?.Checked?.value === true,
    ).length,
    warnings: [],
  }

  // After the reads above, not inside the literal: property initialisers run in
  // order, and a `warnings: warn.list()` sitting mid-literal would silently
  // capture only the warnings raised by the properties above it.
  payload.warnings = warn.list()
  return payload
}

/** The mask buffers, for the worker's `postMessage` transfer list. */
export function maskBuffers(payload: LocalDataPayload): ArrayBuffer[] {
  return payload.fog.map((f) => f.alpha.buffer as ArrayBuffer)
}
