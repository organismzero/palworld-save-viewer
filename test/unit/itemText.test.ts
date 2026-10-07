/**
 * Item text: the screen-reader twin of the item hover card.
 *
 * The degraded case matters as much as the full one — with no reference data
 * the name is a raw asset id and nothing else is known, and the text still has
 * to say what the save says.
 */

import { describe, expect, it } from 'vitest'

import { itemText } from '@/domain/itemText.ts'
import type { ItemInfo } from '@/refdata/refdata.ts'

const SWORD: ItemInfo = {
  name: 'Sword',
  rarity: 2,
  typeA: 'Weapon',
  typeB: 'Melee',
  weight: 5,
  maxStack: 1,
  description: 'A plain blade.\r\nSharp.',
  durability: 400,
}

describe('itemText', () => {
  it('says everything a full record knows, in reading order', () => {
    const text = itemText({
      name: 'Sword',
      info: SWORD,
      count: 1,
      dynamic: {
        localId: 'a'.repeat(32),
        durability: 123.6,
        ammo: 0,
        passives: ['raw_id'],
      },
      passiveNames: ['Sharp Edge'],
    })
    expect(text).toBe(
      [
        'Sword ×1',
        'Weapon · Melee',
        '5 wt each',
        'durability 124 / 400',
        '+ Sharp Edge',
        '',
        // Carriage returns stripped; the description's own line break kept.
        'A plain blade.\nSharp.',
      ].join('\n'),
    )
  })

  it('stays useful with no reference data at all', () => {
    const text = itemText({
      name: 'PalSphere_Mega',
      count: 1200,
      dynamic: { localId: 'b'.repeat(32), passives: ['PAL_ALLAttack_up1'] },
    })
    expect(text.split('\n')).toEqual([
      'PalSphere_Mega ×1,200',
      '+ PAL_ALLAttack_up1',
    ])
  })

  it('says where a merged row is spread across', () => {
    expect(itemText({ name: 'Wood', count: 50, places: 3 })).toBe(
      'Wood ×50\nin 3 places',
    )
    // One place is the ordinary case and not worth a line.
    expect(itemText({ name: 'Wood', count: 50, places: 1 })).toBe('Wood ×50')
  })

  it('leaves the count off when there is none to give', () => {
    expect(itemText({ name: 'Wood' })).toBe('Wood')
  })
})
