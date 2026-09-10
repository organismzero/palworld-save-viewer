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

function codecFor(uids: string[], palOwners: string[] = uids) {
  return breedCodec({
    playerByUid: new Map(uids.map((u) => [u, {}])),
    palsByOwner: new Map(palOwners.map((u) => [u, []])),
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
      includeBase: false,
      includeMembers: [],
      passives: ['legend', 'swift'],
      noSpares: true,
    }
    expect(roundTrip(value)).toEqual(value)
  })

  it('will not carry “nothing else” with nothing to be exact about', () => {
    // A bare `pvo=1` would tick a box that constrains nothing, so it does not
    // travel on its own.
    expect(
      codec.encode({ ...BREED_DEFAULTS, noSpares: true }, BREED_DEFAULTS).pvo,
    ).toBeUndefined()
    expect(
      codec.encode(
        { ...BREED_DEFAULTS, noSpares: true, passives: ['legend'] },
        BREED_DEFAULTS,
      ).pvo,
    ).toBe('1')
  })

  it('round-trips a partial pool', () => {
    const value = {
      ...BREED_DEFAULTS,
      includeGuild: false,
      includeBase: true,
      includeMembers: [B],
    }
    expect(roundTrip(value)).toEqual(value)
  })

  it('keeps `gp` meaning everything, and stays quiet when it is set', () => {
    // An old link says `gp=1` and must keep meaning the whole guild — including
    // members who joined after it was written. So the finer params are not
    // emitted alongside it, and are not consulted when it is present.
    const all = codec.encode(
      { ...BREED_DEFAULTS, includeGuild: true, includeBase: true, includeMembers: [B] }, // prettier-ignore
      BREED_DEFAULTS,
    )
    expect(all.gp).toBe('1')
    expect(all.gb).toBeUndefined()
    expect(all.gm).toBeUndefined()
  })

  it('resolves a member who owns pals but has no player record', () => {
    // A departed guildmate: their pals keep their owner uid long after the
    // player record is gone, and those palboxes are exactly the ones worth
    // pooling. Resolving against the player table alone dropped them, so a link
    // naming one came back unticked and the stock quietly shrank.
    const departed = codecFor([A], [A, B])
    expect(
      departed.decode(new URLSearchParams('gm=bbbbbbbb'), BREED_DEFAULTS)
        .includeMembers,
    ).toEqual([B])
  })

  it('drops a member uid this world does not know', () => {
    // A link from another save must not pool the wrong person's palbox.
    const decoded = codec.decode(
      new URLSearchParams('gm=deadbeef'),
      BREED_DEFAULTS,
    )
    expect(decoded.includeMembers).toEqual([])
  })

  it('sorts the passives, so one selection is one link', () => {
    // Two players who picked the same two passives in opposite orders should be
    // able to compare links, not wonder why they differ.
    expect(
      codec.encode(
        { ...BREED_DEFAULTS, passives: ['swift', 'legend'] },
        BREED_DEFAULTS,
      ).pv,
    ).toBe('legend,swift')
  })

  it('decodes passives in the order it encodes them', () => {
    // The domain keeps only the first four — a pal has four slots — so if
    // decode and encode disagreed on the order, a five-passive link would plan
    // for one set now and a different set after a reload.
    const decoded = codec.decode(
      new URLSearchParams('pv=swift,legend,musclehead'),
      BREED_DEFAULTS,
    ).passives
    expect(decoded).toEqual(['legend', 'musclehead', 'swift'])
    expect(
      codec.encode({ ...BREED_DEFAULTS, passives: decoded }, BREED_DEFAULTS).pv,
    ).toBe('legend,musclehead,swift')
  })

  it('dedupes passives, so one chip is one passive', () => {
    // The domain ignores a repeat, but the picker draws one chip per entry —
    // four identical chips on four duplicate React keys, announcing that the
    // four-slot limit had been reached.
    expect(
      codec.decode(new URLSearchParams('pv=legend,Legend,LEGEND'), BREED_DEFAULTS)
        .passives,
    ).toEqual(['legend'])
  })

  it('lowercases passives and survives an unknown one', () => {
    // Validated late, like the target: reference data has not loaded when a
    // cold deep link is decoded.
    expect(
      codec.decode(new URLSearchParams('pv=Legend,notathing'), BREED_DEFAULTS)
        .passives,
    ).toEqual(['legend', 'notathing'])
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
