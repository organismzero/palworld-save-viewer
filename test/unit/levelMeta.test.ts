/**
 * `LevelMeta.sav`, the world's metadata sidecar.
 *
 * The file is four values, so most of what is worth testing is the guard and the
 * shapes a `DateTime` can arrive in. The ticks→date conversion is asserted against
 * a known-good pair rather than against `Date.now()` — a clock tested against the
 * clock passes no matter what it does.
 */

import { describe, expect, it } from 'vitest'

import { readLevelMeta } from '@/parse/worker/readers/levelMeta.ts'
import { saveClock, ticksToDate } from '@/lib/format.ts'
import { Warnings } from '@/parse/warnings.ts'

/** Values measured from a real autosave, which is why they are exact. */
const TICKS = 639220591013490000
const WHEN = '2026-08-11T15:31:41.349Z'

function tree(saveData: unknown, extra: Record<string, unknown> = {}) {
  return {
    header: {},
    properties: {
      Version: { value: 100, type: 'IntProperty' },
      Timestamp: {
        struct_type: 'DateTime',
        value: TICKS,
        type: 'StructProperty',
      },
      SaveData: saveData,
      ...extra,
    },
  }
}

const BODY = {
  struct_type: 'PalWorldBaseInfoSaveData',
  value: {
    WorldName: { value: 'Autosave_W', type: 'StrProperty' },
    InGameDay: { value: 398, type: 'IntProperty' },
  },
}

describe('readLevelMeta', () => {
  it('reads the four values the file carries', () => {
    const out = readLevelMeta(tree(BODY), 'LevelMeta.sav', new Warnings())
    expect(out).toEqual({
      fileName: 'LevelMeta.sav',
      version: 100,
      savedAtTicks: TICKS,
      worldName: 'Autosave_W',
      inGameDay: 398,
    })
  })

  it('reads a timestamp whose digits are the server’s own clock', () => {
    // Against a fixed pair, not against the current time. The tick digits are a
    // naive wall clock, which `ticksToDate` lands in the UTC slots — so this
    // asserts the mapping, not that the instant is known.
    const out = readLevelMeta(tree(BODY), 'LevelMeta.sav', new Warnings())
    expect(ticksToDate(out.savedAtTicks!)?.toISOString()).toBe(WHEN)
  })

  it('formats as a clock reading, never as a relative time', () => {
    // The bug this pins: rendered through `relativeTime`, a save written this
    // afternoon on a UTC+10 host reads as written *in* two hours, because the
    // ticks carry no zone and the offset is added twice over.
    const out = readLevelMeta(tree(BODY), 'LevelMeta.sav', new Warnings())
    expect(saveClock(out.savedAtTicks)).toBe('2026-08-11 15:31')
  })

  it('has no clock reading when there is no timestamp', () => {
    expect(saveClock(undefined)).toBeUndefined()
  })

  it('rejects a file whose SaveData is something else, and says what', () => {
    // What used to happen instead: the player reader accepted it far enough to
    // complain that it had no PlayerUId.
    const wrong = { struct_type: 'PalWorldPlayerSaveData', value: {} }
    expect(() =>
      readLevelMeta(tree(wrong), 'Player.sav', new Warnings()),
    ).toThrow(/expected properties.SaveData to be a PalWorldBaseInfoSaveData, found PalWorldPlayerSaveData/) // prettier-ignore
  })

  it('rejects a file with no SaveData at all', () => {
    expect(() =>
      readLevelMeta(tree(undefined), 'nonsense.sav', new Warnings()),
    ).toThrow(/found nothing/)
  })

  it('warns about a SaveData key it does not read yet', () => {
    // The format canary, same role as `unknown-local-field`.
    const warn = new Warnings()
    const body = {
      ...BODY,
      value: { ...BODY.value, SomethingNew: { value: 1 } },
    }
    readLevelMeta(tree(body), 'LevelMeta.sav', warn)
    expect(
      warn
        .list()
        .some(
          (w) =>
            w.kind === 'unknown-levelmeta-field' &&
            w.detail === 'SaveData.SomethingNew',
        ),
    ).toBe(true)
  })

  it('survives a file missing everything optional', () => {
    const bare = { struct_type: 'PalWorldBaseInfoSaveData', value: {} }
    const out = readLevelMeta(
      { header: {}, properties: { SaveData: bare } },
      'LevelMeta.sav',
      new Warnings(),
    )
    expect(out.savedAtTicks).toBeUndefined()
    expect(out.inGameDay).toBeUndefined()
    expect(out.worldName).toBeUndefined()
  })

  it('drops an empty world name rather than surfacing a blank field', () => {
    const body = { ...BODY, value: { ...BODY.value, WorldName: { value: '' } } }
    const out = readLevelMeta(tree(body), 'LevelMeta.sav', new Warnings())
    expect(out.worldName).toBeUndefined()
  })

  it('reads a DateTime that arrives as a nested ticks field', () => {
    const nested = tree(BODY)
    // Defensive: the reader hands a DateTime back as a bare number today, but the
    // struct shape is the other plausible encoding and costs one branch to accept.
    ;(nested.properties as Record<string, unknown>).Timestamp = {
      struct_type: 'DateTime',
      value: { ticks: TICKS },
    }
    const out = readLevelMeta(nested, 'LevelMeta.sav', new Warnings())
    expect(out.savedAtTicks).toBe(TICKS)
  })

  it('treats a zero timestamp as absent, not as year one', () => {
    const zeroed = tree(BODY)
    ;(zeroed.properties as Record<string, unknown>).Timestamp = {
      struct_type: 'DateTime',
      value: 0,
    }
    expect(
      readLevelMeta(zeroed, 'LevelMeta.sav', new Warnings()).savedAtTicks,
    ).toBeUndefined()
  })
})
