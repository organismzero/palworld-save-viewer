/**
 * Reads `GroupSaveDataMap`.
 *
 * Most entries are `Organization` bookkeeping groups with no members and no
 * bases — a real save typically holds one `Guild` and a handful of empty
 * Organizations. Both kinds are read; the dashboard hides the empty ones.
 *
 * Unlike most sections, the interesting fields here are already decoded into
 * plain values by the RawData codec, so there is little GVAS wrapping to peel.
 */

import { arr, type Node } from '../../gvas.ts'
import { nonZero, normGuid, type Guid } from '../../guid.ts'
import type { Warnings } from '../../warnings.ts'
import type {
  Guild,
  GuildMarker,
  GuildMember,
  GuildRole,
} from '../../../domain/types.ts'

function readMembers(raw: Node): GuildMember[] {
  const out: GuildMember[] = []
  for (const p of arr<Node>(raw?.players ?? [])) {
    const uid = normGuid(p?.player_uid)
    if (!uid) continue
    const role = p?.role
    out.push({
      playerUid: uid,
      name: p?.player_info?.player_name ?? '(unknown)',
      role: role >= 1 && role <= 4 ? (role as GuildRole) : undefined,
      lastOnlineTicks:
        typeof p?.player_info?.last_online_real_time === 'number'
          ? p.player_info.last_online_real_time
          : undefined,
    })
  }
  return out
}

function readMarkers(raw: Node): GuildMarker[] {
  const out: GuildMarker[] = []
  for (const m of arr<Node>(raw?.guild_markers ?? [])) {
    const id = normGuid(m?.marker_id)
    const loc = m?.icon_location
    if (!id || typeof loc?.x !== 'number') continue
    out.push({
      markerId: id,
      icon: typeof m?.icon_type === 'number' ? m.icon_type : 0,
      pos: { x: loc.x, y: loc.y, z: loc.z ?? 0 },
      ownerPlayerUid: nonZero(normGuid(m?.owner_player_uid)),
    })
  }
  return out
}

export function readGuilds(groupMap: Node, warn: Warnings): Guild[] {
  const guilds: Guild[] = []

  for (const entry of arr<Node>(groupMap)) {
    const raw = entry?.value?.RawData?.value
    const groupId = normGuid(raw?.group_id) ?? normGuid(entry?.key)
    if (!raw || !groupId) {
      warn.add('unreadable-entry', 'group without a group_id')
      continue
    }

    const isGuild = String(raw.group_type ?? '').endsWith('::Guild')
    const members = readMembers(raw)
    const handleIds: Guid[] = arr<Node>(
      raw.individual_character_handle_ids ?? [],
    )
      .map((h) => normGuid(h?.instance_id))
      .filter((g): g is Guid => g !== undefined)

    guilds.push({
      groupId,
      type: isGuild ? 'Guild' : 'Organization',
      // Non-guild groups have no display name; `group_name` is an internal id.
      name: raw.guild_name || raw.group_name || '(unnamed)',
      adminPlayerUid: nonZero(normGuid(raw.admin_player_uid)),
      members,
      playerUids: members.map((m) => m.playerUid),
      memberCount: handleIds.length,
      characterHandleIds: handleIds,
      baseIds: arr<unknown>(raw.base_ids ?? [])
        .map((b) => normGuid(b))
        .filter((g): g is Guid => g !== undefined),
      baseCampLevel:
        typeof raw.base_camp_level === 'number' ? raw.base_camp_level : 0,
      markers: readMarkers(raw),
      // The post-2026-07 guild tail added role permissions; its presence is the
      // cheapest reliable signal for which serialisation version wrote this.
      hasV2Tail: raw.role_permissions !== undefined,
    })
  }

  return guilds
}
