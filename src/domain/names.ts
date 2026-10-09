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

import type { Refdata, SpeciesInfo } from '../refdata/refdata.ts'
import { baseLabel } from './bases.ts'
import type { Guid, Pal, SaveIndex } from './types.ts'

/**
 * What a pal in a save *is*: its row in the reference data.
 *
 * Not simply the row for its `characterId`, because of what the `BOSS_` prefix
 * means, which is two different things. On a pal it marks an alpha: the same
 * species, the same row, and the reader strips it. On a person it names an
 * individual. `BOSS_Hunter_Rifle` is not a big Syndicate Gunner, it is Hawk —
 * one of the wanted criminals, with a name and a row of their own — and
 * reading her as her species puts "Syndicate Gunner" on somebody the game
 * calls Hawk.
 *
 * So a boss is looked up under its prefixed id first, and that row is used
 * when it is a person's. Everything else, alphas included, gets the plain row.
 * Lowercases, like every helper here.
 */
export function speciesOf(
  refdata: Refdata | undefined,
  pal: Pick<Pal, 'characterId' | 'isBoss'>,
): SpeciesInfo | undefined {
  if (!refdata) return undefined
  const id = pal.characterId.toLowerCase()
  if (pal.isBoss) {
    const named = refdata.species[`boss_${id}`]
    if (named?.human) return named
  }
  return refdata.species[id]
}

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
