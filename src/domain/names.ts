/**
 * What things are called: one resolver per kind of thing.
 *
 * Every display name comes from reference data with a fall back to the raw
 * asset id, because the app has a designed degraded state where none of it
 * arrived. These used to be written out wherever they were needed — a closure
 * in the Bases view, another in the palette, a stub in the exports that wrote
 * the asset id and the literal word "Base" — and so the same chest was a
 * "Wooden Chest" on screen and a `Chest_Wood` in the file saved from that
 * screen.
 *
 * ## The casing trap
 *
 * `Refdata`'s tables are keyed by **lowercased** asset id, and the ids on a
 * `Pal`, an `ItemStack` and a `Structure` are not lowercased. Forgetting
 * silently yields the raw id for every row, which looks like working code with
 * bad reference data rather than a bug. Each helper does it once, here.
 */

import type { Refdata } from '../refdata/refdata.ts'
import { baseLabel } from './bases.ts'
import type { Guid, SaveIndex } from './types.ts'

export function speciesName(refdata: Refdata | undefined, id: string): string {
  return refdata?.species[id.toLowerCase()]?.name ?? id
}

export function itemName(refdata: Refdata | undefined, id: string): string {
  return refdata?.items[id.toLowerCase()]?.name ?? id
}

export function structureName(
  refdata: Refdata | undefined,
  s: { mapObjectId: string },
): string {
  return refdata?.structures[s.mapObjectId.toLowerCase()]?.name ?? s.mapObjectId
}

/** An active skill, by the tail of its `EPalWazaID::…` id. */
export function skillName(refdata: Refdata | undefined, id: string): string {
  return refdata?.skills[id.toLowerCase()]?.name ?? id
}

/**
 * Every base's label, by id: "Base 2 · near Sea Breeze Archipelago".
 *
 * A map rather than a function of one base because the ordinal is the base's
 * place in the save's own order, which only the whole list knows.
 */
export function baseNames(
  index: SaveIndex,
  refdata: Refdata | undefined,
): Map<Guid, string> {
  return new Map(
    index.bases.map((b, i) => [
      b.baseId,
      baseLabel(b, i + 1, refdata?.landmarks),
    ]),
  )
}
