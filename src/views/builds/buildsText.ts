/**
 * Words for the Builds view: effect types, mount kinds, where a pal is, and the
 * link across to the Breed view.
 *
 * A separate module from the components for the reason `breed/speciesText.ts`
 * gives: a file exporting both a component and a helper loses fast refresh.
 */

import type { MountKind, PassiveEffect } from '../../refdata/refdata.ts'
import type { Guid, Pal, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import type { Where } from '../../domain/recommend.ts'
import { WORK_TYPES, element } from '../../lib/color.ts'
import type { PassiveText } from '../breed/passiveText.ts'
import type { SpeciesText } from '../breed/speciesText.ts'
import { serialiseParams } from '../../app/viewParams.ts'
import { BREED_DEFAULTS, breedCodec } from '../breed/params.ts'

/**
 * Short names for effect types.
 *
 * Only the ones a purpose asks for are here; anything else prints its raw type,
 * which is what the rest of the app does with an id it cannot name.
 */
const EFFECT_LABEL: Record<string, string> = {
  ShotAttack: 'Attack',
  Defense: 'Defense',
  MaxHP: 'Max HP',
  CraftSpeed: 'Work speed',
  MoveSpeed: 'Move speed',
  SwimSpeed: 'Speed on water',
  FullStomatch_Decrease: 'Hunger drain',
  Sanity_Decrease: 'SAN drain',
  PalEggHatchingSpeed: 'Incubation speed',
  BreedSpeed_InBaseCamp: 'Egg production',
  BreedSpeed: 'Breeding speed',
  LifeSteal: 'Life steal',
  ActiveSkillCoolTime_Decrease: 'Cooldown reduction',
  AutoHPRegeneRate: 'HP regen',
  PalSP_Increase: 'Max stamina',
  PlayerSP_DecreaseRate: 'Stamina use',
  Mining: 'Mining',
  Logging: 'Logging',
  Nocturnal: 'Works through the night',
  NightOwl: 'Naps through the day',
  WorkSuitabilityAddRank_MonsterFarm: 'Ranching',
  RideJumpCount_Increase: 'Mounted jumps',
  LeanBackInvalid_ForPassiveSkill: 'Immune to flinch',
  KnockbackInvalid_ForPassiveSkill: 'Immune to knockback',
  // Partner-skill effects, for the production purposes.
  Fishing_ItemAddDrop: 'Fishing drops',
  Fishing_EnemyAddDrop: 'Fished-pal drops',
  Fishing_GoodTalentPalProbability: 'Talented catches',
  Fishing_StartProgressAdd: 'Catch head start',
  Fishing_SuccessAmountUp: 'Catch progress',
  Fishing_FailedAmountDown: 'Slower gauge loss',
  FishingSalvage_ItemDrop: 'Salvage drops',
  FarmCropHarvestNumRate: 'Crop harvest',
  FarmCropGrowupSpeed: 'Crop growth',
  ItemCorruptionSpeedRate: 'Spoilage',
}

/** Types whose value is a count rather than a percentage. */
const COUNTS = new Set([
  'WorkSuitabilityAddRank_MonsterFarm',
  'RideJumpCount_Increase',
])

function label(type: string): string {
  const known = EFFECT_LABEL[type]
  if (known) return known
  const boost = /^ElementBoost_(.+)$/.exec(type)
  if (boost) return `${element(boost[1])?.display ?? boost[1]} damage`
  const resist = /^ElementResist_(.+)$/.exec(type)
  if (resist) {
    return `${element(resist[1])?.display ?? resist[1]} damage taken −`
  }
  return type
}

/**
 * `Work speed +50%`, `Hunger drain −15%`, `You: Attack +10%`.
 *
 * The value is printed with the sign the game stores, which for the "less is
 * better" types is already the readable one: Diet Lover's −15 hunger drain is
 * exactly what it does. Resistances store a positive reduction, so their label
 * ends in the minus and the number follows it.
 */
export function effectText(e: PassiveEffect): string {
  const who = e.target === 'trainer' ? 'You: ' : ''
  const name = label(e.type)
  if (e.value === 0) return who + name
  if (COUNTS.has(e.type)) return `${who}${name} +${e.value}`
  if (name.endsWith('−')) return `${who}${name}${Math.abs(e.value)}%`
  const sign = e.value > 0 ? '+' : '−'
  return `${who}${name} ${sign}${Math.abs(e.value)}%`
}

export const MOUNT_LABEL: Record<MountKind, string> = {
  flying: 'Flying mounts',
  ground: 'Ground mounts',
  water: 'Water mounts',
  glider: 'Glider partners',
}

export const WHERE_LABEL: Record<Where, string> = {
  party: 'party',
  palbox: 'palbox',
  base: 'at a base',
  unknown: 'somewhere',
}

/**
 * A link that opens the Breed view planning this species with these passives.
 *
 * A real `href` into the hash rather than a store call: it is a navigation,
 * so it belongs in history and can be opened in a new tab, and the shell's
 * `hashchange` handler already adopts a pasted Breed link — this is one.
 */
export function breedHref(
  index: SaveIndex,
  playerUid: Guid | undefined,
  target: string,
  passives: readonly string[],
): string {
  const qs = serialiseParams(
    breedCodec(index).encode(
      { ...BREED_DEFAULTS, playerUid, target, passives: [...passives] },
      BREED_DEFAULTS,
    ),
  )
  return `#/breed?${qs}`
}

/** How many species and how many of your own pals each list shows. */
export const TOP = 5
export const MINE = 3

/** Everything a section needs, passed as one so the call sites stay legible. */
export interface Ctx {
  index: SaveIndex
  data: Refdata
  pool: string[]
  pals: readonly Pal[]
  where: (pal: Pal) => Where
  ownerUid: Guid | undefined
  text: SpeciesText
  passives: PassiveText
}

export function workName(data: Refdata, id: string): string {
  return (
    data.work.find((w) => w.id === id)?.display ??
    WORK_TYPES.find((w) => w.id === id)?.display ??
    id
  )
}
