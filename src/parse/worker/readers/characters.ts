/**
 * Reads `CharacterSaveParameterMap` — which holds both pals and players.
 *
 * The two are distinguished only by an `IsPlayer` boolean, and player entries
 * carry a completely different (and much smaller) field set, so they are split
 * in a single pass rather than read twice.
 */

import {
  arr,
  bool,
  byte,
  characterGroupId,
  containerIdOf,
  enumArr,
  enumTail,
  guid,
  guidArr,
  hp,
  int,
  saveParameter,
  str,
  strArr,
  vec3,
  type Node,
} from '../../gvas.ts'
import { nonZero } from '../../guid.ts'
import type { Warnings } from '../../warnings.ts'
import { STATUS_NAMES, type StatusKey } from '../../../domain/statusNames.ts'
import type { Gender, Pal, Player } from '../../../domain/types.ts'

export interface CharacterReadResult {
  pals: Pal[]
  players: Player[]
}

/**
 * `GotStatusPointList` arrives with Japanese keys whatever the client language.
 * Unknown keys are dropped from the typed map but recorded in `extra` so a new
 * stat in a future patch is visible rather than silently gone.
 */
function readStatusPoints(node: Node): {
  known: Partial<Record<StatusKey, number>>
  extra: Record<string, number>
} {
  const known: Partial<Record<StatusKey, number>> = {}
  const extra: Record<string, number> = {}
  for (const row of arr<Node>(node)) {
    const name = str(row?.StatusName)
    const points = int(row?.StatusPoint)
    if (name === undefined || points === undefined) continue
    const key = STATUS_NAMES[name]
    if (key) known[key] = points
    else extra[name] = points
  }
  return { known, extra }
}

/** `GotWorkSuitabilityAddRankList` → `{ Collection: 1, ... }`. */
function readWorkBonus(node: Node): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of arr<Node>(node)) {
    const work = enumTail(row?.WorkSuitability)
    const rank = int(row?.Rank)
    if (work !== undefined && rank !== undefined) out[work] = rank
  }
  return out
}

function readPal(entry: Node, sp: Node, instanceId: string): Pal {
  const rawId = str(sp.CharacterID) ?? ''
  // Alphas and field bosses carry a BOSS_ prefix on an otherwise ordinary
  // species id. Strip it for lookups; keep the fact as a flag.
  const isBoss = rawId.startsWith('BOSS_')
  const gender = enumTail(sp.Gender)

  return {
    instanceId,
    characterId: isBoss ? rawId.slice(5) : rawId,
    isBoss,
    isRare: bool(sp.IsRarePal) ?? false,
    nickname: str(sp.NickName) || undefined,
    gender:
      gender === 'Male' || gender === 'Female' ? (gender as Gender) : undefined,
    level: byte(sp.Level) ?? 1,
    exp: int(sp.Exp) ?? 0,
    rank: byte(sp.Rank) ?? 0,
    rankAttack: byte(sp.Rank_Attack) ?? 0,
    // British spelling in the game data; not a typo here.
    rankDefence: byte(sp.Rank_Defence) ?? 0,
    rankHp: byte(sp.Rank_HP) ?? 0,
    rankCraftSpeed: byte(sp.Rank_CraftSpeed) ?? 0,
    ivHp: byte(sp.Talent_HP),
    // Talent_Shot is the attack IV, despite naming only ranged attack.
    ivAttack: byte(sp.Talent_Shot),
    ivDefense: byte(sp.Talent_Defense),
    hp: hp(sp.Hp),
    fullStomach: int(sp.FullStomach),
    sanity: int(sp.SanityValue),
    friendship: int(sp.FriendshipPoint),
    passives: strArr(sp.PassiveSkillList),
    equipWaza: enumArr(sp.EquipWaza),
    masteredWaza: enumArr(sp.MasteredWaza),
    workSuitabilityBonus: readWorkBonus(sp.GotWorkSuitabilityAddRankList),
    ownerPlayerUid: nonZero(guid(sp.OwnerPlayerUId)),
    oldOwnerUids: guidArr(sp.OldOwnerPlayerUIds).filter(
      (g): g is string => nonZero(g) !== undefined,
    ),
    groupId: nonZero(characterGroupId(entry)),
    containerId: nonZero(containerIdOf(sp.SlotId)),
    slotIndex: int(sp.SlotId?.value?.SlotIndex),
    pos: vec3(sp.LastJumpedLocation),
    ownedTime: int(sp.OwnedTime),
    sickness: enumTail(sp.WorkerSick),
    physicalHealth: enumTail(sp.PhysicalHealth),
    currentWork: enumTail(sp.CurrentWorkSuitability),
    skinCharacterId: str(sp.SkinAppliedCharacterId),
  }
}

function readPlayer(
  entry: Node,
  sp: Node,
  instanceId: string,
  playerUid: string,
): Player {
  const status = readStatusPoints(sp.GotStatusPointList)
  const ex = readStatusPoints(sp.GotExStatusPointList)

  return {
    playerUid,
    instanceId,
    name: str(sp.NickName) ?? '(unnamed)',
    level: byte(sp.Level) ?? 1,
    exp: int(sp.Exp) ?? 0,
    hp: hp(sp.Hp),
    shieldHp: hp(sp.ShieldHP),
    fullStomach: int(sp.FullStomach),
    statusPoints: status.known,
    // Ex-status points use the same Japanese keys; flatten both halves into one
    // record since nothing downstream needs them typed.
    exStatusPoints: { ...ex.extra, ...ex.known },
    pos: vec3(sp.LastJumpedLocation),
    groupId: nonZero(characterGroupId(entry)),
    // Container ids live in Players/<uid>.sav, never in Level.sav. Left
    // undefined here on purpose; the UI offers to load that file.
  }
}

export function readCharacters(
  characterMap: Node,
  warn: Warnings,
): CharacterReadResult {
  const pals: Pal[] = []
  const players: Player[] = []

  for (const entry of arr<Node>(characterMap)) {
    const instanceId = guid(entry?.key?.InstanceId)
    if (!instanceId) {
      warn.add('unreadable-entry', 'character without an InstanceId')
      continue
    }

    const sp = saveParameter(entry)
    if (!sp) {
      warn.add('missing-save-parameter', `character ${instanceId}`)
      continue
    }

    if (bool(sp.IsPlayer)) {
      const playerUid = guid(entry?.key?.PlayerUId)
      if (!playerUid) {
        warn.add('unreadable-entry', 'player without a PlayerUId')
        continue
      }
      players.push(readPlayer(entry, sp, instanceId, playerUid))
    } else {
      pals.push(readPal(entry, sp, instanceId))
    }
  }

  return { pals, players }
}
