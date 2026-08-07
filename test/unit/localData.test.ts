import { describe, expect, it } from 'vitest'

import { readLocalData, maskBuffers } from '@/parse/worker/readers/localData.ts'
import { Warnings } from '@/parse/warnings.ts'

/**
 * A synthetic `LocalData`, hand-written rather than redacted from a real one.
 *
 * The real file is a client's own: its map pins are places somebody goes and
 * its party presets name their pals. Building the fixture by hand means there
 * is nothing to redact and nothing to leak — and it keeps the fog masks small
 * enough to read, which a redaction of the real 4 MB texture would not.
 */
function localSave(over: Record<string, unknown> = {}) {
  return {
    properties: {
      Version: { value: 100, type: 'IntProperty' },
      SaveData: {
        struct_type: 'PalLocalSaveData',
        type: 'StructProperty',
        value: {
          WorldMapUISaveDataMap: {
            key_type: 'NameProperty',
            type: 'MapProperty',
            value: [
              {
                key: 'MainMap',
                value: {
                  MaskTextureData: {
                    array_type: 'ByteProperty',
                    type: 'ArrayProperty',
                    // 2×2 RGBA: one explored pixel, one half-lit edge, two
                    // fully fogged.
                    value: {
                      values: new Uint8Array([
                        0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 255, 0, 0, 0, 255,
                      ]),
                    },
                  },
                },
              },
            ],
          },
          Local_CustomMarkerSaveData: {
            array_type: 'StructProperty',
            type: 'ArrayProperty',
            value: {
              values: [
                {
                  IconLocation: {
                    struct_type: 'Vector',
                    value: { x: -216395, y: -138, z: 0 },
                  },
                  IconType: { value: 3, type: 'IntProperty' },
                },
              ],
            },
          },
          Local_OtomoLoadoutSaveData: {
            array_type: 'StructProperty',
            type: 'ArrayProperty',
            value: {
              values: [
                {
                  PresetName: { value: 'Mining', type: 'StrProperty' },
                  LoadoutPals: {
                    array_type: 'StructProperty',
                    type: 'ArrayProperty',
                    value: {
                      values: [
                        {
                          PalInstanceID: {
                            struct_type: 'PalInstanceID',
                            value: {
                              PlayerUId: {
                                value: '00000000-0000-0000-0000-000000000000',
                              },
                              InstanceId: {
                                value: 'aaaaaaaa-1111-2222-3333-444444444444',
                              },
                            },
                          },
                          ValidState: { value: true, type: 'BoolProperty' },
                        },
                        // No instance id: a slot that resolves to nothing must
                        // drop out rather than become an undefined entry.
                        { ValidState: { value: false, type: 'BoolProperty' } },
                      ],
                    },
                  },
                },
              ],
            },
          },
          Local_PalEncountFlag: {
            type: 'MapProperty',
            value: [
              { key: 'EPalTribeID::SheepBall', value: true },
              { key: 'EPalTribeID::PinkCat', value: true },
              { key: 'EPalTribeID::Boar', value: false },
            ],
          },
          Local_NewUnlockedTechs: {
            type: 'MapProperty',
            value: [{ key: 'PalBox', value: true }],
          },
          Local_NewUnlockedBuilds: {
            type: 'MapProperty',
            value: [
              { key: 'CampFire', value: 1 },
              { key: 'Wooden_wall', value: 1 },
            ],
          },
          Local_HiddenLocationFlagMap: {
            type: 'MapProperty',
            value: [
              { key: 'yamijima_rock_purple_BOSS', value: true },
              { key: 'yamijima_forest_purple_A_BOSS', value: false },
            ],
          },
          Local_TutorialTriggerSaveData: {
            array_type: 'StructProperty',
            type: 'ArrayProperty',
            value: {
              values: [
                {
                  TutorialMsg: { value: 'TUTORIAL_ITEM_1' },
                  Checked: { value: true },
                },
                {
                  TutorialMsg: { value: 'TUTORIAL_ITEM_2' },
                  Checked: { value: false },
                },
              ],
            },
          },
          Local_PlayTime: { value: 15297485, type: 'IntProperty' },
          TrackingQuestId: {
            value: 'Main_DefeatVolcanoBoss',
            type: 'NameProperty',
          },
          ...over,
        },
      },
    },
  }
}

function read(over?: Record<string, unknown>) {
  const warn = new Warnings()
  return {
    payload: readLocalData(localSave(over), 'LocalData.sav', warn),
    warn,
  }
}

