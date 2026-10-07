/**
 * Guild roles, and how each one looks.
 *
 * One table because every place that showed a role drifted apart from the
 * others: the player cards hard-coded "master" for the admin and rendered a
 * pill only for roles below 3, the member strip coloured only the admin and
 * ignored `role === 1`, and the summary kept a third, name-only copy that
 * printed "—" for anyone unassigned. Now all of them, and the player hover
 * card, read from here.
 *
 * `signal` is normally reserved for UI chrome rather than data, and the master
 * is the deliberate exception: there is exactly one per guild, and it is the
 * one role worth spending the accent colour on.
 */

import type { Guid, Guild } from '../domain/types.ts'
import type { PillTone } from '../components/primitives.tsx'

export interface RoleStyle {
  name: string
  tone: PillTone
  hint: string
}

export const ROLES: Record<number, RoleStyle> = {
  1: {
    name: 'master',
    tone: 'signal',
    hint: 'Guild master — founded or inherited the guild, and can disband it.',
  },
  2: {
    name: 'officer',
    tone: 'warn',
    hint: 'Officer — elevated permissions over the guild and its bases.',
  },
  3: { name: 'member', tone: 'neutral', hint: 'Member of the guild.' },
  4: {
    name: 'unassigned',
    tone: 'neutral',
    hint: 'No role recorded for this player in the guild data.',
  },
}

export const roleOf = (role: number | undefined): RoleStyle =>
  ROLES[role ?? 4] ?? ROLES[4]!

/**
 * A member's role, with the admin flag winning.
 *
 * The admin flag and the role field are separate records and can disagree;
 * either one makes a master, so every surface agrees on who that is.
 */
export function memberRole(guild: Guild | undefined, uid: Guid): RoleStyle {
  if (guild?.adminPlayerUid === uid) return ROLES[1]!
  return roleOf(guild?.members.find((m) => m.playerUid === uid)?.role)
}
