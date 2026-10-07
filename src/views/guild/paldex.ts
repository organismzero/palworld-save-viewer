/**
 * Paldex completion, for one player.
 *
 * ## The honesty problem this is built around
 *
 * There are two different questions that look like one:
 *
 * - **Ever caught** — `PlayerRecord.captureCountBySpecies`, which only exists
 *   once that player's `Players/<uid>.sav` has been loaded.
 * - **Owned now** — derivable from the level save alone, but it is not
 *   completion: a species released or handed to a guildmate disappears from it.
 *
 * Without a player save, only the second is available, and showing it under a
 * heading that says "paldex" would claim progress data the app does not have.
 * So the panel names which of the two it is showing, every time, and the empty
 * cells mean something different in each case.
 */

import type { PlayerRecord, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'

export interface PaldexCell {
  /** Lowercased asset id — the key reference data uses. */
  id: string
  name: string
  icon?: string
  zukan: number
  /**
   * Whether the paldex has a slot for it. Crossover and variant species have
   * no number: one you hold is still shown, but it is not progress and is
   * left out of both halves of the fraction.
   */
  counted: boolean
  caught: boolean
  /** How many of this species the player holds right now. */
  owned: number
  alpha: boolean
  lucky: boolean
  /**
   * Generations of breeding from what this player holds: 0 when they hold it,
   * absent when it cannot be bred from their pals or nothing is known.
   */
  generations?: number
  /** The id the breeding table knows it by, for a link into Breed. */
  breedId?: string
}

export interface PaldexView {
  cells: PaldexCell[]
  /** Numbered species caught, and numbered species there are. */
  caught: number
  total: number
  /** Numbered species this player holds an alpha of, and a lucky one of. */
  alpha: number
  lucky: number
  /** Which question the cells answer. Drives the wording, not just a flag. */
  basis: 'ever-caught' | 'owned-now'
}

/**
 * Builds the grid.
 *
 * Ordered by `zukan`, the game's own paldex index, so the layout matches the
 * one people already know. Species with no `zukan` — variants and unreleased
 * entries in the reference data — sort last rather than being dropped, because
 * a pal you own that the paldex has no slot for is still worth seeing.
 */
export function buildPaldex(
  index: SaveIndex,
  refdata: Refdata | undefined,
  record: PlayerRecord | undefined,
  ownerUid: string,
  /** Species → generations from this player's pals, as `reachFrom` gives it. */
  depth?: ReadonlyMap<string, number>,
): PaldexView {
  const species = refdata?.species ?? {}

  // Owned-now, from the level save. Keys are not lowercased there, so this
  // normalises on the way in — the casing trap that bites every lookup.
  const owned = new Map<string, { n: number; alpha: boolean; lucky: boolean }>()
  for (const pal of index.pals) {
    if (pal.ownerPlayerUid !== ownerUid) continue
    const key = pal.characterId.toLowerCase()
    const prev = owned.get(key) ?? { n: 0, alpha: false, lucky: false }
    owned.set(key, {
      n: prev.n + 1,
      alpha: prev.alpha || pal.isBoss,
      lucky: prev.lucky || pal.isRare,
    })
  }

  const everCaught = new Map<string, number>()
  for (const [id, n] of Object.entries(record?.captureCountBySpecies ?? {})) {
    everCaught.set(id.toLowerCase(), n)
  }

  const basis: PaldexView['basis'] = record ? 'ever-caught' : 'owned-now'

  // The breeding table keeps the game's own casing; everything here is keyed
  // lowercase.
  const reach = new Map<string, { id: string; generations: number }>()
  for (const [id, generations] of depth ?? []) {
    reach.set(id.toLowerCase(), { id, generations })
  }

  // The universe of species is reference data when available. Degraded, it is
  // whatever this player owns — a short grid, but an honest one.
  const ids = refdata
    ? Object.keys(species)
    : [...new Set([...owned.keys(), ...everCaught.keys()])]

  const cells: PaldexCell[] = ids
    .map((id) => {
      const info = species[id]
      const here = owned.get(id)
      return {
        id,
        name: info?.name ?? id,
        icon: info?.icon,
        zukan: info?.zukan ?? Number.MAX_SAFE_INTEGER,
        // Degraded, nothing has a number and everything shown is something
        // the player has, so all of it counts or the fraction would be 0/0.
        counted: refdata ? info?.zukan !== undefined : true,
        generations: reach.get(id)?.generations,
        breedId: reach.get(id)?.id,
        caught:
          basis === 'ever-caught'
            ? (everCaught.get(id) ?? 0) > 0
            : (here?.n ?? 0) > 0,
        owned: here?.n ?? 0,
        alpha: here?.alpha ?? false,
        lucky: here?.lucky ?? false,
      }
    })
    // A species with no number that the player has never had is not a gap in
    // anything: it is a raid boss or a human, and five hundred of them greyed
    // out under the real paldex is noise.
    .filter((c) => c.counted || c.caught || c.owned > 0)
    .sort((a, b) => a.zukan - b.zukan || a.name.localeCompare(b.name))

  const counted = cells.filter((c) => c.counted)
  return {
    cells,
    caught: counted.filter((c) => c.caught).length,
    total: counted.length,
    alpha: counted.filter((c) => c.alpha).length,
    lucky: counted.filter((c) => c.lucky).length,
    basis,
  }
}

export interface PaldexFilter {
  query: string
  /** Only what has not been caught. */
  missing: boolean
  /** Only what can be bred from what the player holds, and is not held. */
  breedable: boolean
}

export function filterPaldex(
  cells: readonly PaldexCell[],
  f: PaldexFilter,
): PaldexCell[] {
  const q = f.query.trim().toLowerCase()
  return cells.filter(
    (c) =>
      (!q || c.name.toLowerCase().includes(q) || c.id.includes(q)) &&
      (!f.missing || !c.caught) &&
      (!f.breedable || (c.generations ?? 0) > 0),
  )
}
