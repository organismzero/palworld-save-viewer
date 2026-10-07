/** Ordering for sortable tables. */

import { describe, expect, it } from 'vitest'

import { nextSort, sortOrder, type SortKey } from '@/lib/sortRows.ts'

const keys: SortKey[][] = [
  ['bob', 3],
  ['ann', undefined],
  ['cy', 10],
  ['dee', 3],
]

describe('sortOrder', () => {
  it('leaves the rows as given with no sort', () => {
    expect(sortOrder(keys, undefined)).toEqual([0, 1, 2, 3])
  })

  it('compares numbers as numbers and text as text', () => {
    expect(sortOrder(keys, { column: 0, desc: false })).toEqual([1, 0, 2, 3])
    // 10 after 3, which a text comparison would get backwards.
    expect(sortOrder(keys, { column: 1, desc: false })).toEqual([0, 3, 2, 1])
  })

  it('keeps a row with no value last whichever way the column is turned', () => {
    expect(sortOrder(keys, { column: 1, desc: true })).toEqual([2, 0, 3, 1])
    expect(sortOrder(keys, { column: 1, desc: false }).at(-1)).toBe(1)
  })

  it('keeps ties in the order given', () => {
    expect(sortOrder(keys, { column: 1, desc: true }).slice(1, 3)).toEqual([0, 3]) // prettier-ignore
  })
})

describe('nextSort', () => {
  it('starts a count biggest first and a name from A', () => {
    expect(nextSort(keys, undefined, 1)).toEqual({ column: 1, desc: true })
    expect(nextSort(keys, undefined, 0)).toEqual({ column: 0, desc: false })
  })

  it('turns the same column over and starts a new one afresh', () => {
    expect(nextSort(keys, { column: 1, desc: true }, 1)).toEqual({ column: 1, desc: false }) // prettier-ignore
    expect(nextSort(keys, { column: 1, desc: false }, 0)).toEqual({ column: 0, desc: false }) // prettier-ignore
  })
})
