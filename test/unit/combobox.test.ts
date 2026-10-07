/** The combobox's key handling, which is the part with rules. */

import { describe, expect, it } from 'vitest'

import { comboboxKey, type ComboboxState } from '@/components/combobox.ts'

const at = (active: number, count = 3, open = true): ComboboxState => ({
  active,
  count,
  open,
})

describe('comboboxKey', () => {
  it('walks down from nothing to the first option, and wraps', () => {
    expect(comboboxKey(at(-1), 'ArrowDown')).toEqual({
      kind: 'move',
      active: 0,
    })
    expect(comboboxKey(at(1), 'ArrowDown')).toEqual({ kind: 'move', active: 2 })
    expect(comboboxKey(at(2), 'ArrowDown')).toEqual({ kind: 'move', active: 0 })
  })

  it('walks up from nothing to the last option, and wraps', () => {
    expect(comboboxKey(at(-1), 'ArrowUp')).toEqual({ kind: 'move', active: 2 })
    expect(comboboxKey(at(0), 'ArrowUp')).toEqual({ kind: 'move', active: 2 })
    expect(comboboxKey(at(2), 'ArrowUp')).toEqual({ kind: 'move', active: 1 })
  })

  it('picks the highlighted option, or the best match when none is', () => {
    expect(comboboxKey(at(1), 'Enter')).toEqual({ kind: 'pick', index: 1 })
    expect(comboboxKey(at(-1), 'Enter')).toEqual({ kind: 'pick', index: 0 })
  })

  it('closes on Escape even with nothing to pick', () => {
    expect(comboboxKey(at(-1, 0), 'Escape')).toEqual({ kind: 'close' })
  })

  it('has nothing to move through or pick in an empty list', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) {
      expect(comboboxKey(at(-1, 0), key)).toBeUndefined()
    }
  })

  it('leaves every key alone while closed, Escape included', () => {
    // So Escape reaches whatever is open behind the field.
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      expect(comboboxKey(at(-1, 3, false), key)).toBeUndefined()
    }
  })

  it('leaves the caret keys and ordinary typing to the text field', () => {
    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'a', 'Tab']) {
      expect(comboboxKey(at(1), key)).toBeUndefined()
    }
  })
})
