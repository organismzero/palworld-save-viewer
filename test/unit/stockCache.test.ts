/**
 * The Breed view's caches: what counts as the same question.
 *
 * The property that matters is the one `usePassiveSearch` leans on — the same
 * save and settings give back the *same* stock object, and a new index never
 * does, however identical its settings.
 */

import { searchKey } from '@/views/breed/usePassiveSearch.ts'
import { describe, expect, it } from 'vitest'

import type { SaveIndex } from '@/domain/types.ts'
import {
  Recent,
  settingsKey,
  stockFor,
  type StockSettings,
} from '@/views/breed/stockCache.ts'

const A = 'aaaaaaaa'.padEnd(32, '0')
const B = 'bbbbbbbb'.padEnd(32, '0')
const C = 'cccccccc'.padEnd(32, '0')

/** An index with nobody in it: enough for `buildStock` to run. */
const emptyIndex = () =>
  ({
    palsByOwner: new Map(),
    playerByUid: new Map(),
    guildById: new Map(),
    palsByGuild: new Map(),
    pals: [],
    players: [],
  }) as unknown as SaveIndex

const settings = (over: Partial<StockSettings> = {}): StockSettings => ({
  ownerUid: A,
  assumeUnknownGender: false,
  includeGuild: false,
  includeBase: false,
  includeMembers: [],
  ...over,
})

describe('Recent', () => {
  it('forgets the least recently used entry past its cap', () => {
    const r = new Recent<string, number>(2)
    r.set('a', 1)
    r.set('b', 2)
    r.set('c', 3)
    expect(r.peek('a')).toBeUndefined()
    expect(r.peek('b')).toBe(2)
    expect(r.peek('c')).toBe(3)
    expect(r.size).toBe(2)
  })

  it('counts a get as a use, and a peek as nothing', () => {
    const r = new Recent<string, number>(2)
    r.set('a', 1)
    r.set('b', 2)
    r.peek('a')
    r.set('c', 3)
    // `a` was only peeked at, so it was still the stalest.
    expect(r.peek('a')).toBeUndefined()

    r.get('b')
    r.set('d', 4)
    // `b` was used, so `c` went instead.
    expect(r.peek('b')).toBe(2)
    expect(r.peek('c')).toBeUndefined()
  })

  it('replaces a key without growing', () => {
    const r = new Recent<string, number>(2)
    r.set('a', 1)
    r.set('a', 2)
    expect(r.size).toBe(1)
    expect(r.peek('a')).toBe(2)
  })
})

describe('settingsKey', () => {
  it('differs for anything that changes the stock', () => {
    const base = settingsKey(settings())
    for (const over of [
      { ownerUid: B },
      { ownerUid: undefined },
      { assumeUnknownGender: true },
      { includeGuild: true },
      { includeBase: true },
      { includeMembers: [B] },
    ] satisfies Partial<StockSettings>[]) {
      expect(settingsKey(settings(over))).not.toBe(base)
    }
  })

  it('does not care what order guildmates were ticked in', () => {
    expect(settingsKey(settings({ includeMembers: [B, C] }))).toBe(
      settingsKey(settings({ includeMembers: [C, B] })),
    )
  })
})

describe('stockFor', () => {
  it('returns the same stock for the same save and settings', () => {
    const index = emptyIndex()
    const first = stockFor(index, undefined, settings())
    // A fresh settings object and a fresh members array, as every render has.
    expect(stockFor(index, undefined, settings({ includeMembers: [] }))).toBe(
      first,
    )
  })

  it('returns a different stock for different settings', () => {
    const index = emptyIndex()
    expect(stockFor(index, undefined, settings())).not.toBe(
      stockFor(index, undefined, settings({ includeBase: true })),
    )
  })

  it('never reuses a stock across indexes, so a merged save is re-read', () => {
    // The same settings against a new index: what adding a player file to an
    // open save produces, and the case a settings-only key would get wrong.
    const before = stockFor(emptyIndex(), undefined, settings())
    const after = stockFor(emptyIndex(), undefined, settings())
    expect(after).not.toBe(before)
  })

  it('comes back to an earlier stock after looking at others', () => {
    const index = emptyIndex()
    const first = stockFor(index, undefined, settings())
    stockFor(index, undefined, settings({ ownerUid: B }))
    stockFor(index, undefined, settings({ includeGuild: true }))
    expect(stockFor(index, undefined, settings())).toBe(first)
  })
})

describe('searchKey', () => {
  it('is the same for one set of passives however it was picked', () => {
    expect(searchKey(['Legend', 'artisan', 'legend'])).toEqual(['artisan', 'legend']) // prettier-ignore
    expect(searchKey(['artisan', 'legend'])).toEqual(searchKey(['legend', 'artisan'])) // prettier-ignore
  })
})
