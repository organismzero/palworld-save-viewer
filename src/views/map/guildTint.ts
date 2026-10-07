/**
 * One colour per player guild, for the map.
 *
 * On a dedicated server several guilds build on one island, and with every
 * structure the same grey and every base the same cyan there is no telling
 * whose anything is. The colours are the shared categorical ones.
 */

import { categorical, categoricalCss } from '../../lib/categorical.ts'
import type { Guid, Guild } from '../../domain/types.ts'

export interface Tint {
  /** For Pixi. */
  color: number
  /** The same colour for CSS. */
  css: string
}

/**
 * Player guilds only, the one with most players first, so the guild most of the map belongs to
 * gets the first colour whatever order the save lists them in. Ties break on
 * the id, which keeps the assignment stable between two reads of one save.
 *
 * Past eight guilds the colours repeat. That is a limit of telling hues apart
 * on a busy map, not of this table; the legend still names every guild.
 */
export function guildTints(guilds: readonly Guild[]): Map<Guid, Tint> {
  const out = new Map<Guid, Tint>()
  const ordered = guilds
    .filter((g) => g.type === 'Guild')
    .sort(
      (a, b) =>
        b.playerUids.length - a.playerUids.length ||
        a.groupId.localeCompare(b.groupId),
    )
  for (const [i, g] of ordered.entries()) {
    out.set(g.groupId, { color: categorical(i), css: categoricalCss(i) })
  }
  return out
}
