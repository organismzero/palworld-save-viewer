/**
 * Reads a per-player save (`Players/<uid>.json`).
 *
 * These files are far simpler than `Level.json` — plain GVAS properties with
 * no `RawData` byte-blob decoding — but they carry the things `Level.json`
 * structurally cannot: the player's real position, an absolute last-online
 * timestamp, their platform, tech points, paldex progress, and the container
 * ids that turn guessed inventory attribution into exact attribution.
 */

import {
  arr,
  enumTail,
  int,
  nameMap,
  palContainerId,
  strArr,
  vec3,
  type Node,
} from '../../gvas.ts'
import { nonZero, normGuid } from '../../guid.ts'
import type { Warnings } from '../../warnings.ts'
import type {
  PlayerContainerSlot,
  PlayerDetail,
  PlayerPlatform,
  PlayerRecord,
} from '../../../domain/types.ts'

const PLATFORMS: readonly PlayerPlatform[] = [
  'Steam',
  'PS5',
  'Xbox',
  'Mac',
] as const

/** `InventoryInfo` key → our slot name. All six are present on real saves. */
const INVENTORY_SLOTS: readonly [string, PlayerContainerSlot][] = [
  ['CommonContainerId', 'main'],
  ['EssentialContainerId', 'essential'],
  ['WeaponLoadOutContainerId', 'weapon'],
  ['PlayerEquipArmorContainerId', 'equip'],
  ['FoodEquipContainerId', 'food'],
  ['DropSlotContainerId', 'drop'],
]

/**
 * `RecordData` fields this reader understands. Anything outside this set emits
 * a warning — that section is where Palworld adds things every patch, and a
 * counted warning is the cheapest possible early signal.
 */
const KNOWN_RECORD_FIELDS = new Set([
  'PalCaptureCount',
  'PaldeckUnlockFlag',
  'TribeCaptureCount',
  'NormalBossDefeatFlag',
  'TowerBossDefeatFlag',
  'TowerBossDefeatCount',
  'RelicPossessNum',
  'RelicPossessNumMap',
  'FastTravelPointUnlockFlag',
  'NormalDungeonClearCount',
  'FixedDungeonClearCount',
  'CraftItemCount',
  'NPCTalkCountMap',
  'UnlockedWorldMapFlags',
  'PredatorDefeatCount',
  'PalButcherCount',
  'FishingCountMap',
  'PalRankupCount',
  // Present and deliberately unread — bonus tables, flags and fixups with no
  // consumer. Listed so they do not generate noise.
  //
  // The two misspellings below are in the game data, not here: `PIckup` with a
  // capital I, and `Achivement` missing its second E. Spell them wrong.
  'ItemPickupObtainForInstanceFlag',
  'ItemPIckupBonusExpTableIndex',
  'NpcBonusExpTableIndex',
  'NPCAchivementRewardFlag',
  'bFirstFishingComplete',
  'AreaBonusExpTableIndex',
  'BossDefeatExpBonusTableIndex',
  'CompletedEmoteNPCIDArray',
  'FastTravelBonusExpTableIndex',
  'FindAreaFlagMap',
  'NoteBonusExpTableIndex',
  'NoteObtainForInstanceFlag',
  'PalCaptureBonusCount',
  'PalCaptureBonusExpTableIndex',
  'RelicBonusExpTableIndex',
  'RelicObtainForInstanceFlag',
  'RelicObtainForInstanceFlagByType',
  'bCaptureCompletionRelicFixupDone',
  'bFieldBossDefeatFlagResetDone',
  // Newer-content progression, seen in real 2026 saves: oil rigs, treasure maps
  // and camp conquests. The canary caught these, which is what it is for —
  // acknowledging them here is what keeps the next unknown field visible instead
  // of buried under five lines nobody acts on. All five are countable and would
  // fit `PlayerRecord` alongside `bossesDefeated`; reading them is a feature,
  // not this fix.
  'OilrigClearCount',
  'FoundTreasureCount',
  'FoundTreasureMapPointMap',
  'CampConqueredCount',
  'InvokeNPCNetworkEventMap',
])

function countTrue(n: Node): number {
  let total = 0
  for (const entry of arr<Node>(n)) if (entry?.value === true) total += 1
  return total
}

function sumValues(n: Node): number {
  let total = 0
  for (const entry of arr<Node>(n)) {
    if (typeof entry?.value === 'number') total += entry.value
  }
  return total
}

