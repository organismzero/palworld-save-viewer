/**
 * The checks that decide whether a file added after the level belongs to it.
 *
 * Unit-tested rather than driven through the app because reproducing a refusal
 * needs a save from a *second* world, which no fixture can be. The rules are
 * pure functions for exactly this reason.
 */

import { describe, expect, it } from 'vitest'

import {
  levelMetaPredatesWorld,
  localDataBelongs,
  playerBelongs,
  resolvePresetOwner,
} from '@/domain/verify.ts'
import type { Guid, OtomoPreset, Pal } from '@/domain/types.ts'

const ADA = 'ada00000000000000000000000000000' as Guid
const BO = 'bo000000000000000000000000000000' as Guid

/** Only the two fields the resolver reads. */
function world(
  entries: [Guid, string | undefined][],
): ReadonlyMap<Guid, Pick<Pal, 'ownerPlayerUid'>> {
  return new Map(
    entries.map(([id, owner]) => [
      id,
      { ownerPlayerUid: owner as Guid | undefined },
    ]),
  )
}

const preset = (...palIds: Guid[]): OtomoPreset => ({ name: 'Party', palIds })

describe('playerBelongs', () => {
  it('accepts a uid the level lists', () => {
    expect(playerBelongs([{ playerUid: ADA }, { playerUid: BO }], ADA)).toBe(
      true,
    )
  })

  it('refuses one it does not', () => {
    // Either a save from another world or one left behind by a player who has
    // gone. Indistinguishable from the file, and refused either way: its
    // container ids do not exist in this world, so it can contribute nothing.
    expect(playerBelongs([{ playerUid: ADA }], BO)).toBe(false)
  })

  it('refuses everything when the level has no players', () => {
    expect(playerBelongs([], ADA)).toBe(false)
  })
})

describe('resolvePresetOwner', () => {
  const pal1 = 'pal10000000000000000000000000000' as Guid
  const pal2 = 'pal20000000000000000000000000000' as Guid
  const gone = 'gone0000000000000000000000000000' as Guid

  it('names the owner every resolved pal agrees on', () => {
    const o = resolvePresetOwner(
      [preset(pal1, pal2)],
      world([
        [pal1, ADA],
        [pal2, ADA],
      ]),
    )
    expect(o).toEqual({ ownerUid: ADA, referenced: 2, resolved: 2 })
  })

  it('names nobody when they disagree', () => {
    // A preset holding someone else's pal, or a stale id from before a trade.
    const o = resolvePresetOwner(
      [preset(pal1, pal2)],
      world([
        [pal1, ADA],
        [pal2, BO],
      ]),
    )
    expect(o.ownerUid).toBeUndefined()
    expect(o.resolved).toBe(2)
  })

  it('counts an unowned pal as resolved', () => {
    // A base worker in shared storage belongs to nobody but still proves the
    // world matches, which is the whole reason resolution and ownership are
    // counted separately.
    const o = resolvePresetOwner([preset(pal1)], world([[pal1, undefined]]))
    expect(o).toEqual({ ownerUid: undefined, referenced: 1, resolved: 1 })
  })

  it('counts ids it cannot resolve', () => {
    const o = resolvePresetOwner([preset(pal1, gone)], world([[pal1, ADA]]))
    expect(o).toEqual({ ownerUid: ADA, referenced: 2, resolved: 1 })
  })
})

describe('localDataBelongs', () => {
  it('accepts a client whose presets resolve here', () => {
    expect(localDataBelongs({ referenced: 3, resolved: 1 })).toBe(true)
  })

  it('refuses one whose presets resolve to nothing', () => {
    expect(localDataBelongs({ referenced: 3, resolved: 0 })).toBe(false)
  })

  it('has no opinion when the presets name no pals', () => {
    // A client that has never saved a party. Refusing a file for being empty
    // would be worse than reading it.
    expect(localDataBelongs({ referenced: 0, resolved: 0 })).toBeUndefined()
  })
})

describe('levelMetaPredatesWorld', () => {
  const pals = (...ticks: number[]) => ticks.map((ownedTime) => ({ ownedTime }))

  it('flags metadata older than the newest pal in the world', () => {
    // A level cannot have been written before a capture it records, so this is
    // an earlier snapshot — usually another autosave folder.
    expect(levelMetaPredatesWorld({ savedAtTicks: 100 }, pals(50, 150))).toBe(
      true,
    )
  })

  it('passes metadata written after everything in the world', () => {
    expect(levelMetaPredatesWorld({ savedAtTicks: 200 }, pals(50, 150))).toBe(
      false,
    )
  })

  it('passes metadata written at the same tick as the newest pal', () => {
    expect(levelMetaPredatesWorld({ savedAtTicks: 150 }, pals(150))).toBe(false)
  })

  it('has no opinion without a timestamp', () => {
    expect(levelMetaPredatesWorld({}, pals(150))).toBeUndefined()
    expect(
      levelMetaPredatesWorld({ savedAtTicks: 0 }, pals(150)),
    ).toBeUndefined()
  })

  it('has no opinion when no pal is dated', () => {
    // A missing comparison is not a pass, so this must not answer `false`.
    expect(levelMetaPredatesWorld({ savedAtTicks: 100 }, [])).toBeUndefined()
    expect(
      levelMetaPredatesWorld({ savedAtTicks: 100 }, [{ ownedTime: undefined }]),
    ).toBeUndefined()
  })
})
