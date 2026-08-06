import { describe, expect, it } from 'vitest'

import fixture from '../fixtures/synthetic.json' with { type: 'json' }
import * as g from '@/parse/gvas.ts'
import { ticksToDate } from '@/lib/format.ts'

const scalars = fixture.scalars as Record<string, unknown>
const structs = fixture.structs as Record<string, unknown>
const arrays = fixture.arrays as Record<string, unknown>

describe('scalars', () => {
  it('reads plain-valued properties', () => {
    expect(g.int(scalars.anInt)).toBe(42)
    expect(g.int(scalars.anInt64)).toBe(577253)
    expect(g.int(scalars.aFloat)).toBeCloseTo(96.3)
    expect(g.str(scalars.aName)).toBe('SamuraiDog')
    expect(g.str(scalars.aStr)).toBe('Fixtura')
    expect(g.str(scalars.anEmptyStr)).toBe('')
    expect(g.bool(scalars.aBoolTrue)).toBe(true)
    expect(g.bool(scalars.aBoolFalse)).toBe(false)
  })

  it('unwraps the ByteProperty double-nest', () => {
    // The whole reason this module exists: `.value` is an object here.
    expect((scalars.aByte as any).value).toEqual({ type: 'None', value: 36 })
    expect(g.byte(scalars.aByte)).toBe(36)
    expect(g.int(scalars.aByte)).toBeUndefined()
    expect(g.num(scalars.aByte)).toBe(36)
  })

  it('treats a zero byte as present, not absent', () => {
    // `?? 0` fallbacks hide a real difference between "0 souls" and "no rank".
    expect(g.byte(scalars.aByteZero)).toBe(0)
    expect(g.byte(scalars.aByteZero)).not.toBeUndefined()
  })

  it('reads enums whole and tail-only', () => {
    expect(g.enumRaw(scalars.anEnum)).toBe('EPalGenderType::Female')
    expect(g.enumTail(scalars.anEnum)).toBe('Female')
    expect(g.enumTail(scalars.anEnumNoPrefix)).toBe('Bare')
    // An enum is not a number, and must not leak through the numeric path.
    expect(g.num(scalars.anEnum)).toBeUndefined()
  })

  it('returns undefined rather than throwing on absent or null values', () => {
    expect(g.int(undefined)).toBeUndefined()
    expect(g.byte(null)).toBeUndefined()
    expect(g.str(scalars.aNullValue)).toBeUndefined()
    expect(g.bool({})).toBeUndefined()
    expect(g.enumTail(undefined)).toBeUndefined()
    expect(g.vec3(undefined)).toBeUndefined()
    expect(g.guid(undefined)).toBeUndefined()
    expect(g.hp(undefined)).toBeUndefined()
  })

  it('does not confuse types', () => {
    expect(g.str(scalars.anInt)).toBeUndefined()
    expect(g.int(scalars.aStr)).toBeUndefined()
    expect(g.bool(scalars.anInt)).toBeUndefined()
  })
})

describe('structs', () => {
  it('reads scalar-payload structs', () => {
    expect(g.guid(structs.aGuid)).toBe('fa02fa02fa024fff8ffffa02fa02fa02')
    expect(g.int(structs.aDateTime)).toBe((structs.aDateTime as any).value)
  })

  it('reads DateTime ticks despite them exceeding safe integer range', () => {
    // .NET ticks are 100ns units since year 1, so a present-day timestamp is
    // ~6.4e17 — past Number.MAX_SAFE_INTEGER (9.0e15). JSON.parse has already
    // rounded it before we ever see it, and there is nothing to be done about
    // that short of a custom parser. The residual error is a few microseconds,
    // which is irrelevant for a "caught on <date>" display, but it does mean
    // tick values must never be used as identity or compared for equality.
    const ticks = g.int(structs.aDateTime)!
    expect(ticks).toBeGreaterThan(Number.MAX_SAFE_INTEGER)

    // Despite the rounding, the value still decodes to a sane wall-clock date,
    // which is what actually matters and what proves the epoch is right.
    const date = ticksToDate(ticks)!
    expect(date.getUTCFullYear()).toBeGreaterThan(2020)
    expect(date.getUTCFullYear()).toBeLessThan(2100)
  })

  it('normalises hyphenated and uppercase GUIDs', () => {
    expect(g.guid(structs.anUpperHyphenGuid)).toBe(
      'fa06fa06fa064fff8ffffa06fa06fa06',
    )
  })

  it('reads object-payload structs', () => {
    expect(g.vec3(structs.aVector)).toEqual({
      x: -295971.3947138115,
      y: 190554.45703293625,
      z: 113.2363314511517,
    })
  })

  it('scales FixedPoint64 HP back out of its x1000 storage form', () => {
    expect(g.fixed64(structs.aFixedPoint64)).toBe(927000)
    expect(g.hp(structs.aFixedPoint64)).toBe(927)
  })

  it('reads a transform translation', () => {
    const t = g.translation(structs.aTransform)
    expect(t?.x).toBeCloseTo(-353595.448)
    expect(t?.z).toBeCloseTo(7061.547)
  })

  it('reads a container id out of a SlotId', () => {
    expect(g.containerIdOf(structs.aSlotId)).toBe(
      'fa04fa04fa044fff8ffffa04fa04fa04',
    )
    expect(g.int((structs.aSlotId as any).value.SlotIndex)).toBe(24)
  })
})

