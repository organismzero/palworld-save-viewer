/** Guild colours on the map. Synthetic ids throughout. */

import { describe, expect, it } from 'vitest'

import type { Guild } from '@/domain/types.ts'
import { guildTints } from '@/views/map/guildTint.ts'

const guild = (
  id: string,
  players: number,
  type: Guild['type'] = 'Guild',
): Guild => ({
  groupId: id.padEnd(32, '0'),
  type,
  name: id,
  members: [],
  playerUids: Array.from({ length: players }, (_, i) =>
    `${id}${i}`.padEnd(32, '0'),
  ),
  memberCount: players,
  characterHandleIds: [],
  baseIds: [],
  baseCampLevel: 1,
  markers: [],
  hasV2Tail: false,
})

describe('guildTints', () => {
  it('gives each player guild its own colour, largest first', () => {
    const small = guild('aaaa', 1)
    const big = guild('bbbb', 5)
    const tints = guildTints([small, big])
    expect(tints.size).toBe(2)
    expect(tints.get(big.groupId)!.color).not.toBe(
      tints.get(small.groupId)!.color,
    )
    // Whatever order the save lists them in.
    expect(guildTints([big, small]).get(big.groupId)).toEqual(
      tints.get(big.groupId),
    )
  })

  it('skips the bookkeeping groups that are not guilds', () => {
    const org = guild('cccc', 0, 'Organization')
    expect(guildTints([org]).size).toBe(0)
  })

  it('writes the same colour for CSS as for the canvas', () => {
    const g = guild('dddd', 1)
    const { color, css } = guildTints([g]).get(g.groupId)!
    expect(parseInt(css.slice(1), 16)).toBe(color)
    expect(css).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('repeats past the palette rather than running out', () => {
    const many = Array.from({ length: 10 }, (_, i) => guild(`g${i}`, 10 - i))
    const tints = guildTints(many)
    expect(tints.size).toBe(10)
    expect(tints.get(many[8]!.groupId)).toEqual(tints.get(many[0]!.groupId))
  })
})
