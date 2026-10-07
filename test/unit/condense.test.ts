/** Which duplicate to keep at the condenser. Synthetic pals. */

import { describe, expect, it } from 'vitest'

import { condensePlan } from '@/domain/condense.ts'
import type { Pal } from '@/domain/types.ts'

let n = 0
function pal(characterId: string, over: Partial<Pal> = {}): Pal {
  n++
  return {
    instanceId: `${n}`.padStart(32, '0'),
    characterId,
    level: 10,
    rank: 0,
    rankHp: 0,
    rankAttack: 0,
    rankDefence: 0,
    rankCraftSpeed: 0,
    passives: [],
    ...over,
  } as Pal
}

const rank = (id: string) => ({ good: 3, bad: -2 })[id] ?? 0
const iv = (total: number) => ({ ivHp: total, ivAttack: 0, ivDefense: 0 })

describe('condensePlan', () => {
  it('lists only species held more than once, most duplicates first', () => {
    const rows = condensePlan(
      [pal('Aa'), pal('Bb'), pal('Bb'), pal('Cc'), pal('Cc'), pal('Cc')],
      rank,
    )
    expect(rows.map((r) => [r.species, r.feed.length])).toEqual([
      ['cc', 2],
      ['bb', 1],
    ])
  })

  it('keeps the best IVs before anything else', () => {
    const born = pal('Aa', iv(90))
    const trained = pal('Aa', { ...iv(40), rank: 5, level: 60, passives: ['good'] }) // prettier-ignore
    const [row] = condensePlan([trained, born], rank)
    expect(row!.keep).toBe(born)
  })

  it('breaks an IV tie on passives, by the game’s own rank for each', () => {
    const plain = pal('Aa', iv(50))
    const good = pal('Aa', { ...iv(50), passives: ['Good'] })
    const bad = pal('Aa', { ...iv(50), passives: ['bad'] })
    const [row] = condensePlan([bad, plain, good], rank)
    expect(row!.keep).toBe(good)
    // And gives up the worst last, not first: the order is best to worst.
    expect(row!.feed).toEqual([plain, bad])
  })

  it('then on stars, then on souls', () => {
    const none = pal('Aa')
    const souls = pal('Aa', { rankAttack: 3 })
    const stars = pal('Aa', { rank: 2 })
    const [row] = condensePlan([none, souls, stars], rank)
    expect(row!.keep).toBe(stars)
    expect(row!.feed).toEqual([souls, none])
  })

  it('flags a duplicate that has stars or souls of its own', () => {
    const keep = pal('Aa', iv(90))
    const starred = pal('Aa', { rank: 3 })
    const fed = pal('Aa', { rankHp: 1 })
    const plain = pal('Aa')
    // Rank 1 is the save's "never condensed", so it is not an investment.
    const one = pal('Aa', { rank: 1 })
    const [row] = condensePlan([keep, starred, fed, plain, one], rank)
    expect(row!.invested).toEqual([starred, fed])
  })

  it('is the same whichever order the pals arrive in', () => {
    const pals = [pal('Aa'), pal('Aa'), pal('Aa')]
    const forward = condensePlan(pals, rank)[0]!
    const backward = condensePlan([...pals].reverse(), rank)[0]!
    expect(backward.keep).toBe(forward.keep)
    expect(backward.feed).toEqual(forward.feed)
  })
})
