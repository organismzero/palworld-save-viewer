/**
 * One colour per player guild, for the map.
 *
 * On a dedicated server several guilds build on one island, and with every
 * structure the same grey and every base the same cyan there is no telling
 * whose anything is. These are data colours — they distinguish categories, as
 * the element hues do — so they sit outside the interface's own palette.
 *
 * Pink is left out: hand-placed pins already use it on the same layer the
 * guild markers are drawn on.
 */

import type { Guid, Guild } from '../../domain/types.ts'

export interface Tint {
  /** For Pixi. */
  color: number
  /** The same colour for CSS. */
  css: string
}

const PALETTE: readonly number[] = [
  0xf59e0b, // amber
  0x34d399, // green
  0x60a5fa, // blue
  0xa78bfa, // violet
  0xfb7185, // rose
  0x22d3ee, // cyan
  0xfacc15, // yellow
  0xfb923c, // orange
]

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
    const color = PALETTE[i % PALETTE.length]!
    out.set(g.groupId, {
      color,
      css: `#${color.toString(16).padStart(6, '0')}`,
    })
  }
  return out
}
