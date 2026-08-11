/**
 * The Breed view's hash codec.
 *
 * The interesting case is the cold deep link: `decode` runs before reference
 * data has loaded, so anything validated against reference data here would
 * reject every shared URL. That is the trap these tests exist to hold shut.
 */

import { describe, expect, it } from 'vitest'

import { serialiseParams } from '@/app/viewParams.ts'
import type { SaveIndex } from '@/domain/types.ts'
import { BREED_DEFAULTS, breedCodec } from '@/views/breed/params.ts'

const A = 'aaaaaaaa'.padEnd(32, '0')
const B = 'bbbbbbbb'.padEnd(32, '0')
/** Shares `A`'s first eight characters, so the prefix is ambiguous. */
const A2 = `aaaaaaaa${'1'.padEnd(24, '1')}`

function codecFor(uids: string[]) {
  return breedCodec({
    playerByUid: new Map(uids.map((u) => [u, {}])),
  } as unknown as SaveIndex)
}

const codec = codecFor([A, B])

function roundTrip(value: Parameters<typeof codec.encode>[0]) {
  const qs = serialiseParams(codec.encode(value, BREED_DEFAULTS))
  return codec.decode(new URLSearchParams(qs), BREED_DEFAULTS)
}

describe('breedCodec', () => {
  it('round-trips everything it carries', () => {
    const value = {
      playerUid: A,
      target: 'anubis',
      query: 'anu',
      route: { a: 'penguin', b: 'kelpie' },
      assumeUnknownGender: true,
      includeGuild: true,
    }
    expect(roundTrip(value)).toEqual(value)
  })

  it('reads the guild flag as 1', () => {
    // `gp`, not a bare `g` — that would read like a guild id.
    expect(
      codec.decode(new URLSearchParams('gp=1'), BREED_DEFAULTS).includeGuild,
    ).toBe(true)
    expect(
      codec.decode(new URLSearchParams('gp=0'), BREED_DEFAULTS).includeGuild,
    ).toBe(false)
    expect(
      codec.decode(new URLSearchParams(''), BREED_DEFAULTS).includeGuild,
    ).toBe(false)
  })

  it('emits nothing for an untouched view', () => {
    expect(codec.encode(BREED_DEFAULTS, BREED_DEFAULTS)).toEqual({})
  })

  it('leaves a fallback player out of the URL', () => {
    // Only a choice the user made belongs in a link they might send.
    const encoded = codec.encode(
      { ...BREED_DEFAULTS, target: 'anubis' },
      BREED_DEFAULTS,
    )
    expect(encoded.p).toBeUndefined()
    expect(encoded.t).toBe('anubis')
  })

  it('keeps a target the reference data has never heard of', () => {
    // The whole point: refdata is not loaded when this runs, so validating here
    // would drop every cold deep link.
    const out = codec.decode(
      new URLSearchParams('t=notaspecies'),
      BREED_DEFAULTS,
    )
    expect(out.target).toBe('notaspecies')
  })

  it('lowercases the target', () => {
    const out = codec.decode(new URLSearchParams('t=Anubis'), BREED_DEFAULTS)
    expect(out.target).toBe('anubis')
  })

  it('resolves a player by short id', () => {
    const out = codec.decode(new URLSearchParams('p=bbbbbbbb'), BREED_DEFAULTS)
    expect(out.playerUid).toBe(B)
  })

  it('resolves an ambiguous prefix to nothing rather than a guess', () => {
    const ambiguous = codecFor([A, A2])
    const out = ambiguous.decode(
      new URLSearchParams('p=aaaaaaaa'),
      BREED_DEFAULTS,
    )
    expect(out.playerUid).toBeUndefined()
  })

  it('drops a player this world does not have', () => {
    const out = codec.decode(new URLSearchParams('p=cccccccc'), BREED_DEFAULTS)
    expect(out.playerUid).toBeUndefined()
  })

  it('reads a route as an unescaped pair', () => {
    // `serialiseParams` leaves commas alone on purpose, which is what makes
    // `r=penguin,kelpie` readable in the address bar.
    const out = codec.decode(
      new URLSearchParams('r=penguin,kelpie'),
      BREED_DEFAULTS,
    )
    expect(out.route).toEqual({ a: 'penguin', b: 'kelpie' })
  })

  it.each(['r=penguin', 'r=a,b,c', 'r=,kelpie', 'r=penguin,', 'r='])(
    'ignores a malformed route (%s)',
    (qs) => {
      expect(
        codec.decode(new URLSearchParams(qs), BREED_DEFAULTS).route,
      ).toBeUndefined()
    },
  )

  it('reads the gender flag as 1', () => {
    expect(
      codec.decode(new URLSearchParams('ug=1'), BREED_DEFAULTS)
        .assumeUnknownGender,
    ).toBe(true)
    expect(
      codec.decode(new URLSearchParams('ug=0'), BREED_DEFAULTS)
        .assumeUnknownGender,
    ).toBe(false)
    expect(
      codec.decode(new URLSearchParams(''), BREED_DEFAULTS).assumeUnknownGender,
    ).toBe(false)
  })

  it('survives a query with characters that need escaping', () => {
    const value = { ...BREED_DEFAULTS, query: 'a&b=c d' }
    expect(roundTrip(value).query).toBe('a&b=c d')
  })
})