describe('arrays', () => {
  it('reads ArrayProperty values', () => {
    expect(g.strArr(arrays.nameArray)).toEqual(['TrainerATK_UP_1', 'Legend'])
  })

  it('strips namespaces from enum arrays', () => {
    expect(g.enumArr(arrays.enumArray)).toEqual([
      'Unique_SamuraiDog_Bite',
      'StoneShotgun',
    ])
  })

  it('reads and normalises GUID arrays', () => {
    expect(g.guidArr(arrays.guidArray)).toEqual([
      'fa02fa02fa024fff8ffffa02fa02fa02',
    ])
  })

  it('reads arrays of structs', () => {
    const rows = g.arr<any>(arrays.structArray)
    expect(rows).toHaveLength(3)
    expect(g.str(rows[0].StatusName)).toBe('最大HP')
    expect(g.int(rows[0].StatusPoint)).toBe(7)
  })

  it('handles MapProperty, where the array sits directly at .value', () => {
    expect(g.arr(arrays.mapProperty)).toEqual([{ key: 'a', value: 1 }])
  })

  it('handles ArrayProperty, where it sits at .value.values', () => {
    expect(g.arr(arrays.arrayPropertyOfStructs)).toHaveLength(1)
  })

  it('always yields an array, never undefined', () => {
    expect(g.arr(arrays.emptyArray)).toEqual([])
    expect(g.arr(undefined)).toEqual([])
    expect(g.arr({})).toEqual([])
    expect(g.arr(42)).toEqual([])
    expect(g.strArr(undefined)).toEqual([])
    expect(g.guidArr(undefined)).toEqual([])
  })
})

describe('palworld-specific paths', () => {
  const characters = fixture.characters as any[]
  const [full, sparse, player, malformed] = characters

  it('resolves the SaveParameter path', () => {
    const sp = g.saveParameter(full)
    expect(g.str(sp.CharacterID)).toBe('BOSS_SamuraiDog')
    expect(g.byte(sp.Level)).toBe(9)
    expect(g.byte(sp.Talent_HP)).toBe(71)
    expect(g.hp(sp.Hp)).toBe(927)
  })

  it('reads group_id as a sibling of object, not from SaveParameter', () => {
    // A field inside SaveParameter would be `undefined` here; the guild link
    // lives one level up.
    expect(g.characterGroupId(full)).toBe('fa08fa08fa084fff8ffffa08fa08fa08')
    expect(g.saveParameter(full).group_id).toBeUndefined()
  })

  it('survives a pal carrying only CharacterID', () => {
    const sp = g.saveParameter(sparse)
    expect(g.str(sp.CharacterID)).toBe('Sheepball')
    expect(g.byte(sp.Level)).toBeUndefined()
    expect(g.strArr(sp.PassiveSkillList)).toEqual([])
    expect(g.guid(sp.OwnerPlayerUId)).toBeUndefined()
  })

  it('survives a missing object node', () => {
    expect(g.saveParameter(malformed)).toBeUndefined()
    expect(g.characterGroupId(malformed)).toBeUndefined()
  })

  it('identifies players', () => {
    expect(g.bool(g.saveParameter(player).IsPlayer)).toBe(true)
    expect(g.bool(g.saveParameter(full)?.IsPlayer)).toBeUndefined()
  })

  describe('map object modules', () => {
    const mapObjects = fixture.mapObjects as any[]
    const [chest, rock] = mapObjects

    it('finds the chest -> container link in ModuleMap', () => {
      const mod = g.module(chest.ConcreteModel, 'ItemContainer')
      expect(g.guid(mod.target_container_id)).toBe(
        'fa05fa05fa054fff8ffffa05fa05fa05',
      )
    })

    it('does not find it in ConcreteModel.RawData', () => {
      // Guards the assumption this parser was originally written against.
      expect(
        chest.ConcreteModel.value.RawData.value.target_container_id,
      ).toBeUndefined()
    })

    it('finds other module types', () => {
      expect(g.module(chest.ConcreteModel, 'PasswordLock')?.lock_state).toBe(1)
    })

    it('returns undefined for absent modules', () => {
      expect(g.module(rock.ConcreteModel, 'ItemContainer')).toBeUndefined()
      expect(g.module(undefined, 'ItemContainer')).toBeUndefined()
    })

    it('reads the misspelled initital_transform_cache', () => {
      const raw = chest.Model.value.RawData.value

      // The typo is in the game data, so the correct spelling finds nothing.
      // This is the assertion that matters: spell it wrong deliberately.
      expect(raw.initial_transform_cache).toBeUndefined()

      const t = g.translation(raw.initital_transform_cache)!
      expect(t.x).toBeCloseTo(-326852.4, 1)
      expect(t.y).toBeCloseTo(226363.0, 1)
      expect(t.z).toBeCloseTo(-879.4, 1)
    })
  })
})
