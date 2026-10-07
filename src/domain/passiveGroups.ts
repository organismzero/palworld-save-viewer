/**
 * What a passive is *for*, as coarsely as is useful.
 *
 * The cheat sheet lists 115 passives, and "show me the work ones" is the
 * question most people open it with. Upstream carries no such category — its
 * `category` field only separates the passives a pal can carry from internal
 * gear modifiers — so the grouping is read off the effect types.
 *
 * A passive belongs to every group one of its effects falls in: Legend raises
 * attack, defence and movement speed, and is as much a travel passive as a
 * combat one. `other` is what is left when nothing matched, not a fourth
 * bucket of effect types — a World Tree passive that also raises attack is a
 * combat passive, and its decay immunity does not make it miscellaneous too.
 */

import type { PassiveInfo } from '../refdata/refdata.ts'

export type PassiveGroup = 'combat' | 'work' | 'travel' | 'other'

export const PASSIVE_GROUPS: { id: PassiveGroup; label: string }[] = [
  { id: 'combat', label: 'combat' },
  { id: 'work', label: 'work' },
  { id: 'travel', label: 'travel' },
  { id: 'other', label: 'other' },
]

const GROUP_OF: Record<string, Exclude<PassiveGroup, 'other'>> = {
  ShotAttack: 'combat',
  Defense: 'combat',
  MaxHP: 'combat',
  LifeSteal: 'combat',
  AutoHPRegeneRate: 'combat',
  ActiveSkillCoolTime_Decrease: 'combat',
  LeanBackInvalid_ForPassiveSkill: 'combat',
  KnockbackInvalid_ForPassiveSkill: 'combat',
  ExplosionResist: 'combat',
  ResistAdditionalEffect_Burn: 'combat',
  ResistAdditionalEffect_Poison: 'combat',
  NonKilling: 'combat',
  ReloadSpeedUp: 'combat',

  CraftSpeed: 'work',
  FullStomatch_Decrease: 'work',
  Sanity_Decrease: 'work',
  Nocturnal: 'work',
  NightOwl: 'work',
  WorkSuitabilityAddRank_MonsterFarm: 'work',
  Logging: 'work',
  Mining: 'work',
  PalEggHatchingSpeed: 'work',
  BreedSpeed_InBaseCamp: 'work',
  BreedSpeed: 'work',

  MoveSpeed: 'travel',
  SwimSpeed: 'travel',
  PalSP_Increase: 'travel',
  PlayerSP_DecreaseRate: 'travel',
  RideJumpCount_Increase: 'travel',
}

function groupOf(type: string): Exclude<PassiveGroup, 'other'> | undefined {
  // Nine elements each way, so a pattern rather than eighteen rows.
  if (/^Element(?:Boost|Resist)_/.test(type)) return 'combat'
  return GROUP_OF[type]
}

export function passiveGroups(
  info: Pick<PassiveInfo, 'effects'>,
): Set<PassiveGroup> {
  const out = new Set<PassiveGroup>()
  for (const e of info.effects ?? []) {
    const g = groupOf(e.type)
    if (g) out.add(g)
  }
  if (out.size === 0) out.add('other')
  return out
}
