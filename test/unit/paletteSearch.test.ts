/** The command palette's ranking and its recent list. */

import { describe, expect, it } from 'vitest'

import { matchRank, pushRecent, rankPals } from '@/app/paletteSearch.ts'
import type { Pal } from '@/domain/types.ts'

describe('matchRank', () => {
  it('orders whole name, start, start of a word, anywhere', () => {
    expect(matchRank('Anubis', 'anubis')).toBe(0)
    expect(matchRank('Anubis', 'anu')).toBe(1)
    expect(matchRank('Pebble Ignis', 'ig')).toBe(2)
    expect(matchRank('Digtoise', 'ig')).toBe(3)
  })

  it('is nothing when the text does not contain the query', () => {
    expect(matchRank('Anubis', 'lam')).toBeUndefined()
  })
})

describe('rankPals', () => {
  let n = 0
  const pal = (characterId: string, level: number, nickname?: string) =>
    ({ instanceId: `${++n}`.padStart(32, '0'), characterId, level, nickname }) as Pal // prettier-ignore
  const names: Record<string, string> = { SheepBall: 'Lamball', Anubis: 'Anubis', Mole: 'Digtoise' } // prettier-ignore
  const nameOf = (id: string) => names[id] ?? id

  it('puts the best match first, then the highest level', () => {
    const low = pal('Anubis', 3)
    const high = pal('Anubis', 55)
    const nick = pal('SheepBall', 60, 'Anubis Jr')
    const got = rankPals([low, nick, high], 'anubis', nameOf, 6)
    // Two exact species matches by level, then the nickname that only starts with it.
    expect(got).toEqual([high, low, nick])
  })

  it('takes the better of a nickname and a species match', () => {
    const named = pal('Mole', 10, 'Lamb')
    expect(rankPals([named, pal('SheepBall', 99)], 'lamb', nameOf, 1)).toEqual([named]) // prettier-ignore
  })

  it('still finds a pal by its asset id, behind any real name', () => {
    const sheep = pal('SheepBall', 50)
    const other = pal('Mole', 1, 'Sheepish')
    expect(rankPals([sheep, other], 'sheep', nameOf, 6)).toEqual([other, sheep])
  })

  it('stops at the limit and leaves out what does not match', () => {
    const pals = [pal('Anubis', 1), pal('Anubis', 2), pal('Mole', 3)]
    expect(rankPals(pals, 'anubis', nameOf, 1)).toHaveLength(1)
    expect(rankPals(pals, 'zzz', nameOf, 6)).toEqual([])
  })
})

describe('pushRecent', () => {
  const r = (key: string) => ({ key })

  it('puts the newest first and keeps eight', () => {
    let list: { key: string }[] = []
    for (let i = 1; i <= 10; i++) list = pushRecent(list, r(`k${i}`))
    expect(list).toHaveLength(8)
    expect(list[0]!.key).toBe('k10')
    expect(list.at(-1)!.key).toBe('k3')
  })

  it('moves a repeat to the front without listing it twice', () => {
    const list = pushRecent([r('a'), r('b'), r('c')], r('c'))
    expect(list.map((x) => x.key)).toEqual(['c', 'a', 'b'])
  })
})
