/**
 * Narrowing and ordering a list of species.
 *
 * Shared by the Breed species list and the Builds opponent list, which are the
 * same list asked two different questions. Pure, so it is tested without
 * either view.
 */

export interface SpeciesRow {
  id: string
  name: string
  /** Paldex number, or a very large one for a species without a slot. */
  zukan: number
  /** Element names, as `lib/color.ts` has them. One or two. */
  elements: readonly string[]
  /** Generations from the stock: 0 held, absent unreachable or not asked. */
  depth?: number
}

export type SpeciesSort = 'paldex' | 'gen'

export interface SpeciesFilter {
  query: string
  /** Any of these. Empty means every element. */
  elements: ReadonlySet<string>
  /** Only what can be bred from the stock, or is already in it. */
  reachable: boolean
  /** Leave out what is already held. */
  unowned: boolean
  sort: SpeciesSort
}

export const NO_SPECIES_FILTER: SpeciesFilter = {
  query: '',
  elements: new Set(),
  reachable: false,
  unowned: false,
  sort: 'paldex',
}

export function filterSpecies(
  rows: readonly SpeciesRow[],
  f: SpeciesFilter,
): SpeciesRow[] {
  const q = f.query.trim().toLowerCase()
  const paldex = (a: SpeciesRow, b: SpeciesRow) =>
    a.zukan - b.zukan || a.name.localeCompare(b.name)
  // Nearest first, and what cannot be reached at all last: "sort by
  // generations" is asked to find the cheap wins.
  const gen = (r: SpeciesRow) => r.depth ?? Number.MAX_SAFE_INTEGER
  return rows
    .filter(
      (r) =>
        (!q || r.id.includes(q) || r.name.toLowerCase().includes(q)) &&
        (f.elements.size === 0 || r.elements.some((e) => f.elements.has(e))) &&
        (!f.reachable || r.depth !== undefined) &&
        (!f.unowned || r.depth !== 0),
    )
    .sort(f.sort === 'gen' ? (a, b) => gen(a) - gen(b) || paldex(a, b) : paldex)
}

/** Whether anything but the search box is narrowing or reordering the list. */
export function speciesFiltered(f: SpeciesFilter): boolean {
  return f.elements.size > 0 || f.reachable || f.unowned || f.sort !== 'paldex'
}
