/**
 * Which duplicates to feed to which pal at the Pal Condenser.
 *
 * Condensing raises one pal's stars by consuming others of its species. So for
 * every species a player holds more than once there is a choice of which one
 * to keep, and this makes it: the one that is best in the ways condensing
 * cannot change.
 *
 * ## What is not here
 *
 * How many duplicates a star costs. That table is in none of the files this
 * app reads, so a row says how many there are to feed and not how far they go.
 * Nor does it assume what happens to a fed pal's own stars and souls. A
 * duplicate that has had either put into it is flagged, so the decision to
 * spend it is made by someone looking at it.
 */

import { ivTotal } from './index.ts'
import { condenserStars } from './palText.ts'
import type { Pal } from './types.ts'

export interface CondenseRow {
  /** Lowercased species id. */
  species: string
  keep: Pal
  /** The rest of that species, in the order they would be given up. */
  feed: Pal[]
  /**
   * Of `feed`, the ones with stars or souls of their own: spending those
   * throws something away, or at least needs a second look.
   */
  invested: Pal[]
}

/** Soul enhancements across all four stats. */
export function soulRanks(p: Pal): number {
  return p.rankHp + p.rankAttack + p.rankDefence + p.rankCraftSpeed
}

/**
 * One row per species held more than once, most duplicates first.
 *
 * The keeper is chosen on IV total, since IVs are what a pal is born with and
 * nothing later changes; then on its passives, summed by the game's own rank
 * for each, which is positive for a good one and negative for a bad one; then
 * on the stars and souls already in it; then level. The instance id is last so
 * two identical pals cannot swap between two loads.
 *
 * Alphas and lucky pals are kept apart from ordinary ones of their species by
 * nothing here: the condenser takes them all, and a lucky pal is still only
 * as good as its IVs.
 */
export function condensePlan(
  pals: readonly Pal[],
  passiveRank: (id: string) => number,
): CondenseRow[] {
  const bySpecies = new Map<string, Pal[]>()
  for (const pal of pals) {
    const id = pal.characterId.toLowerCase()
    const list = bySpecies.get(id)
    if (list) list.push(pal)
    else bySpecies.set(id, [pal])
  }

  const passives = (p: Pal) =>
    p.passives.reduce((sum, id) => sum + passiveRank(id.toLowerCase()), 0)
  const best = (a: Pal, b: Pal) =>
    ivTotal(b) - ivTotal(a) ||
    passives(b) - passives(a) ||
    condenserStars(b) - condenserStars(a) ||
    soulRanks(b) - soulRanks(a) ||
    b.level - a.level ||
    a.instanceId.localeCompare(b.instanceId)

  const rows: CondenseRow[] = []
  for (const [species, held] of bySpecies) {
    if (held.length < 2) continue
    const [keep, ...feed] = [...held].sort(best) as [Pal, ...Pal[]]
    rows.push({
      species,
      keep,
      feed,
      invested: feed.filter((p) => condenserStars(p) > 0 || soulRanks(p) > 0),
    })
  }
  return rows.sort(
    (a, b) =>
      b.feed.length - a.feed.length || a.species.localeCompare(b.species),
  )
}
