import { describe, expect, it } from 'vitest'

import { readPlayerSave } from '@/parse/worker/readers/playerSave.ts'
import { applyPlayerOwnership } from '@/parse/ownership.ts'
import { Warnings } from '@/parse/warnings.ts'
import type {
  CharacterContainer,
  Container,
  PlayerDetail,
} from '@/domain/types.ts'

/**
 * A synthetic player save, hand-written rather than redacted from a real one.
 *
 * That is deliberate: real player files carry a `PsnAccountId` — an actual
 * platform account id, stored as an *unquoted* integer — and their UID is the
 * filename. Building the fixture by hand means there is nothing to redact and
 * nothing to leak.
 */
function playerSave(over: Record<string, unknown> = {}) {
  return {
    properties: {
      Timestamp: { struct_type: 'DateTime', value: 639300000000000000 },
      SaveData: {
        value: {
          PlayerUId: {
            struct_type: 'Guid',
            value: 'deadbeef-0000-0000-0000-000000000000',
          },
          IndividualId: {
            struct_type: 'PalInstanceID',
            value: {
              PlayerUId: {
                struct_type: 'Guid',
                value: 'deadbeef-0000-0000-0000-000000000000',
              },
              InstanceId: {
                struct_type: 'Guid',
                value: 'aaaaaaaa-1111-2222-3333-444444444444',
              },
            },
          },
          LastOnlineDateTime: {
            struct_type: 'DateTime',
            value: 639100000000000000,
            type: 'StructProperty',
          },
          PlayerPlatform: {
            value: {
              type: 'EPalPlayerPlatform',
              value: 'EPalPlayerPlatform::PS5',
            },
            type: 'EnumProperty',
          },
          TechnologyPoint: { value: 37, type: 'IntProperty' },
          bossTechnologyPoint: { value: 9, type: 'IntProperty' },
          // A GVAS Transform: capitalised `Translation`, unlike the lowercase
          // key that decoded RawData uses elsewhere.
          LastTransform: {
            struct_type: 'Transform',
            value: {
              Translation: {
                struct_type: 'Vector',
                value: { x: -265220, y: 173530, z: 5810 },
              },
            },
          },
          PalStorageContainerId: {
            value: {
              ID: {
                struct_type: 'Guid',
                value: '11111111-1111-1111-1111-111111111111',
              },
            },
          },
          OtomoCharacterContainerId: {
            value: {
              ID: {
                struct_type: 'Guid',
                value: '22222222-2222-2222-2222-222222222222',
              },
            },
          },
          InventoryInfo: {
            value: Object.fromEntries(
              [
                ['CommonContainerId', 'aa'],
                ['EssentialContainerId', 'bb'],
                ['WeaponLoadOutContainerId', 'cc'],
                ['PlayerEquipArmorContainerId', 'dd'],
                ['FoodEquipContainerId', 'ee'],
                ['DropSlotContainerId', 'ff'],
              ].map(([key, tag]) => [
                key,
                {
                  value: {
                    ID: {
                      struct_type: 'Guid',
                      value: `${tag}${tag}${tag}${tag}-0000-0000-0000-000000000000`,
                    },
                  },
                },
              ]),
            ),
          },
          UnlockedRecipeTechnologyNames: {
            array_type: 'NameProperty',
            value: { values: ['Workbench', 'PalBox'] },
          },
          RecordData: {
            value: {
              PalCaptureCount: {
                key_type: 'NameProperty',
                value: [
                  { key: 'Sheepball', value: 3 },
                  { key: 'Kitsunebi', value: 5 },
                ],
                type: 'MapProperty',
              },
              PaldeckUnlockFlag: {
                value: [
                  { key: 'Sheepball', value: true },
                  { key: 'Kitsunebi', value: false },
                ],
                type: 'MapProperty',
              },
              // Enum-keyed: its keys arrive as objects, not strings.
              RelicPossessNumMap: {
                key_type: 'EnumProperty',
                value: [
                  { key: { value: 'EPalRelicType::CapturePower' }, value: 2 },
                ],
                type: 'MapProperty',
              },
              RelicPossessNum: { value: 2, type: 'IntProperty' },
              CraftItemCount: {
                value: [{ key: 'PalSphere', value: 1607 }],
                type: 'MapProperty',
              },
              FishingCountMap: {
                value: [{ key: 'FishShadow', value: 4 }],
                type: 'MapProperty',
              },
            },
          },
          ...over,
        },
      },
    },
  }
}

