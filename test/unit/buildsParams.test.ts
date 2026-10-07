/** The Builds view's link, and the pool it is measured against. Synthetic ids. */

import { describe, expect, it } from 'vitest'

import { serialiseParams } from '@/app/viewParams.ts'
import type { Stock } from '@/domain/breeding.ts'
import type { Pal, SaveIndex } from '@/domain/types.ts'
import { breedCodec, BREED_DEFAULTS } from '@/views/breed/params.ts'
import { breedHref, stockPals } from '@/views/builds/buildsText.ts'
import {
  BUILDS_DEFAULTS,
  buildsCodec,
  type BuildsParams,
} from '@/views/builds/params.ts'

const ANN = 'a'.repeat(32)
const BOB = 'b'.repeat(32)
const GONE = 'c'.repeat(32)

const index = {
  playerByUid: new Map([
    [ANN, { name: 'Ann' }],
    [BOB, { name: 'Bob' }],
  ]),
  // A departed member: pals, and no player record.
  palsByOwner: new Map([[GONE, []]]),
  palById: new Map(),
} as unknown as SaveIndex

const codec = buildsCodec(index)
const roundTrip = (over: Partial<BuildsParams>) => {
  const value = { ...BUILDS_DEFAULTS, ...over }
  const qs = serialiseParams(codec.encode(value, BUILDS_DEFAULTS))
  return codec.decode(new URLSearchParams(qs), BUILDS_DEFAULTS)
}

describe('buildsCodec', () => {
  it('writes nothing for an untouched view', () => {
    expect(codec.encode(BUILDS_DEFAULTS, BUILDS_DEFAULTS)).toEqual({})
  })

  it('round-trips the opponent list’s elements', () => {
    expect(roundTrip({ elements: ['Fire', 'Ice'] }).elements).toEqual(['Fire', 'Ice']) // prettier-ignore
    const got = codec.decode(new URLSearchParams('el=fire,nope'), BUILDS_DEFAULTS) // prettier-ignore
    expect(got.elements).toEqual(['Fire'])
  })

  it('round-trips who else is counted, a departed member included', () => {
    const got = roundTrip({ includeBase: true, includeMembers: [BOB, GONE] })
    expect(got).toMatchObject({
      includeGuild: false,
      includeBase: true,
      includeMembers: [BOB, GONE],
    })
  })

  it('lets "everyone" stand for the finer two, as Breed does', () => {
    const out = codec.encode(
      { ...BUILDS_DEFAULTS, includeGuild: true, includeBase: true, includeMembers: [BOB] }, // prettier-ignore
      BUILDS_DEFAULTS,
    )
    expect(out).toEqual({ gp: '1' })
  })

  it('drops a member this save has never heard of', () => {
    const got = codec.decode(new URLSearchParams('gm=dddddddd'), BUILDS_DEFAULTS) // prettier-ignore
    expect(got.includeMembers).toEqual([])
  })
})

describe('a Breed link from Builds', () => {
  it('carries the pool, so the plan is from the pals the list counted', () => {
    const href = breedHref(index, ANN, 'target', ['swift'], {
      includeBase: true,
      includeMembers: [BOB],
    })
    const qs = href.slice(href.indexOf('?') + 1)
    const got = breedCodec(index).decode(new URLSearchParams(qs), BREED_DEFAULTS) // prettier-ignore
    expect(got).toMatchObject({
      playerUid: ANN,
      target: 'target',
      passives: ['swift'],
      includeBase: true,
      includeMembers: [BOB],
    })
  })

  it('pools nothing unless asked', () => {
    expect(breedHref(index, ANN, 'target', [])).toBe('#/breed?p=aaaaaaaa&t=target') // prettier-ignore
  })
})

describe('stockPals', () => {
  it('gives every pal once, whichever lists it was filed under', () => {
    const m = { instanceId: '1' } as Pal
    const f = { instanceId: '2' } as Pal
    const u = { instanceId: '3' } as Pal
    const stock = {
      bySpecies: new Map([
        // `u` is filed under male as well, as the unknown-gender switch does.
        ['aa', { male: [m, u], female: [f], unknown: [u] }],
      ]),
    } as unknown as Stock
    expect(stockPals(stock).map((p) => p.instanceId).sort()).toEqual(['1', '2', '3']) // prettier-ignore
  })
})
