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
  caught: boolean
  /** How many of this species the player holds right now. */
  owned: number
  alpha: boolean
  lucky: boolean
}

export interface PaldexView {
  cells: PaldexCell[]
  caught: number
  total: number
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
        caught:
          basis === 'ever-caught'
            ? (everCaught.get(id) ?? 0) > 0
            : (here?.n ?? 0) > 0,
        owned: here?.n ?? 0,
        alpha: here?.alpha ?? false,
        lucky: here?.lucky ?? false,
      }
    })
    .sort((a, b) => a.zukan - b.zukan || a.name.localeCompare(b.name))

  return {
    cells,
    caught: cells.filter((c) => c.caught).length,
    total: cells.length,
    basis,
  }
}
