/**
 * Cake recipes, and where their ingredients come from.
 *
 * **The second table in this app typed in by hand**, after the element chart in
 * `typeChart.ts`. PalworldSaveTools publishes every cake as an item — name,
 * rarity, and a description of what it does to a Breeding Farm's eggs — but no
 * recipes at all, so the ingredients are transcribed here from a list the
 * project owner supplied. If a patch changes a recipe, this is where to fix it.
 *
 * Everything else is read from the data: which pals drop an ingredient at a
 * Ranch (`SpeciesInfo.ranchDrops`), which ingredients are crops (a seed item
 * exists for them), and which meat comes from butchering which pal (the item id
 * names the species). The one chain the data cannot state — Flour is Wheat
 * milled — is typed in beside the recipes, in `PROCESSED`.
 *
 * Ids are item asset ids as `items.json` spells them, not display names: the
 * data calls Red Berries `Berries` and Cotton Candy `Sweet`.
 */

import type { Refdata } from '../refdata/refdata.ts'

export interface Ingredient {
  item: string
  count: number
}

export interface CakeRecipe {
  /** The cake's own item id. */
  item: string
  ingredients: Ingredient[]
}

/** Cheapest to best, in the order the game unlocks them. */
export const CAKES: readonly CakeRecipe[] = [
  {
    item: 'Cake',
    ingredients: [
      { item: 'Flour', count: 5 },
      { item: 'Berries', count: 8 },
      { item: 'Milk', count: 7 },
      { item: 'Egg', count: 8 },
      { item: 'Honey', count: 2 },
    ],
  },
  {
    item: 'Cake02',
    ingredients: [
      { item: 'Flour', count: 5 },
      { item: 'Mushroom', count: 5 },
      { item: 'CaveMushroom', count: 3 },
      { item: 'Egg', count: 8 },
      { item: 'Honey', count: 2 },
    ],
  },
  {
    item: 'Cake03',
    ingredients: [
      { item: 'Flour', count: 8 },
      { item: 'Tomato', count: 8 },
      { item: 'Lettuce', count: 7 },
      { item: 'Egg', count: 8 },
      { item: 'Honey', count: 4 },
    ],
  },
  {
    item: 'Cake04',
    ingredients: [
      { item: 'Flour', count: 12 },
      { item: 'Sweet', count: 8 },
      { item: 'Potato', count: 10 },
      { item: 'Onion', count: 6 },
      { item: 'Carrot', count: 8 },
    ],
  },
  {
    item: 'Cake05',
    ingredients: [
      { item: 'Flour', count: 20 },
      { item: 'Sweet_Caramel', count: 8 },
      { item: 'Milk', count: 15 },
      { item: 'Egg', count: 15 },
      { item: 'Meat_GrassMammoth', count: 2 },
    ],
  },
]

/** The Special Cake: what a breeder aiming for passives wants. */
export const DEFAULT_CAKE = 'Cake05'

export function cakeRecipe(item: string): CakeRecipe | undefined {
  const key = item.toLowerCase()
  return CAKES.find((c) => c.item.toLowerCase() === key)
}

/** Made from something else, somewhere the data does not say. */
export const PROCESSED: Readonly<Record<string, { from: string; at: string }>> =
  {
    Flour: { from: 'Wheat', at: 'Mill' },
  }

export type IngredientSource =
  /** Dropped by these species when they work a Ranch. */
  | { kind: 'ranch'; species: string[] }
  /** Grown: a seed item exists for it. */
  | { kind: 'crop'; seed: string }
  /** Made from another ingredient at a station. */
  | { kind: 'processed'; from: string; at: string }
  /** Butchered from this species. */
  | { kind: 'butcher'; species: string }

/**
 * Every way the data knows to come by an item. Usually one; an item can be both
 * dropped at a Ranch and grown, and then both are listed.
 *
 * Ids are compared lowercased, as reference data keys them.
 */
export function ingredientSources(
  data: Refdata | undefined,
  itemId: string,
): IngredientSource[] {
  if (!data) return []
  const key = itemId.toLowerCase()
  const out: IngredientSource[] = []

  const processed = Object.entries(PROCESSED).find(
    ([id]) => id.toLowerCase() === key,
  )?.[1]
  if (processed) out.push({ kind: 'processed', ...processed })

  const species = Object.entries(data.species)
    .filter(([, s]) => s.zukan !== undefined && s.ranchDrops?.includes(key))
    .map(([id]) => id)
  if (species.length > 0) out.push({ kind: 'ranch', species })

  // Seeds are named after the crop's id, singular: `TomatoSeeds`, and
  // `BerrySeeds` for `Berries`.
  const seed = [`${key}seeds`, `${key.replace(/ies$/, 'y')}seeds`].find(
    (id) => data.items[id],
  )
  if (seed) out.push({ kind: 'crop', seed })

  // `Meat_GrassMammoth` is Mammorest Meat: the id names the species.
  const meat = /^meat_(.+)$/.exec(key)?.[1]
  if (meat && data.species[meat]) out.push({ kind: 'butcher', species: meat })

  return out
}
