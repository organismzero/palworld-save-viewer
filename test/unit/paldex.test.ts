/**
 * Paldex completion for one player.
 *
 * Synthetic ids throughout.
 */

import { describe, expect, it } from 'vitest'

import type { Pal, PlayerRecord, SaveIndex } from '@/domain/types.ts'
import type { Refdata } from '@/refdata/refdata.ts'
import { buildPaldex, filterPaldex } from '@/views/guild/paldex.ts'

const ANN = 'a'.repeat(32)

const data = {
  species: {
    alpha_one: { name: 'Alpha One', zukan: 1 },
    beta_two: { name: 'Beta Two', zukan: 2 },
    gamma_three: { name: 'Gamma Three', zukan: 3 },
    // No paldex slot: a variant the player holds, and a boss nobody does.
    odd_variant: { name: 'Odd Variant' },
    raid_boss: { name: 'Raid Boss' },
  },
} as unknown as Refdata

const pal = (characterId: string, over: Partial<Pal> = {}) =>
  ({ characterId, ownerPlayerUid: ANN, isBoss: false, isRare: false, ...over }) as Pal // prettier-ignore

const index = {
  pals: [
    pal('Alpha_One', { isBoss: true }),
    pal('Alpha_One', { isRare: true }),
    pal('Odd_Variant'),
    pal('Gamma_Three', { ownerPlayerUid: 'b'.repeat(32) }),
  ],
} as unknown as SaveIndex

const record = {
  captureCountBySpecies: { Alpha_One: 2, Beta_Two: 1, Odd_Variant: 1 },
} as unknown as PlayerRecord

describe('buildPaldex', () => {
  const view = buildPaldex(index, data, record, ANN)

  it('counts only species the paldex has a number for', () => {
    expect(view).toMatchObject({ caught: 2, total: 3, basis: 'ever-caught' })
  })

  it('shows a species with no number only when the player has it', () => {
    const ids = view.cells.map((c) => c.id)
    expect(ids).toEqual(['alpha_one', 'beta_two', 'gamma_three', 'odd_variant'])
    expect(view.cells.at(-1)).toMatchObject({ counted: false, caught: true })
  })

  it('counts alphas and lucky pals held, by species', () => {
    expect(view).toMatchObject({ alpha: 1, lucky: 1 })
  })

  it('falls back on what is held now without a player save', () => {
    const now = buildPaldex(index, data, undefined, ANN)
    expect(now).toMatchObject({ caught: 1, total: 3, basis: 'owned-now' })
  })

  it('counts everything it shows when nothing has a number to go by', () => {
    const degraded = buildPaldex(index, undefined, record, ANN)
    expect(degraded.total).toBe(degraded.cells.length)
    expect(degraded.total).toBeGreaterThan(0)
  })

  it('takes generations from the breeding reach, whatever its casing', () => {
    const depth = new Map([
      ['Alpha_One', 0],
      ['Gamma_Three', 2],
    ])
    const cells = buildPaldex(index, data, record, ANN, depth).cells
    expect(cells.find((c) => c.id === 'gamma_three')).toMatchObject({
      generations: 2,
      breedId: 'Gamma_Three',
    })
    expect(cells.find((c) => c.id === 'beta_two')!.generations).toBeUndefined()
  })
})

describe('filterPaldex', () => {
  const depth = new Map([
    ['alpha_one', 0],
    ['gamma_three', 2],
  ])
  const { cells } = buildPaldex(index, data, record, ANN, depth)
  const off = { query: '', missing: false, breedable: false }
  const ids = (over: Partial<typeof off>) =>
    filterPaldex(cells, { ...off, ...over }).map((c) => c.id)

  it('lets everything through with nothing set', () => {
    expect(ids({})).toHaveLength(cells.length)
  })

  it('finds by name', () => {
    expect(ids({ query: ' beta ' })).toEqual(['beta_two'])
  })

  it('keeps what has not been caught', () => {
    expect(ids({ missing: true })).toEqual(['gamma_three'])
  })

  it('keeps what can be bred and is not already held', () => {
    // Alpha One is reachable at depth 0, which is "held", not "breedable".
    expect(ids({ breedable: true })).toEqual(['gamma_three'])
  })
})
