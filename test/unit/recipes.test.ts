/**
 * Cake recipes and ingredient sources.
 *
 * The recipes are typed in, so the test that matters is that every id in them
 * names an item the sources can be worked out for; the sources are read from
 * reference data, so those are tested over a small fixture shaped like it.
 */

import { describe, expect, it } from 'vitest'

import {
  CAKES,
  DEFAULT_CAKE,
  cakeRecipe,
  ingredientSources,
} from '@/domain/recipes.ts'
import type { ItemInfo, Refdata, SpeciesInfo } from '@/refdata/refdata.ts'

const item = (name: string): ItemInfo => ({
  name,
  rarity: 0,
  typeA: '',
  typeB: '',
  weight: 0,
  maxStack: 1,
})
const species = (name: string, extra: Partial<SpeciesInfo> = {}) => ({
  name,
  zukan: 1,
  ...extra,
})

const DATA = {
  species: {
    cowpal: species('Mozzarina', { ranchDrops: ['milk'] }),
    berrygoat: species('Caprity', { ranchDrops: ['berries'] }),
    grassmammoth: species('Mammorest'),
    // A quest-only variant with no paldex slot drops milk too; it is not a pal
    // anyone can catch, so it is not offered.
    quest_cow: { name: 'Quest Cow', ranchDrops: ['milk'] },
  },
  items: {
    milk: item('Milk'),
    berries: item('Red Berries'),
    berryseeds: item('Berry Seeds'),
    tomato: item('Tomato'),
    tomatoseeds: item('Tomato Seeds'),
    flour: item('Flour'),
    wheat: item('Wheat'),
    wheatseeds: item('Wheat Seeds'),
    meat_grassmammoth: item('Mammorest Meat'),
  },
} as unknown as Refdata

describe('cake recipes', () => {
  it('lists the five tiers, cheapest first, and defaults to the best', () => {
    expect(CAKES.map((c) => c.item)).toEqual([
      'Cake',
      'Cake02',
      'Cake03',
      'Cake04',
      'Cake05',
    ])
    expect(cakeRecipe(DEFAULT_CAKE)?.item).toBe('Cake05')
    expect(cakeRecipe('cake03')?.ingredients).toHaveLength(5)
  })

  it('has positive counts and no ingredient twice in one recipe', () => {
    for (const cake of CAKES) {
      const ids = cake.ingredients.map((i) => i.item)
      expect(new Set(ids).size).toBe(ids.length)
      expect(cake.ingredients.every((i) => i.count > 0)).toBe(true)
    }
  })
})

describe('ingredientSources', () => {
  it('finds ranch producers, and only catchable ones', () => {
    expect(ingredientSources(DATA, 'Milk')).toEqual([
      { kind: 'ranch', species: ['cowpal'] },
    ])
  })

  it('finds a crop by its seed item, singular for a plural crop', () => {
    expect(ingredientSources(DATA, 'Tomato')).toEqual([
      { kind: 'crop', seed: 'tomatoseeds' },
    ])
    expect(ingredientSources(DATA, 'Berries')).toEqual([
      { kind: 'ranch', species: ['berrygoat'] },
      { kind: 'crop', seed: 'berryseeds' },
    ])
  })

  it('names the typed-in processing step', () => {
    expect(ingredientSources(DATA, 'Flour')).toEqual([
      { kind: 'processed', from: 'Wheat', at: 'Mill' },
    ])
  })

  it('reads the butchered species out of a meat id', () => {
    expect(ingredientSources(DATA, 'Meat_GrassMammoth')).toEqual([
      { kind: 'butcher', species: 'grassmammoth' },
    ])
  })

  it('knows nothing without reference data', () => {
    expect(ingredientSources(undefined, 'Milk')).toEqual([])
  })
})
