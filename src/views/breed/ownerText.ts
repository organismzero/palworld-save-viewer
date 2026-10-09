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
  return `uses ${pals(borrowed.length)} you do not own — ${fromPeople} from ${mates}, ${workers} base ${workers === 1 ? 'worker' : 'workers'}`
}

/** One person to ask, or the base, and what to get from them. */
export interface BorrowGroup {
  /** Absent for base workers, which nobody has to be asked for. */
  ownerUid?: Guid
  pals: BorrowedPal[]
}

/**
 * The borrowed pals as a list of asks, one per owner.
 *
 * People first, whoever has most to lend at the top, since that is the longest
 * conversation; the base last, because fetching a worker needs nobody's say.
 */
export function borrowGroups(borrowed: readonly BorrowedPal[]): BorrowGroup[] {
  const byOwner = new Map<string, BorrowGroup>()
  for (const b of borrowed) {
    const key = b.ownerUid ?? ''
    const group = byOwner.get(key)
    if (group) group.pals.push(b)
    else byOwner.set(key, { ownerUid: b.ownerUid, pals: [b] })
  }
  return [...byOwner.values()].sort(
    (x, y) =>
      (x.ownerUid ? 0 : 1) - (y.ownerUid ? 0 : 1) ||
      y.pals.length - x.pals.length ||
      (x.ownerUid ?? '').localeCompare(y.ownerUid ?? ''),
  )
}

/** "Foxparks ♀ lv 12", with the nickname when it has one. */
export function borrowedPalText(
  b: BorrowedPal,
  speciesName: (id: string) => string,
): string {
  const sex =
    b.pal.gender === 'Male' ? ' ♂' : b.pal.gender === 'Female' ? ' ♀' : ''
  const species = speciesName(b.species)
  const named = b.pal.nickname ? `${b.pal.nickname} (${species})` : species
  return `${named}${sex} lv ${b.pal.level}`
}

/**
 * The asks as plain text, to paste to a guildmate.
 *
 * One line per owner, so a line can be sent to the person it names without
 * editing. Level is included because a guild usually holds several of a
 * species and "the Foxparks" does not say which.
 */
export function borrowText(
  borrowed: readonly BorrowedPal[],
  ownerName: (uid: Guid | undefined) => string,
  speciesName: (id: string) => string,
  target?: string,
): string {
  const lines = borrowGroups(borrowed).map((g) => {
    const pals = list(g.pals.map((b) => borrowedPalText(b, speciesName)))
    return g.ownerUid
      ? `Ask ${ownerName(g.ownerUid)} for ${pals}.`
      : `Fetch from the base: ${pals}.`
  })
  return [target ? `To breed ${target}:` : undefined, ...lines]
    .filter(Boolean)
    .join('\n')
}

function list(items: string[]): string {
  if (items.length <= 2) return items.join(' and ')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
