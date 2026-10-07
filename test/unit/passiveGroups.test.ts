import { describe, expect, it } from 'vitest'

import { passiveGroups } from '@/domain/passiveGroups.ts'
import type { PassiveEffect } from '@/refdata/refdata.ts'

const fx = (type: string, value = 10): PassiveEffect => ({
  type,
  value,
  target: 'self',
})

const groups = (...effects: PassiveEffect[]) => [...passiveGroups({ effects })]

describe('passiveGroups', () => {
  it('reads one group off one effect', () => {
    expect(groups(fx('CraftSpeed'))).toEqual(['work'])
    expect(groups(fx('ShotAttack'))).toEqual(['combat'])
    expect(groups(fx('MoveSpeed'))).toEqual(['travel'])
  })

  it('puts a passive in every group one of its effects falls in', () => {
    // Legend: attack, defence, movement speed.
    expect(
      groups(fx('ShotAttack'), fx('Defense'), fx('MoveSpeed')).sort(),
    ).toEqual(['combat', 'travel'])
    // Musclehead: attack up, work speed down. Still a work passive — just one
    // to keep off a base.
    expect(groups(fx('ShotAttack', 30), fx('CraftSpeed', -50)).sort()).toEqual([
      'combat',
      'work',
    ])
  })

  it('treats every element boost and resistance as combat', () => {
    expect(groups(fx('ElementBoost_Fire'))).toEqual(['combat'])
    expect(groups(fx('ElementResist_Dragon'))).toEqual(['combat'])
  })

  it('counts a switch, whose value is zero, like any other effect', () => {
    expect(groups(fx('Nocturnal', 0))).toEqual(['work'])
  })

  it('falls back to other only when nothing matched', () => {
    expect(groups(fx('ShopSellPrice_Money_Increase'))).toEqual(['other'])
    expect(groups()).toEqual(['other'])
    expect([...passiveGroups({})]).toEqual(['other'])
    // Decay immunity alone is miscellaneous; beside an attack bonus it is not
    // a reason to list the passive twice.
    expect(groups(fx('WorldTreeDecayImmunity', 0))).toEqual(['other'])
    expect(
      groups(fx('ShotAttack', 50), fx('WorldTreeDecayImmunity', 0)),
    ).toEqual(['combat'])
  })
})
