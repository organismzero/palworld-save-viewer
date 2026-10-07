/**
 * Names and art for a lowercased species id.
 *
 * A separate module from the components that use it so fast refresh keeps
 * working — a file that exports both a component and a helper loses it.
 *
 * Everything here degrades to the raw asset id rather than to a blank, which is
 * what the whole app does when reference data is missing.
 */

import { element } from '../../lib/color.ts'
import type { Refdata } from '../../refdata/refdata.ts'

export interface SpeciesText {
  name: (id: string) => string
  icon: (id: string) => string | undefined
  element: (id: string) => string | undefined
  /** Both elements by name, for filtering. Empty without reference data. */
  elements: (id: string) => string[]
}

export function speciesText(data: Refdata | undefined): SpeciesText {
  return {
    name: (id) => data?.species[id]?.name ?? id,
    icon: (id) => data?.species[id]?.icon,
    element: (id) => data?.species[id]?.element1,
    elements: (id) => {
      const info = data?.species[id]
      return [element(info?.element1), element(info?.element2)].flatMap((e) =>
        e ? [e.name] : [],
      )
    },
  }
}
