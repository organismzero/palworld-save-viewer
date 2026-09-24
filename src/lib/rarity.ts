/**
 * The common → legendary ramp.
 *
 * Rarity 0 gets no frame at all: most of what fills a chest is rarity 0, and
 * giving it a colour would make every grid a wall of noise. A handful of items
 * carry rarity 5 or a sentinel 99, which clamp to the top of the ramp.
 *
 * Shared by the inventory cell, which frames itself in the colour, and the item
 * hover card, which rules its header with it — so a card always matches the
 * slot it came from.
 */
export const RARITY = [
  { name: 'common', color: undefined },
  { name: 'uncommon', color: 'var(--color-rarity-uncommon)' },
  { name: 'rare', color: 'var(--color-rarity-rare)' },
  { name: 'epic', color: 'var(--color-rarity-epic)' },
  { name: 'legendary', color: 'var(--color-rarity-legendary)' },
] as const

export type Rarity = (typeof RARITY)[number]

export function rarityOf(rarity: number | undefined): Rarity {
  const i = Math.max(0, Math.min(RARITY.length - 1, Math.round(rarity ?? 0)))
  return RARITY[i] ?? RARITY[0]
}