describe('readPlayerSave', () => {
  it('reads the core fields', () => {
    const warn = new Warnings()
    const d = readPlayerSave(playerSave(), 'a.json', warn)

    expect(d.playerUid).toBe('deadbeef000000000000000000000000')
    expect(d.instanceId).toBe('aaaaaaaa111122223333444444444444')
    expect(d.platform).toBe('PS5')
    expect(d.technologyPoints).toBe(37)
    expect(d.bossTechnologyPoints).toBe(9)
    expect(d.unlockedRecipes).toEqual(['Workbench', 'PalBox'])
    expect(d.sourceFileName).toBe('a.json')
  })

  it('reads the position out of a capitalised Transform', () => {
    // The shared `translation()` helper looks for a lowercase `translation`
    // key, which is right for decoded RawData and silently returns undefined
    // here. This is the regression guard for that trap.
    const d = readPlayerSave(playerSave(), 'a.json', new Warnings())
    expect(d.pos).toEqual({ x: -265220, y: 173530, z: 5810 })
  })

  it('finds all eight container ids, including DropSlot', () => {
    const d = readPlayerSave(playerSave(), 'a.json', new Warnings())
    expect(Object.keys(d.inventory).sort()).toEqual([
      'drop',
      'equip',
      'essential',
      'food',
      'main',
      'weapon',
    ])
    expect(d.palboxContainerId).toBe('11111111111111111111111111111111')
    expect(d.otomoContainerId).toBe('22222222222222222222222222222222')
  })

  it('keeps absent tech points undefined rather than zero', () => {
    // One of ten real players has neither field. "Not recorded" and "zero" are
    // different claims and a `?? 0` here would erase the distinction.
    const raw = playerSave()
    delete (raw.properties.SaveData.value as any).TechnologyPoint
    const d = readPlayerSave(raw, 'a.json', new Warnings())
    expect(d.technologyPoints).toBeUndefined()
    expect(d.technologyPoints).not.toBe(0)
  })

  it('summarises the record without choking on enum-keyed maps', () => {
    const d = readPlayerSave(playerSave(), 'a.json', new Warnings())
    expect(d.record.palsCaught).toBe(8)
    expect(d.record.speciesCaught).toBe(2)
    // Only entries that are actually true.
    expect(d.record.paldexUnlocked).toBe(1)
    expect(d.record.relicsFound).toBe(2)
    expect(d.record.itemsCrafted).toBe(1607)
    expect(d.record.fishCaught).toBe(4)
    expect(d.record.captureCountBySpecies).toEqual({
      Sheepball: 3,
      Kitsunebi: 5,
    })
  })

  it('warns once per unrecognised RecordData field', () => {
    const warn = new Warnings()
    const raw = playerSave()
    ;(raw.properties.SaveData.value as any).RecordData.value.SomethingNew = {
      value: 1,
    }
    readPlayerSave(raw, 'a.json', warn)
    const list = warn.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.kind).toBe('unknown-record-field')
    expect(list[0]!.detail).toContain('SomethingNew')
  })

  it('rejects a file that is not a player save', () => {
    expect(() =>
      readPlayerSave({ properties: {} }, 'nope.json', new Warnings()),
    ).toThrow(/player save/)
  })
})

/* ------------------------------------------------------------------------- */

