/**
 * Whose pal it is, for a plan that may pool a whole guild.
 *
 * A sibling of `speciesText.ts`, and a separate module for the same reason: a file
 * that exports both a component and a helper loses fast refresh.
 *
 * `badge` returns `undefined` for the selected player's own pals, which is the
 * common case and the one that must render as nothing at all — a step list where
 * every row is tagged with your own name is noise with a label on it. That also
 * makes the whole thing self-silencing: with the guild left out of the stock every
 * pal is the player's own, so no new chrome appears anywhere.
 */

import type { BorrowedPal } from '../../domain/breeding.ts'
import type { Guid, Pal, SaveIndex } from '../../domain/types.ts'
import { shortId } from '../../app/viewParams.ts'

export interface OwnerText {
  /** Whose pal this is, or nothing when it is the planning player's own. */
  badge: (pal: Pal) => { name: string; unowned: boolean } | undefined
  /** A name for a uid, for the rail's per-owner breakdown. */
  name: (uid: Guid | undefined) => string
}

export function ownerText(
  index: SaveIndex,
  ownerUid: Guid | undefined,
): OwnerText {
  // A pal can outlive its owner's player record — a departed member's pals keep
  // their `owner_player_uid`. Falling back to the short id rather than to
  // "someone" keeps it findable in the Pals view.
  const name = (uid: Guid | undefined) =>
    !uid ? 'nobody' : (index.playerByUid.get(uid)?.name ?? shortId(uid))

  return {
    name,
    badge: (pal) => {
      if (!ownerUid || pal.ownerPlayerUid === ownerUid) return undefined
      if (!pal.ownerPlayerUid) return { name: 'base worker', unowned: true }
      return { name: name(pal.ownerPlayerUid), unowned: false }
    },
  }
}

/**
 * "uses 3 pals from 2 guildmates", and the two-tier version of it.
 *
 * The split between a guildmate's pal and an ownerless one is the difference
 * between a conversation and a walk to the base, so it is worth the extra clause.
 */
export function borrowSummary(borrowed: BorrowedPal[]): string {
  const owners = new Set(
    borrowed.filter((b) => b.ownerUid).map((b) => b.ownerUid!),
  )
  const fromPeople = borrowed.filter((b) => b.ownerUid).length
  const workers = borrowed.length - fromPeople

  const pals = (n: number) => `${n} ${n === 1 ? 'pal' : 'pals'}`
  const mates = `${owners.size} ${owners.size === 1 ? 'guildmate' : 'guildmates'}`

  if (fromPeople === 0) {
    return `uses ${workers} base ${workers === 1 ? 'worker' : 'workers'} nobody owns`
  }
  if (workers === 0) return `uses ${pals(fromPeople)} from ${mates}`
  return `uses ${pals(borrowed.length)} you do not own — ${fromPeople} from ${mates}, ${workers} a base worker`
}
