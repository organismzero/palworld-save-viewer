/**
 * Which element beats which.
 *
 * **The one table in this app typed in by hand.** Nothing PalworldSaveTools
 * publishes carries it — `skills.json`'s `elements` section has names, colours
 * and icons and nothing else — so it is written out here, from the chart as the
 * game presents it:
 *
 *     Grass → Ground → Electric → Water → Fire → Grass
 *     Fire → Ice → Dragon → Dark → Neutral
 *
 * Fire is the only element that beats two. Neutral beats nothing.
 *
 * Keys are the data's own internal names (`Leaf`, `Earth`, `Electricity`,
 * `Normal`), so a species' `element1` can be looked up without translating.
 *
 * The chart says who beats whom and nothing about by how much. The ×2 and ×0.5
 * below are this app's assumption, and the Builds view says so wherever it prints
 * one.
 */

import { element } from '../lib/color.ts'

export const BEATS: Readonly<Record<string, readonly string[]>> = {
  Leaf: ['Earth'],
  Earth: ['Electricity'],
  Electricity: ['Water'],
  Water: ['Fire'],
  Fire: ['Leaf', 'Ice'],
  Ice: ['Dragon'],
  Dragon: ['Dark'],
  Dark: ['Normal'],
  Normal: [],
}

/** Every element that has an entry, in the data's own order. */
export const ALL_ELEMENTS = Object.keys(BEATS)

export const STRONG = 2
export const WEAK = 0.5

/** `Grass`, `EPalElementType::Leaf` or `leaf` → `Leaf`; unknown → undefined. */
function canonical(raw: string | undefined): string | undefined {
  return element(raw)?.name
}

/** One attacking element against one defending element. */
export function multiplier(attack: string, defend: string): number {
  const a = canonical(attack)
  const d = canonical(defend)
  if (!a || !d) return 1
  if (BEATS[a]?.includes(d)) return STRONG
  if (BEATS[d]?.includes(a)) return WEAK
  return 1
}

/**
 * One attacking element against everything a defender is.
 *
 * Multiplied across a dual-element defender, so a hit that one of its elements
 * is weak to and the other resists comes out even. That combination rule is part
 * of the same assumption as the numbers themselves.
 */
export function against(
  attack: string,
  defenders: readonly (string | undefined)[],
): number {
  let m = 1
  for (const d of defenders) if (d) m *= multiplier(attack, d)
  return m
}

/** Elements that hit `defenders` harder than neutral, best first. */
export function strongAgainst(
  defenders: readonly (string | undefined)[],
): { element: string; multiplier: number }[] {
  return ALL_ELEMENTS.map((e) => ({
    element: e,
    multiplier: against(e, defenders),
  }))
    .filter((r) => r.multiplier > 1)
    .sort((a, b) => b.multiplier - a.multiplier)
}
