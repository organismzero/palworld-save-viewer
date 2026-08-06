/**
 * When was this player last online?
 *
 * Palworld answers that on two incompatible clocks, and conflating them is the
 * trap this module exists to prevent:
 *
 * - **`Level.json`** guild members carry `last_online_real_time`, which sits on
 *   the server's **uptime** counter — `max()` across members equals
 *   `GameTimeSaveData.RealDateTimeTicks` exactly. That counter stops while the
 *   server is down, and the save records no downtime, so it can never be
 *   turned into a wall-clock date. Reconstructing one anyway was measured
 *   **52 hours** off on the reference save.
 * - **`Players/<uid>.json`** carries `LastOnlineDateTime`, genuine absolute
 *   .NET ticks.
 *
 * The two also disagree on *ordering* by up to 51 minutes, so a single sorted
 * list must pick one basis and stay on it — see {@link lastSeenBasis}.
 * PalworldSaveTools only ever renders the relative value as a duration, never
 * a date, and it never has the absolute one at all.
 */

import { ticksToDate } from '../lib/format.ts'
import type { GuildMember, Player, PlayerDetail, SaveMeta } from './types.ts'

export type LastSeenSource = 'player-save' | 'guild-uptime' | 'none'

export interface LastSeen {
  source: LastSeenSource
  /** Absolute wall clock. Only ever set from a player save. */
  at?: Date
  /**
   * Uptime ticks behind the save's own counter. A **lower bound** on elapsed
   * wall time — never render this as a date.
   */
  uptimeTicksAgo?: number
  /** Connected at the moment the level save was written. */
  onlineAtSave: boolean
}

/**
 * How close to the world clock counts as "still connected". One minute; the
 * reference save has exactly one player inside it.
 */
const ONLINE_EPSILON_TICKS = 60 * 10_000_000

export function lastSeenFor(
  _player: Player,
  detail: PlayerDetail | undefined,
  member: GuildMember | undefined,
  meta: SaveMeta,
): LastSeen {
  const uptime = meta.worldUptimeTicks
  const memberTicks = member?.lastOnlineTicks

  // Note this reads "was in the session that wrote this save", not "connected
  // right now" — the one player it matches in the reference save has their own
  // file saying they logged out 30 minutes before the level was written.
  const onlineAtSave =
    uptime !== undefined &&
    memberTicks !== undefined &&
    memberTicks >= uptime - ONLINE_EPSILON_TICKS

  if (detail?.lastOnlineTicks !== undefined) {
    return {
      source: 'player-save',
      at: ticksToDate(detail.lastOnlineTicks),
      onlineAtSave,
    }
  }

  if (memberTicks !== undefined && uptime !== undefined) {
    return {
      source: 'guild-uptime',
      // Deliberately no `at`. See the module comment.
      uptimeTicksAgo: Math.max(0, uptime - memberTicks),
      onlineAtSave,
    }
  }

  return { source: 'none', onlineAtSave: false }
}

/**
 * Picks one basis for a whole list.
 *
 * Only `'absolute'` when *every* player has a detail loaded — otherwise the
 * list would interleave two clocks that disagree, and rows would visibly
 * reshuffle as each player file finished parsing.
 */
export function lastSeenBasis(
  players: Player[],
  details: Map<string, PlayerDetail>,
): 'absolute' | 'uptime' {
  if (players.length === 0) return 'uptime'
  return players.every((p) => details.has(p.playerUid)) ? 'absolute' : 'uptime'
}

/** Human-readable elapsed time for the uptime clock. Never a date. */
export function formatUptimeAgo(ticks: number | undefined): string {
  if (ticks === undefined) return '—'
  const seconds = ticks / 10_000_000
  if (seconds < 60) return 'moments ago'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m of uptime ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h of uptime ago`
  return `${(seconds / 86_400).toFixed(1)}d of uptime ago`
}
