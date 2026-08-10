/**
 * The pure half of deep links.
 *
 * These four functions are where the silent bugs live: a hash that round-trips
 * wrong does not throw, it just quietly shows the wrong thing, and an
 * over-eager escape turns a readable URL into `%2C` soup without failing any
 * test that only checks it parses.
 */

import { describe, expect, it } from 'vitest'

import {
  bool,
  encodeList,
  list,
  num,
  parseHash,
  resolveShortId,
  serialiseParams,
  shortId,
  str,
} from '@/app/viewParams.ts'

describe('parseHash', () => {
  it('reads a bare view', () => {
    expect(parseHash('#/pals')).toEqual({ view: 'pals', qs: '' })
  })

  it('splits a view from its params', () => {
    expect(parseHash('#/pals?q=lamball&el=fire')).toEqual({
      view: 'pals',
      qs: 'q=lamball&el=fire',
    })
  })

  it('copes with the leading slash being absent', () => {
    expect(parseHash('#pals')).toEqual({ view: 'pals', qs: '' })
  })

  it('returns nothing for an empty hash rather than an empty view', () => {
    expect(parseHash('')).toEqual({ view: undefined, qs: '' })
    expect(parseHash('#')).toEqual({ view: undefined, qs: '' })
    expect(parseHash('#/')).toEqual({ view: undefined, qs: '' })
  })

  it('keeps a trailing question mark harmless', () => {
    expect(parseHash('#/pals?')).toEqual({ view: 'pals', qs: '' })
  })
})

describe('serialiseParams', () => {
  it('sorts keys, so unchanged state produces an unchanged URL', () => {
    // Without this an object built in a different order rewrites the hash and
    // burns a history entry for nothing.
    expect(serialiseParams({ q: 'a', el: 'fire', iv: '80' })).toBe(
      'el=fire&iv=80&q=a',
    )
  })

  it('drops empty values rather than writing bare keys', () => {
    expect(serialiseParams({ q: '', el: 'fire' })).toBe('el=fire')
  })

  it('leaves commas alone, which is the whole point', () => {
    // URLSearchParams would give el=fire%2Cwater and make the URL unreadable.
    expect(serialiseParams({ el: 'fire,water' })).toBe('el=fire,water')
  })

  it('escapes only what would break a fragment', () => {
    expect(serialiseParams({ q: 'a&b' })).toBe('q=a%26b')
    expect(serialiseParams({ q: 'a=b' })).toBe('q=a%3Db')
    expect(serialiseParams({ q: 'a#b' })).toBe('q=a%23b')
    expect(serialiseParams({ q: 'a b' })).toBe('q=a%20b')
    expect(serialiseParams({ q: '100%' })).toBe('q=100%25')
  })

  it('round-trips an escaped value through URLSearchParams', () => {
    const qs = serialiseParams({ q: 'Ace & Co = 100%' })
    expect(new URLSearchParams(qs).get('q')).toBe('Ace & Co = 100%')
  })

  it('round-trips unicode', () => {
    const qs = serialiseParams({ q: 'ケルバイダ' })
    expect(new URLSearchParams(qs).get('q')).toBe('ケルバイダ')
  })

  it('is empty for empty input', () => {
    expect(serialiseParams({})).toBe('')
  })
})

describe('shortId', () => {
  it('takes the first eight hex characters, hyphens or not', () => {
    expect(shortId('a3f21b09c4d5e6f7a8b9c0d1e2f30405')).toBe('a3f21b09')
    expect(shortId('a3f21b09-c4d5-e6f7-a8b9-c0d1e2f30405')).toBe('a3f21b09')
  })
})

describe('resolveShortId', () => {
  const IDS = [
    'a3f21b09c4d5e6f7a8b9c0d1e2f30405',
    'b1112233445566778899aabbccddeeff',
    'a3f2ffff445566778899aabbccddeeff',
  ]

  it('resolves an unambiguous prefix', () => {
    expect(resolveShortId('b1112233', IDS)).toBe(IDS[1])
  })

  it('resolves nothing when the prefix is ambiguous', () => {
    // Two ids start with a3f2. Picking the first would select the wrong pal,
    // which is a worse failure than selecting none.
    expect(resolveShortId('a3f2', IDS)).toBeUndefined()
  })

  it('is case-insensitive both ways', () => {
    expect(resolveShortId('A3F21B09', IDS)).toBe(IDS[0])
  })

  it('resolves nothing for an unknown prefix', () => {
    expect(resolveShortId('deadbeef', IDS)).toBeUndefined()
  })

  it('resolves nothing for an absent param', () => {
    expect(resolveShortId(undefined, IDS)).toBeUndefined()
    expect(resolveShortId('', IDS)).toBeUndefined()
  })

  it('round-trips a real id through shortId', () => {
    expect(resolveShortId(shortId(IDS[1]!), IDS)).toBe(IDS[1])
  })
})

describe('codec helpers', () => {
  const raw = (s: string) => new URLSearchParams(s)

  it('falls back rather than throwing on malformed input', () => {
    // An unparseable param must leave the view at its default, not crash it.
    expect(num(raw('lvl=banana'), 'lvl', 1)).toBe(1)
    expect(num(raw(''), 'lvl', 1)).toBe(1)
    expect(num(raw('lvl=20'), 'lvl', 1)).toBe(20)
  })

  it('reads booleans as 1, absent as the default', () => {
    expect(bool(raw('all=1'), 'all', false)).toBe(true)
    expect(bool(raw('all=0'), 'all', true)).toBe(false)
    expect(bool(raw(''), 'all', true)).toBe(true)
  })

  it('reads strings with a fallback', () => {
    expect(str(raw('q=lamball'), 'q', '')).toBe('lamball')
    expect(str(raw(''), 'q', '')).toBe('')
  })

  it('reads and writes comma lists, sorted on the way out', () => {
    expect(list(raw('el=fire,water'), 'el')).toEqual(['fire', 'water'])
    expect(list(raw(''), 'el')).toEqual([])
    expect(list(raw('el='), 'el')).toEqual([])
    // Sorted, so the same selection always yields the same URL.
    expect(encodeList(new Set(['water', 'fire']))).toBe('fire,water')
  })

  it('ignores params it does not know about', () => {
    const p = raw('q=x&bogus=1&alsobogus')
    expect(str(p, 'q', '')).toBe('x')
    expect(num(p, 'lvl', 1)).toBe(1)
  })
})
