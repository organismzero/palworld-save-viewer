/**
 * What is inside an egg: reading it, saying it, and not saying it unasked.
 *
 * Invented records in the shape the archive reader hands over.
 */

import { describe, expect, it } from 'vitest'

import { useEggReveal } from '@/components/cards/eggReveal.ts'
import { eggText, itemText } from '@/domain/itemText.ts'
import { readDynamicItems } from '@/parse/worker/readers/containers.ts'
import { Warnings } from '@/parse/warnings.ts'

const id = (n: number) =>
  `${String(n).padStart(8, '0')}-0000-0000-0000-000000000000`

/** A dynamic item entry, as `DynamicItemSaveData` holds them. */
function entry(n: number, raw: Record<string, unknown>) {
  return {
    RawData: {
      value: {
        id: { local_id_in_created_world: id(n), static_id: 'x' },
        ...raw,
      },
    },
  }
}
const read = (...entries: unknown[]) =>
  readDynamicItems({ value: { values: entries } }, new Warnings())

const BRED = {
  type: 'egg',
  character_id: 'BlackGriffon',
  object: {
    SaveParameter: {
      value: {
        CharacterID: { value: 'BlackGriffon' },
        Gender: { value: { value: 'EPalGenderType::Female' } },
        Talent_HP: { value: { value: 34 } },
        Talent_Shot: { value: { value: 83 } },
        Talent_Defense: { value: { value: 63 } },
        PassiveSkillList: { value: { values: ['Legend', 'Nocturnal'] } },
      },
    },
  },
}

describe('reading an egg', () => {
  it('reads everything a bred egg has decided', () => {
    expect(read(entry(1, BRED))[0]!.egg).toEqual({
      characterId: 'BlackGriffon',
      isBoss: false,
      rolled: true,
      gender: 'Female',
      ivHp: 34,
      ivAttack: 83,
      ivDefense: 63,
      passives: ['Legend', 'Nocturnal'],
    })
  })

  it('reads a found egg as its species and nothing else', () => {
    // No parameters at all: the rest is rolled when it hatches.
    const [item] = read(entry(1, { type: 'egg', character_id: 'Manticore', object: {} })) // prettier-ignore
    expect(item!.egg).toMatchObject({
      characterId: 'Manticore',
      rolled: false,
      passives: [],
    })
    expect(item!.egg!.gender).toBeUndefined()
    expect(item!.egg!.ivHp).toBeUndefined()
  })

  it('reads an alpha in the egg as its species, flagged', () => {
    const [item] = read(entry(1, { type: 'egg', character_id: 'BOSS_ThunderDog', object: {} })) // prettier-ignore
    expect(item!.egg).toMatchObject({ characterId: 'ThunderDog', isBoss: true })
  })

  it('gives a weapon no contents, and an egg naming nothing none either', () => {
    const items = read(
      entry(1, { type: 'weapon', durability: 10, passive_skill_list: [] }),
      entry(2, { type: 'egg', character_id: 'None', object: {} }),
    )
    expect(items.map((i) => i.egg)).toEqual([undefined, undefined])
  })
})

describe('saying what is in an egg', () => {
  const egg = read(entry(1, BRED))[0]!.egg!

  it('puts a bred egg in one line', () => {
    expect(eggText(egg, 'Shadowbeak', ['Legend', 'Nocturnal'])).toBe(
      'inside: Shadowbeak · female · IVs 34 HP, 83 attack, 63 defence · Legend, Nocturnal',
    )
  })

  it('says so when a found egg has only its species', () => {
    const found = read(entry(1, { type: 'egg', character_id: 'BOSS_ThunderDog', object: {} }))[0]!.egg! // prettier-ignore
    expect(eggText(found, 'Rayhound', [])).toBe(
      'inside: alpha Rayhound · the rest is rolled when it hatches',
    )
  })

  it('places whatever line it is given after the item’s own', () => {
    expect(itemText({ name: 'Dark Egg', inside: 'contents hidden' })).toBe(
      'Dark Egg\ncontents hidden',
    )
    // And says nothing about contents when given nothing.
    expect(itemText({ name: 'Dark Egg' })).toBe('Dark Egg')
  })
})

describe('opening an egg up', () => {
  it('shows one egg at a time, and hides it again', () => {
    const { toggle } = useEggReveal.getState()
    const shown = () => [...useEggReveal.getState().revealed]
    expect(shown()).toEqual([])

    toggle('a')
    expect(shown()).toEqual(['a'])
    // The egg beside it is still shut.
    expect(useEggReveal.getState().revealed.has('b')).toBe(false)

    toggle('b')
    toggle('a')
    expect(shown()).toEqual(['b'])
  })
})