const container = (id: string, over: Partial<Container> = {}): Container => ({
  containerId: id,
  slots: [],
  ownerKind: 'unknown',
  confidence: 'inferred',
  slotCount: 10,
  usedSlots: 0,
  ...over,
})

const detail = (uid: string, main: string): PlayerDetail =>
  ({
    playerUid: uid,
    platform: 'Steam',
    inventory: { main },
    unlockedRecipes: [],
    record: {} as PlayerDetail['record'],
    sourceFileName: `${uid}.json`,
  }) as PlayerDetail

describe('applyPlayerOwnership', () => {
  it('claims a player container exactly', () => {
    const containers = [container('aa')]
    applyPlayerOwnership(
      containers,
      [],
      [detail('p1', 'aa')],
      1,
      new Warnings(),
    )

    expect(containers[0]!.ownerKind).toBe('player')
    expect(containers[0]!.ownerId).toBe('p1')
    expect(containers[0]!.ownerSlot).toBe('main')
    expect(containers[0]!.confidence).toBe('exact')
  })

  it('keeps a structure claim and warns when two exact sources disagree', () => {
    const warn = new Warnings()
    const containers = [
      container('aa', {
        ownerKind: 'structure',
        ownerId: 's1',
        confidence: 'exact',
      }),
    ]
    applyPlayerOwnership(containers, [], [detail('p1', 'aa')], 1, warn)

    expect(containers[0]!.ownerKind).toBe('structure')
    expect(containers[0]!.ownerId).toBe('s1')
    expect(warn.list()[0]!.kind).toBe('ownership-conflict')
  })

  it('withdraws a guess the player saves disprove', () => {
    const containers = [
      container('zz', { ownerKind: 'player', confidence: 'inferred' }),
    ]
    // All players accounted for, and none of them claims zz.
    applyPlayerOwnership(
      containers,
      [],
      [detail('p1', 'aa')],
      1,
      new Warnings(),
    )
    expect(containers[0]!.ownerKind).toBe('unknown')
  })

  it('retains a guess while any player save is still missing', () => {
    const containers = [
      container('zz', { ownerKind: 'player', confidence: 'inferred' }),
    ]
    // Two players in the level, one file loaded — zz may well be the other's.
    applyPlayerOwnership(
      containers,
      [],
      [detail('p1', 'aa')],
      2,
      new Warnings(),
    )
    expect(containers[0]!.ownerKind).toBe('player')
    expect(containers[0]!.confidence).toBe('inferred')
  })

  it('distinguishes a palbox from a party', () => {
    const charContainers: CharacterContainer[] = [
      { containerId: 'box', slots: [], confidence: 'inferred' },
      { containerId: 'party', slots: [], confidence: 'inferred' },
    ]
    const d = {
      ...detail('p1', 'aa'),
      palboxContainerId: 'box',
      otomoContainerId: 'party',
    }
    applyPlayerOwnership([], charContainers, [d], 1, new Warnings())

    expect(charContainers[0]!.ownerSlot).toBe('palbox')
    expect(charContainers[1]!.ownerSlot).toBe('party')
    expect(charContainers.every((c) => c.confidence === 'exact')).toBe(true)
    expect(charContainers.every((c) => c.ownerPlayerUid === 'p1')).toBe(true)
  })

  it('warns when the majority vote named a different player', () => {
    const warn = new Warnings()
    const charContainers: CharacterContainer[] = [
      {
        containerId: 'box',
        slots: [],
        ownerPlayerUid: 'someone-else',
        confidence: 'inferred',
      },
    ]
    applyPlayerOwnership(
      [],
      charContainers,
      [{ ...detail('p1', 'aa'), palboxContainerId: 'box' }],
      1,
      warn,
    )
    expect(warn.list()[0]!.kind).toBe('ownership-conflict')
    // The exact source still wins.
    expect(charContainers[0]!.ownerPlayerUid).toBe('p1')
  })
})
