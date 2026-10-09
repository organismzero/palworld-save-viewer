/** The borrow list a pooled breeding plan produces. Synthetic ids. */

import { describe, expect, it } from 'vitest'

import type { BorrowedPal } from '@/domain/breeding.ts'
import type { Pal } from '@/domain/types.ts'
import {
  borrowGroups,
  borrowSummary,
  borrowText,
} from '@/views/breed/ownerText.ts'

const ANN = 'a'.repeat(32)
const BOB = 'b'.repeat(32)

let n = 0
function lent(
  species: string,
  ownerUid: string | undefined,
  over: Partial<Pal> = {},
): BorrowedPal {
  // prettier-ignore
  n++
  return {
    species,
    ownerUid,
    pal: { instanceId: `${n}`.padStart(32, '0'), level: 10, gender: 'Female', ...over } as Pal, // prettier-ignore
  }
}

const borrowed = [
  lent('worker_pal', undefined, { gender: undefined }),
  lent('fox', ANN),
  lent('moss', BOB, { gender: 'Male', level: 22 }),
  lent('owl', BOB, { nickname: 'Hoot' }),
  lent('eel', BOB),
]

const owner = (uid: string | undefined) => (uid === ANN ? 'Ann' : uid === BOB ? 'Bob' : 'nobody') // prettier-ignore
const species = (id: string) => id.toUpperCase()

describe('borrowGroups', () => {
  it('is one group per owner, most to lend first and the base last', () => {
    const groups = borrowGroups(borrowed)
    expect(groups.map((g) => [g.ownerUid, g.pals.length])).toEqual([
      [BOB, 3],
      [ANN, 1],
      [undefined, 1],
    ])
  })
})

describe('borrowText', () => {
  it('writes one line per owner that can be sent as it is', () => {
    expect(borrowText(borrowed, owner, species, 'Target').split('\n')).toEqual([
      'To breed Target:',
      'Ask Bob for MOSS ♂ lv 22, Hoot (OWL) ♀ lv 10 and EEL ♀ lv 10.',
      'Ask Ann for FOX ♀ lv 10.',
      'Fetch from the base: WORKER_PAL lv 10.',
    ])
  })

  it('joins two with "and", and leaves the heading off when unnamed', () => {
    const two = [lent('fox', ANN), lent('moss', ANN, { gender: 'Male' })]
    expect(borrowText(two, owner, species)).toBe(
      'Ask Ann for FOX ♀ lv 10 and MOSS ♂ lv 10.',
    )
  })

  it('is empty for a plan that borrows nothing', () => {
    expect(borrowText([], owner, species)).toBe('')
  })
})

describe('borrowSummary', () => {
  it('counts base workers in the plural when there is more than one', () => {
    const two = [lent('fox', ANN), lent('a', undefined), lent('b', undefined)]
    expect(borrowSummary(two)).toBe(
      'uses 3 pals you do not own — 1 from 1 guildmate, 2 base workers',
    )
    expect(borrowSummary(two.slice(0, 2))).toBe(
      'uses 2 pals you do not own — 1 from 1 guildmate, 1 base worker',
    )
  })

  it('keeps the two one-sided wordings', () => {
    expect(borrowSummary([lent('a', undefined)])).toBe(
      'uses 1 base worker nobody owns',
    )
    expect(borrowSummary([lent('fox', ANN), lent('moss', BOB)])).toBe(
      'uses 2 pals from 2 guildmates',
    )
  })
})
