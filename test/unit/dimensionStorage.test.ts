/**
 * The dimensional storage reader, against a hand-built tree in the file's
 * shape. Synthetic ids throughout; the real files are read by the golden suite.
 */

import { describe, expect, it } from 'vitest'

import {
  readDimensionStorage,
  storageOwner,
} from '@/parse/worker/readers/dimensionStorage.ts'
import { Warnings } from '@/parse/warnings.ts'
import { conditions, placer, placeText, storedText } from '@/domain/palState.ts'
import type { SaveIndex } from '@/domain/types.ts'

const OWNER = 'aaaaaaaa000000000000000000000000'
const ZERO = '00000000-0000-0000-0000-000000000000'

const guid = (n: number) =>
  `${String(n).padStart(8, '0')}-0000-0000-0000-000000000001`

/** A filled slot. `SlotId` and the jump are deliberately set, and stale. */
function filled(n: number, species: string, owner = OWNER) {
  return {
    SaveParameter: {
      value: {
        CharacterID: { value: species },
        Level: { value: { value: 12 } },
        PassiveSkillList: { value: { values: ['TestPassive'] } },
        OwnerPlayerUId: { value: owner },
        // Written out in full here, where the level save would omit them.
        WorkerSick: { value: { value: 'EPalBaseCampWorkerSickType::None' } },
        PhysicalHealth: {
          value: { value: 'EPalStatusPhysicalHealthType::Healthful' },
        },
        SlotId: {
          value: {
            ContainerId: { value: { ID: { value: guid(900) } } },
            SlotIndex: { value: 309 },
          },
        },
        LastJumpedLocation: { value: { x: 100, y: 200, z: 300 } },
      },
    },
    InstanceId: { value: { InstanceId: { value: guid(n) } } },
  }
}

const empty = () => ({
  SaveParameter: { value: { CharacterID: { value: 'None' } } },
  InstanceId: { value: { InstanceId: { value: ZERO } } },
})

function tree(
  slots: unknown[],
  cls = '/Script/Pal.PalDimensionPalStorageSaveGame',
) {
  return {
    header: { save_game_class_name: cls },
    properties: { SaveParameterArray: { value: { values: slots } } },
  }
}

describe('readDimensionStorage', () => {
  it('reads the filled slots and skips the empty ones', () => {
    const { pals, slots } = readDimensionStorage(
      tree([
        filled(1, 'TestPalA'),
        empty(),
        filled(2, 'BOSS_TestPalB'),
        empty(),
      ]),
      'x_dps.sav',
      new Warnings(),
    )
    expect(slots).toBe(4)
    expect(pals.map((p) => p.characterId)).toEqual(['TestPalA', 'TestPalB'])
    expect(pals[1]!.isBoss).toBe(true)
    expect(pals[0]!.passives).toEqual(['TestPassive'])
    expect(pals.every((p) => p.storage === 'dimensional')).toBe(true)
  })

  it('does not call a healthy pal sick for having its defaults written out', () => {
    const { pals } = readDimensionStorage(
      tree([filled(1, 'TestPalA')]),
      'x_dps.sav',
      new Warnings(),
    )
    expect(pals[0]!.sickness).toBeUndefined()
    expect(pals[0]!.physicalHealth).toBeUndefined()
    expect(conditions(pals[0]!)).toEqual([])
  })

  it('takes the place in storage from the array, not from the stale SlotId', () => {
    const { pals } = readDimensionStorage(
      tree([empty(), empty(), filled(1, 'TestPalA')]),
      'x_dps.sav',
      new Warnings(),
    )
    // The record says slot 309 of a palbox it left; it is the third slot here.
    expect(pals[0]!.slotIndex).toBe(2)
    expect(pals[0]!.containerId).toBeUndefined()
    expect(pals[0]!.pos).toBeUndefined()
  })

  it('warns about, and drops, a filled slot with no instance id', () => {
    const warn = new Warnings()
    const bad = {
      ...filled(1, 'TestPalA'),
      InstanceId: { value: { InstanceId: { value: ZERO } } },
    }
    expect(readDimensionStorage(tree([bad]), 'x_dps.sav', warn).pals).toEqual(
      [],
    )
    expect(warn.list()).toHaveLength(1)
  })

  it('refuses a file that is not a storage file, by name', () => {
    expect(() =>
      readDimensionStorage(
        { properties: { SaveData: {} } },
        'odd_dps.sav',
        new Warnings(),
      ),
    ).toThrow(/odd_dps\.sav does not look like a Dimensional Pal Storage file/)
    expect(() =>
      readDimensionStorage(
        tree([], '/Script/Pal.PalWorldPlayerSaveGame'),
        'odd_dps.sav',
        new Warnings(),
      ),
    ).toThrow(/Dimensional Pal Storage/)
  })
})

describe('storageOwner', () => {
  const read = (slots: unknown[]) =>
    readDimensionStorage(tree(slots), 'x_dps.sav', new Warnings()).pals

  it('names the owner when every pal agrees', () => {
    expect(storageOwner(read([filled(1, 'A'), filled(2, 'B')]))).toBe(OWNER)
  })

  it('names nobody when they disagree, or when there are none', () => {
    const other = 'bbbbbbbb000000000000000000000000'
    expect(
      storageOwner(read([filled(1, 'A'), filled(2, 'B', other)])),
    ).toBeUndefined()
    expect(storageOwner([])).toBeUndefined()
  })
})

describe('a stored pal’s place', () => {
  const [pal] = readDimensionStorage(
    tree([...Array.from({ length: 38 }, empty), filled(1, 'TestPalA')]),
    'x_dps.sav',
    new Warnings(),
  ).pals

  it('is dimensional storage whatever the index says about containers', () => {
    const index = {
      bases: [],
      playerDetails: [],
      charContainerById: new Map(),
    } as unknown as SaveIndex
    expect(placer(index)(pal!)).toEqual({ where: 'dimensional', slot: 38 })
  })

  it('is worded as a page and slot, thirty to a page', () => {
    expect(storedText(pal!)).toBe('Dimensional storage · page 2, slot 9')
    expect(placeText({ where: 'dimensional' }, () => undefined)).toBe(
      'Dimensional storage',
    )
  })

  it('is nothing for a pal that is not stored', () => {
    expect(storedText({ ...pal!, storage: undefined })).toBeUndefined()
  })
})
