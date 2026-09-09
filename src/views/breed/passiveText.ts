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

import type { PassiveInfo, Refdata } from '../../refdata/refdata.ts'

export interface PassiveText {
  name: (id: string) => string
  rank: (id: string) => number | undefined
  description: (id: string) => string | undefined
  /**
   * How to get one, in a sentence, for a passive breeding cannot supply.
   *
   * Entirely derived: the source comes from upstream's own `add_*` flags and the
   * implant from an item whose asset id names the passive it applies. Nothing
   * here is game lore typed into the repo, which is why it can be shown without
   * a "we think" attached. Absent when reference data has not loaded.
   */
  origin: (id: string) => string | undefined
  /** Every passive a pal could carry, best first. Empty in degraded mode. */
  all: () => { id: string; name: string; rank: number }[]
}

/**
 * Where a passive comes from when a parent cannot supply it.
 *
 * The source is the important half and goes first, because it is what decides
 * whether more egg-farming could ever work: a mutation-only passive will not
 * turn up on an ordinary hatch however long you grind. The implant is the way
 * round it, and is worth naming precisely — a reusable one is a purchase, a
 * disposable one is a single shot.
 */
function origin(info: PassiveInfo): string {
  const from = {
    random: 'Turns up on wild pals and on hatches, at random.',
    lucky: 'Only ever on Lucky pals.',
    worldtree: 'Only from World Tree pals — blue-glowing catches and ominous eggs.',
    mutation: 'Only on mutated pals; an ordinary hatch never rolls it.',
    exclusive:
      'Comes with the species that has it. No catch or hatch puts it on anything else.',
  }[info.source]

  const implant = {
    reusable: ' A reusable implant for it exists, applied at a Pal Surgery Table.',
    disposable:
      ' A single-use implant for it exists, applied at a Pal Surgery Table.',
    both: ' Implants for it exist, reusable and single-use, applied at a Pal Surgery Table.', // prettier-ignore
  }
  return from + (info.implant ? implant[info.implant] : '')
}

export function passiveText(data: Refdata | undefined): PassiveText {
  return {
    name: (id) => data?.passives[id]?.name ?? id,
    rank: (id) => data?.passives[id]?.rank,
    description: (id) => data?.passives[id]?.description,
    origin: (id) => {
      const info = data?.passives[id]
      return info ? origin(info) : undefined
    },
    // Rank descending, so the ones people actually breed for are at the top of
    // an unfiltered list, and detrimental traits sink to the bottom where they
    // belong without being hidden.
    all: () =>
      Object.entries(data?.passives ?? {})
        .map(([id, info]) => ({ id, name: info.name, rank: info.rank }))
        .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)),
  }
}
