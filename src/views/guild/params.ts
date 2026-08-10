/**
 * What of the Guild view goes in a link.
 *
 * The smallest of the three: which guild is selected, whose detail panel is
 * open, and whether the system groups are shown. All three are things you
 * would want to send someone — "look at this player" most of all.
 */

import type { Guid, SaveIndex } from '../../domain/types.ts'
import {
  bool,
  resolveShortId,
  shortId,
  type ParamCodec,
} from '../../app/viewParams.ts'

export interface GuildParams {
  selectedId?: string
  openPlayerId?: Guid
  showGroups: boolean
}

export const GUILD_DEFAULTS: GuildParams = {
  selectedId: undefined,
  openPlayerId: undefined,
  showGroups: false,
}

export function guildCodec(index: SaveIndex): ParamCodec<GuildParams> {
  return {
    encode(v) {
      const out: Record<string, string> = {}
      if (v.selectedId) out.g = shortId(v.selectedId)
      if (v.openPlayerId) out.p = shortId(v.openPlayerId)
      if (v.showGroups) out.groups = '1'
      return out
    },

    decode(raw, d) {
      return {
        // Guild ids and player uids both resolve against the save, so a link
        // naming something this world does not have selects nothing rather
        // than leaving a dangling id in state.
        selectedId: resolveShortId(
          raw.get('g') ?? undefined,
          index.guildById.keys(),
        ),
        openPlayerId: resolveShortId(
          raw.get('p') ?? undefined,
          index.playerByUid.keys(),
        ),
        showGroups: bool(raw, 'groups', d.showGroups),
      }
    },
  }
}