function readRecord(rd: Node, warn: Warnings): PlayerRecord {
  for (const key of Object.keys(rd ?? {})) {
    if (!KNOWN_RECORD_FIELDS.has(key)) {
      warn.add('unknown-record-field', `RecordData.${key}`)
    }
  }

  const captures = nameMap<number>(rd?.PalCaptureCount)

  return {
    palsCaught: sumValues(rd?.PalCaptureCount),
    speciesCaught: Object.keys(captures).length,
    paldexUnlocked: countTrue(rd?.PaldeckUnlockFlag),
    captureCountBySpecies: captures,
    tribesCaught: int(rd?.TribeCaptureCount),
    bossesDefeated: countTrue(rd?.NormalBossDefeatFlag),
    towerBossesDefeated: countTrue(rd?.TowerBossDefeatFlag),
    relicsFound: int(rd?.RelicPossessNum),
    fastTravelUnlocked: countTrue(rd?.FastTravelPointUnlockFlag),
    normalDungeonsCleared: int(rd?.NormalDungeonClearCount),
    fixedDungeonsCleared: int(rd?.FixedDungeonClearCount),
    itemsCrafted: sumValues(rd?.CraftItemCount),
    npcsTalkedTo: arr(rd?.NPCTalkCountMap).length,
    predatorsDefeated: int(rd?.PredatorDefeatCount),
    palsButchered: sumValues(rd?.PalButcherCount),
    fishCaught: sumValues(rd?.FishingCountMap),
    palsCondensed: sumValues(rd?.PalRankupCount),
  }
}

function readPlatform(n: Node, warn: Warnings): PlayerPlatform {
  const tail = enumTail(n)
  if (tail && (PLATFORMS as readonly string[]).includes(tail)) {
    return tail as PlayerPlatform
  }
  if (tail) warn.add('unknown-platform', tail)
  return 'Unknown'
}

export function readPlayerSave(
  raw: Node,
  fileName: string,
  warn: Warnings,
): PlayerDetail {
  // Presence is not enough, and checking only presence is how `LevelMeta.sav`
  // used to end up here and be blamed for having no `PlayerUId` — it has a
  // `SaveData` of its own, just a `PalWorldBaseInfoSaveData` one. Naming the
  // struct actually found turns a misleading accusation into a diagnosis, the
  // way `readLocalData` already does.
  const struct = raw?.properties?.SaveData?.struct_type
  const sd = raw?.properties?.SaveData?.value
  if (!sd || (struct && struct !== 'PalWorldPlayerSaveData')) {
    throw new Error(
      `${fileName} does not look like a Palworld player save: expected properties.SaveData to be a PalWorldPlayerSaveData${
        struct ? `, found a ${struct}` : ', which is missing'
      }.`,
    )
  }

  const playerUid =
    normGuid(sd.PlayerUId?.value) ??
    normGuid(sd.IndividualId?.value?.PlayerUId?.value)
  if (!playerUid) {
    throw new Error(`${fileName} has no PlayerUId.`)
  }

  const inventory: Partial<Record<PlayerContainerSlot, string>> = {}
  for (const [key, slot] of INVENTORY_SLOTS) {
    const id = nonZero(palContainerId(sd.InventoryInfo?.value?.[key]))
    if (id) inventory[slot] = id
  }

  return {
    playerUid,
    instanceId: nonZero(normGuid(sd.IndividualId?.value?.InstanceId?.value)),
    // Absolute .NET ticks, unlike the guild's uptime-relative counter.
    lastOnlineTicks: int(sd.LastOnlineDateTime),
    savedAtTicks: int(raw?.properties?.Timestamp),
    platform: readPlatform(sd.PlayerPlatform, warn),
    // Deliberately not defaulted to 0 — absent on 1 of 10 real players, and
    // "no tech points recorded" reads differently from "zero tech points".
    technologyPoints: int(sd.TechnologyPoint),
    bossTechnologyPoints: int(sd.bossTechnologyPoint),
    // `translation()` looks for a lowercase `translation` key, which is right
    // for decoded RawData but silently misses a player's capitalised GVAS
    // `Transform`. Reach for the struct directly.
    pos: vec3(sd.LastTransform?.value?.Translation),
    palboxContainerId: nonZero(palContainerId(sd.PalStorageContainerId)),
    otomoContainerId: nonZero(palContainerId(sd.OtomoCharacterContainerId)),
    otomoOrder: enumTail(sd.OtomoOrder),
    inventory,
    unlockedRecipes: strArr(sd.UnlockedRecipeTechnologyNames),
    record: readRecord(sd.RecordData?.value, warn),
    sourceFileName: fileName,
  }
}