describe('readLocalData', () => {
  it('keeps the alpha channel and throws the rest away', () => {
    // The file stores an RGBA fog *overlay*, not a bitmap of flags. RGB is
    // zero throughout and says nothing, so a quarter of the bytes carry all of
    // the information.
    const { payload } = read()
    const fog = payload.fog[0]!

    expect(fog.map).toBe('overworld')
    expect(fog.size).toBe(2)
    expect([...fog.alpha]).toEqual([0, 100, 255, 255])
  })

  it('counts anything under half opacity as explored', () => {
    // The soft edge sweeps the whole 0–255 range, so any threshold is a
    // convention; this one puts the line where the fog stops dominating.
    const { payload } = read()
    expect(payload.fog[0]!.exploredFraction).toBe(0.5)
  })

  it('reports a mask whose byte count is not four times a square', () => {
    const { payload, warn } = read({
      WorldMapUISaveDataMap: {
        type: 'MapProperty',
        value: [
          {
            key: 'MainMap',
            value: {
              MaskTextureData: { value: { values: new Uint8Array(13) } },
            },
          },
        ],
      },
    })
    expect(payload.fog).toEqual([])
    expect(warn.list()[0]?.kind).toBe('malformed-map-mask')
  })

  it('reports a mask keyed by a map it has never heard of', () => {
    const { payload, warn } = read({
      WorldMapUISaveDataMap: {
        type: 'MapProperty',
        value: [
          {
            key: 'Sakurajima',
            value: {
              MaskTextureData: { value: { values: new Uint8Array(4) } },
            },
          },
        ],
      },
    })
    expect(payload.fog).toEqual([])
    expect(warn.list()[0]).toMatchObject({
      kind: 'unknown-map-mask',
      detail: 'Sakurajima',
    })
  })

  it('reads a map pin and places it', () => {
    const { payload } = read()
    const pin = payload.markers[0]!

    expect(pin.iconType).toBe(3)
    expect(pin.at.map).toBe('overworld')
    expect(pin.at.mx).toBeCloseTo(-0.17, 2)
    expect(pin.at.my).toBeCloseTo(219.1, 1)
  })

  it('keeps preset pals as references, not copies', () => {
    // Each slot embeds a whole `PalSaveParameter` — a second copy of a pal
    // that already exists in the level save. The instance id is the useful
    // part; the copy is dropped so it cannot drift out of step.
    const { payload } = read()
    expect(payload.presets).toEqual([
      { name: 'Mining', palIds: ['aaaaaaaa111122223333444444444444'] },
    ])
  })

  it('counts flags that are true, not entries that exist', () => {
    const { payload } = read()
    expect(payload.paldeckEncountered).toBe(2)
    expect(payload.techsUnlocked).toBe(1)
    expect(payload.hiddenLocations).toBe(1)
    expect(payload.tutorialsSeen).toBe(1)
    // Builds are counted by entry: the values are counters, not flags.
    expect(payload.buildsUnlocked).toBe(2)
  })

  it('carries the play counter through unformatted', () => {
    const { payload } = read()
    expect(payload.playTime).toBe(15297485)
    expect(payload.trackingQuestId).toBe('Main_DefeatVolcanoBoss')
  })

  it('warns about a SaveData key it does not read yet', () => {
    // The cheapest possible canary for a save-format change. Palworld adds
    // fields here every few patches.
    const { warn } = read({ Local_SomethingNew: { value: 1 } })
    expect(warn.list()).toContainEqual({
      kind: 'unknown-local-field',
      detail: 'SaveData.Local_SomethingNew',
      count: 1,
    })
  })

  it('collects its warnings onto the payload', () => {
    const { payload } = read({ Local_SomethingNew: { value: 1 } })
    expect(payload.warnings.map((w) => w.kind)).toEqual(['unknown-local-field'])
  })

  it('rejects a file that is not a LocalData', () => {
    // The routing upstream is by filename, because a `.sav` is compressed and
    // there is nothing to sniff. This is where the contents get checked, and a
    // player save renamed to `LocalData.sav` has to fail here — it has a
    // `SaveData` of its own and would otherwise read as an empty client.
    const warn = new Warnings()
    const playerish = {
      properties: {
        SaveData: { struct_type: 'PalWorldPlayerSaveData', value: {} },
      },
    }
    expect(() => readLocalData(playerish, 'LocalData.sav', warn)).toThrow(
      /PalWorldPlayerSaveData/,
    )
  })

  it('rejects a file with no SaveData at all', () => {
    const warn = new Warnings()
    expect(() =>
      readLocalData({ properties: {} }, 'LocalData.sav', warn),
    ).toThrow(/LocalData/)
  })

  it('hands over exactly the buffers the worker must transfer', () => {
    // If this drifts, the masks get structured-cloned instead of moved and a
    // megabyte is copied per drop rather than handed across.
    const { payload } = read()
    expect(maskBuffers(payload)).toEqual([payload.fog[0]!.alpha.buffer])
  })
})
