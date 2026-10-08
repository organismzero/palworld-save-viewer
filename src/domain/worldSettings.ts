/**
 * Reading a server's settings for a person: which ones matter, what to call
 * them, and which differ from the game's own.
 *
 * ## The one assumption
 *
 * The game's defaults are not in the file, and the template that lists them
 * changes between versions. So "changed" is only ever said about multipliers,
 * where it needs no table: a rate of 1 is the game unmodified, by what a rate
 * means. Everything else is shown as it is and not judged.
 */

import type { WorldSettings, WorldSettingValue } from './types.ts'

/** Names for the settings people ask about. Anything else is spelled out. */
const LABEL: Record<string, string> = {
  ExpRate: 'XP',
  PalCaptureRate: 'capture rate',
  PalSpawnNumRate: 'pal spawns',
  CollectionDropRate: 'gathering yield',
  EnemyDropItemRate: 'enemy drops',
  WorkSpeedRate: 'work speed',
  DayTimeSpeedRate: 'day speed',
  NightTimeSpeedRate: 'night speed',
  PalEggDefaultHatchingTime: 'massive egg incubation',
  DeathPenalty: 'death penalty',
  bIsPvP: 'PvP',
  bHardcore: 'hardcore',
  bPalLost: 'pals lost on death',
  BaseCampMaxNumInGuild: 'bases per guild',
  BaseCampWorkerMaxNum: 'workers per base',
  GuildPlayerMaxNum: 'players per guild',
  ServerPlayerMaxNum: 'players on the server',
  PlayerDamageRateAttack: 'player damage dealt',
  PlayerDamageRateDefense: 'player damage taken',
  PalDamageRateAttack: 'pal damage dealt',
  PalDamageRateDefense: 'pal damage taken',
  PlayerStomachDecreaceRate: 'player hunger',
  PalStomachDecreaceRate: 'pal hunger',
  PlayerStaminaDecreaceRate: 'player stamina use',
  PalStaminaDecreaceRate: 'pal stamina use',
  CollectionObjectHpRate: 'gatherable health',
  CollectionObjectRespawnSpeedRate: 'gatherable respawn',
  EquipmentDurabilityDamageRate: 'gear wear',
  ItemWeightRate: 'item weight',
  ItemCorruptionMultiplier: 'food spoilage',
  MonsterFarmActionSpeedRate: 'ranch speed',
  BuildObjectDamageRate: 'damage to structures',
  BuildObjectDeteriorationDamageRate: 'structure decay',
  BuildObjectHpRate: 'structure health',
  PalAutoHPRegeneRate: 'pal health regen',
  PalAutoHpRegeneRateInSleep: 'pal health regen asleep',
  PlayerAutoHPRegeneRate: 'player health regen',
  PlayerAutoHpRegeneRateInSleep: 'player health regen asleep',
}

/**
 * A key in words: the table's name for it, or the key itself taken apart.
 * `bEnableFastTravel` → "enable fast travel".
 */
export function settingLabel(key: string): string {
  const known = LABEL[key]
  if (known) return known
  return key
    .replace(/^b(?=[A-Z])/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
}

/**
 * Whether a key names a multiplier: `ExpRate`, `PalDamageRateAttack`,
 * `PalAutoHpRegeneRateInSleep`, `ItemCorruptionMultiplier`.
 */
function isRateKey(key: string): boolean {
  return /Rate($|[A-Z])|Multiplier$/.test(key)
}

export interface ChangedRate {
  key: string
  label: string
  value: number
}

/**
 * The multipliers that are not 1, biggest departure first.
 *
 * These are the settings that make one server's numbers incomparable with
 * another's, and the only ones this can call changed without a table of
 * defaults it does not have.
 */
export function changedRates(settings: WorldSettings): ChangedRate[] {
  const out: ChangedRate[] = []
  for (const [key, value] of Object.entries(settings.values)) {
    if (typeof value !== 'number' || !isRateKey(key) || value === 1) continue
    out.push({ key, label: settingLabel(key), value })
  }
  // By how far from 1 as a ratio, so ×0.5 and ×2 are equally notable.
  const far = (v: number) => (v > 0 ? Math.abs(Math.log(v)) : Infinity)
  return out.sort(
    (a, b) => far(b.value) - far(a.value) || a.key.localeCompare(b.key),
  )
}

/** "×1.5", without a trail of zeros. */
export function rateText(value: number): string {
  return `×${Number(value.toFixed(2))}`
}

/** The settings shown as tiles, in this order, when the file has them. */
export const HEADLINE_SETTINGS = [
  'ExpRate',
  'PalCaptureRate',
  'PalSpawnNumRate',
  'CollectionDropRate',
  'EnemyDropItemRate',
  'WorkSpeedRate',
  'PalEggDefaultHatchingTime',
  'DeathPenalty',
  'bIsPvP',
  'bHardcore',
  'BaseCampMaxNumInGuild',
  'BaseCampWorkerMaxNum',
] as const

/** A value as a person would write it. */
export function settingText(key: string, value: WorldSettingValue): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'number') {
    if (key === 'PalEggDefaultHatchingTime')
      return `${Number(value.toFixed(2))} h`
    return isRateKey(key) ? rateText(value) : String(Number(value.toFixed(4)))
  }
  return value === '' ? '—' : value
}
