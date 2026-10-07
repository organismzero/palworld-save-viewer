/** The species list's filters and order. */

import { describe, expect, it } from 'vitest'

import {
  NO_SPECIES_FILTER,
  filterSpecies,
  speciesFiltered,
  type SpeciesRow,
} from '@/views/breed/speciesFilter.ts'

const rows: SpeciesRow[] = [
  { id: 'aa', name: 'Alpha', zukan: 3, elements: ['Fire'], depth: 2 },
  { id: 'bb', name: 'Beta', zukan: 1, elements: ['Water', 'Ice'], depth: 0 },
  { id: 'cc', name: 'Gamma', zukan: 2, elements: ['Fire', 'Dark'] },
  { id: 'dd', name: 'Delta', zukan: 4, elements: ['Grass'], depth: 1 },
]

const ids = (over: Partial<typeof NO_SPECIES_FILTER>) =>
  filterSpecies(rows, { ...NO_SPECIES_FILTER, ...over }).map((r) => r.id)

describe('filterSpecies', () => {
  it('is everything in paldex order with nothing set', () => {
    expect(ids({})).toEqual(['bb', 'cc', 'aa', 'dd'])
  })

  it('finds by name or id', () => {
    expect(ids({ query: ' alp ' })).toEqual(['aa'])
    expect(ids({ query: 'dd' })).toEqual(['dd'])
  })

  it('keeps a species with any of the chosen elements, either slot', () => {
    expect(ids({ elements: new Set(['Fire']) })).toEqual(['cc', 'aa'])
    expect(ids({ elements: new Set(['Ice', 'Grass']) })).toEqual(['bb', 'dd'])
  })

  it('keeps what can be reached, held included', () => {
    expect(ids({ reachable: true })).toEqual(['bb', 'aa', 'dd'])
  })

  it('leaves out what is held, and keeps what cannot be reached', () => {
    expect(ids({ unowned: true })).toEqual(['cc', 'aa', 'dd'])
    expect(ids({ unowned: true, reachable: true })).toEqual(['aa', 'dd'])
  })

  it('orders by generations with the unreachable last', () => {
    expect(ids({ sort: 'gen' })).toEqual(['bb', 'dd', 'aa', 'cc'])
  })
})

describe('speciesFiltered', () => {
  it('does not count the search box', () => {
    expect(speciesFiltered({ ...NO_SPECIES_FILTER, query: 'x' })).toBe(false)
    expect(speciesFiltered({ ...NO_SPECIES_FILTER, sort: 'gen' })).toBe(true)
    expect(speciesFiltered({ ...NO_SPECIES_FILTER, unowned: true })).toBe(true)
  })
})
