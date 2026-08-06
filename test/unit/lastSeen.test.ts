import { describe, expect, it } from 'vitest'

import {
  formatUptimeAgo,
  lastSeenBasis,
  lastSeenFor,
} from '@/domain/lastSeen.ts'
import type {
  GuildMember,
  Player,
  PlayerDetail,
  SaveMeta,
} from '@/domain/types.ts'

const UPTIME = 5_946_807_290_000
const meta: SaveMeta = {
  source: 'json',
  worldUptimeTicks: UPTIME,
  savedAtTicks: 639_214_026_450_400_000,
}

const player = (uid: string): Player => ({
  playerUid: uid,
  instanceId: uid,
  name: 'Test',
  level: 1,
  exp: 0,
  statusPoints: {},
  exStatusPoints: {},
})

const member = (ticks: number): GuildMember => ({
  playerUid: 'a',
  name: 'Test',
  lastOnlineTicks: ticks,
})

const detail = (ticks: number): PlayerDetail =>
  ({
    playerUid: 'a',
    platform: 'Steam',
    inventory: {},
    unlockedRecipes: [],
    lastOnlineTicks: ticks,
    record: {} as PlayerDetail['record'],
    sourceFileName: 'a.json',
  }) as PlayerDetail

describe('lastSeenFor', () => {
  it('prefers a player save and yields a real date', () => {
    const seen = lastSeenFor(
      player('a'),
      detail(639_212_432_832_040_000),
      member(UPTIME - 1e12),
      meta,
    )
    expect(seen.source).toBe('player-save')
    expect(seen.at?.getUTCFullYear()).toBe(2026)
  })

  it('never invents a date from the uptime clock', () => {
    // The whole point of the model. That counter stops while the server is
    // down; reconstructing a wall-clock time from it measured 52 hours out on
    // real data. If someone adds `at` here, this fails.
    const seen = lastSeenFor(
      player('a'),
      undefined,
      member(UPTIME - 1e12),
      meta,
    )
    expect(seen.source).toBe('guild-uptime')
    expect(seen.at).toBeUndefined()
    expect(seen.uptimeTicksAgo).toBe(1e12)
  })

  it('reports nothing when there is nothing to report', () => {
    const seen = lastSeenFor(player('a'), undefined, undefined, meta)
    expect(seen.source).toBe('none')
    expect(seen.onlineAtSave).toBe(false)
  })

  it('flags a player who was connected when the save was written', () => {
    expect(
      lastSeenFor(player('a'), undefined, member(UPTIME), meta).onlineAtSave,
    ).toBe(true)
  })

  it('holds the online threshold at one minute', () => {
    const oneMinute = 60 * 10_000_000
    expect(
      lastSeenFor(player('a'), undefined, member(UPTIME - oneMinute + 1), meta)
        .onlineAtSave,
    ).toBe(true)
    expect(
      lastSeenFor(player('a'), undefined, member(UPTIME - oneMinute - 1), meta)
        .onlineAtSave,
    ).toBe(false)
  })

  it('never reports a negative elapsed time', () => {
    // PalworldSaveTools clamps ticks that exceed the world counter, so saves
    // in the wild do contain them.
    const seen = lastSeenFor(
      player('a'),
      undefined,
      member(UPTIME + 5e11),
      meta,
    )
    expect(seen.uptimeTicksAgo).toBe(0)
  })
})

describe('lastSeenBasis', () => {
  it('uses absolute times only when every player has a save loaded', () => {
    const players = [player('a'), player('b')]
    const both = new Map([
      ['a', detail(1)],
      ['b', detail(2)],
    ])
    expect(lastSeenBasis(players, both)).toBe('absolute')

    // With a partial set the two clocks would interleave, and rows would
    // visibly reshuffle as each file finished parsing.
    expect(lastSeenBasis(players, new Map([['a', detail(1)]]))).toBe('uptime')
    expect(lastSeenBasis(players, new Map())).toBe('uptime')
  })
})

describe('formatUptimeAgo', () => {
  it('never implies a wall-clock time', () => {
    expect(formatUptimeAgo(36_000_000_000)).toContain('uptime')
    expect(formatUptimeAgo(undefined)).toBe('—')
  })
})
