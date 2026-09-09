/**
 * Names, ranks and descriptions for a lowercased passive asset id.
 *
 * A separate module from the components that use it so fast refresh keeps
 * working — a file that exports both a component and a helper loses it, which is
 * why `speciesText.ts` sits beside it rather than inside `BreedView`.
 *
 * Everything here degrades to the raw asset id rather than to a blank. A raw one
 * like `ElementResist_Fire_1_PAL` is wider than the chip it sits in, which is
 * exactly what `PassiveChip`'s truncation and `title` are for.
 */

import type { Refdata } from '../../refdata/refdata.ts'

export interface PassiveText {
  name: (id: string) => string
  rank: (id: string) => number | undefined
  description: (id: string) => string | undefined
  /** Every passive a pal could carry, best first. Empty in degraded mode. */
  all: () => { id: string; name: string; rank: number }[]
}

export function passiveText(data: Refdata | undefined): PassiveText {
  return {
    name: (id) => data?.passives[id]?.name ?? id,
    rank: (id) => data?.passives[id]?.rank,
    description: (id) => data?.passives[id]?.description,
    // Rank descending, so the ones people actually breed for are at the top of
    // an unfiltered list, and detrimental traits sink to the bottom where they
    // belong without being hidden.
    all: () =>
      Object.entries(data?.passives ?? {})
        .map(([id, info]) => ({ id, name: info.name, rank: info.rank }))
        .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)),
  }
}
