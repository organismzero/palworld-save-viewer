/**
 * Colours for telling categories apart: guilds on the map, builders on a base
 * plan.
 *
 * These are data colours. They distinguish things that have no order and no
 * meaning of their own, so they sit outside the interface's palette, and they
 * are never the element hues: a builder drawn in "fire" would read as a claim
 * about fire.
 *
 * Pink is left out because hand-placed map pins already use it.
 */

export const CATEGORICAL: readonly number[] = [
  0xf59e0b, // amber
  0x34d399, // green
  0x60a5fa, // blue
  0xa78bfa, // violet
  0xfb7185, // rose
  0x22d3ee, // cyan
  0xfacc15, // yellow
  0xfb923c, // orange
]

/** The `i`th colour, as a number for Pixi. Past the end the colours repeat. */
export function categorical(i: number): number {
  return CATEGORICAL[i % CATEGORICAL.length]!
}

/** The same colour for CSS. */
export function categoricalCss(i: number): string {
  return `#${categorical(i).toString(16).padStart(6, '0')}`
}
