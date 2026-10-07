/**
 * Player-save ingestion against the real files in `data/Players/`.
 *
 * Self-skips when they are absent. The counts below were measured; they are
 * exact on purpose, because the whole value of this milestone is that guessed
 * attribution becomes exact and the numbers are how you can tell.
 *
 * **This suite never reads a `*_dps.sav`.** It is DPS storage, not a player
 * save, and the player reader rejects it; `sniff` keeps it out of the app, and
 * the enumeration in `load.ts` mirrors that.
 */

import { existsSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildIndexes,
  mergePlayerDetails,
} from '@/parse/worker/buildIndexes.ts'
import { readPlayerSave } from '@/parse/worker/readers/playerSave.ts'
import { buildSaveIndex } from '@/domain/index.ts'
import { lastSeenBasis, lastSeenFor } from '@/domain/lastSeen.ts'
import { Warnings } from '@/parse/warnings.ts'
import { looksLikeDpsName, partition } from '@/parse/sniff.ts'
import type { PlayerDetail, SaveIndex, SlimPayload } from '@/domain/types.ts'
import {
  PLAYERS_DIR,
  dpsSaveNames,
  hasLevel,
  levelTree,
  playerSaveNames,
  playerTrees,
} from './load.ts'

const hasData = hasLevel && existsSync(PLAYERS_DIR)

const EXPECTED = {
  playerFiles: 11,
  /** Two players carry a DPS storage file beside their save. */
  dpsIgnored: 2,
  itemContainerLinks: 66,
  charContainerLinks: 22,
  linkMisses: 0,
  withTechnologyPoint: 11,
  platforms: { Steam: 7, PS5: 2, Xbox: 2 },
} as const

describe.skipIf(!hasData)('golden: player saves', () => {
  let details: PlayerDetail[]
  let before: SlimPayload['stats']
  let index: SaveIndex
  let payload: SlimPayload

  let warnings: ReturnType<Warnings['list']>

  beforeAll(async () => {
    payload = buildIndexes(await levelTree())
    before = { ...payload.stats }

    const warn = new Warnings()
    details = (await playerTrees()).map(({ name, tree }) =>
      readPlayerSave(tree, name, warn),
    )
    warnings = warn.list()

    mergePlayerDetails(payload, details, [])
    index = buildSaveIndex(payload)
  })

  it('excludes the DPS storage files from enumeration', () => {
    const dps = dpsSaveNames()
    expect(dps).toHaveLength(EXPECTED.dpsIgnored)
    expect(dps.every(looksLikeDpsName)).toBe(true)
    expect(playerSaveNames()).toHaveLength(EXPECTED.playerFiles)

    // And the app's own sniffer sets them aside the same way.
    const files = [...dps, ...playerSaveNames()].map(
      (name) => ({ name, size: 0 }) as File,
    )
    const parts = partition(files)
    expect(parts.ignored.map((s) => s.file.name).sort()).toEqual(dps.sort())
    expect(parts.savs).toHaveLength(EXPECTED.playerFiles)
  })

  it('knows every RecordData field the real saves carry', () => {
    // The canary for a game update adding progression fields. Never asserted
    // until the one that landed three at once, which is why it is here now.
    if (warnings.length > 0) console.error('warnings:', warnings)
    expect(warnings).toEqual([])
  })

  it('matches every player file to a player in the level', () => {
    expect(details).toHaveLength(EXPECTED.playerFiles)
    for (const d of details) {
      const player = index.playerByUid.get(d.playerUid)
      expect(player, `no level player for ${d.sourceFileName}`).toBeDefined()
      // IndividualId is the authoritative link when a uid has several bodies.
      expect(d.instanceId).toBe(player!.instanceId)
    }
  })

  it('resolves every container link with no misses', () => {
    let item = 0
    let char = 0
    let misses = 0

    for (const d of details) {
      for (const id of Object.values(d.inventory)) {
        if (index.containerById.has(id)) item++
        else misses++
      }
      for (const id of [d.palboxContainerId, d.otomoContainerId]) {
        if (!id) continue
        if (index.charContainerById.has(id)) char++
        else misses++
      }
    }

    expect(item).toBe(EXPECTED.itemContainerLinks)
    expect(char).toBe(EXPECTED.charContainerLinks)
    expect(misses).toBe(EXPECTED.linkMisses)
  })

  it('reads platform, tech points and paldex progress', () => {
    const platforms: Record<string, number> = {}
    for (const d of details) {
      platforms[d.platform] = (platforms[d.platform] ?? 0) + 1
    }
    expect(platforms).toEqual(EXPECTED.platforms)

    // Absent tech points must stay undefined — 0 would be a different claim.
    const withTech = details.filter((d) => d.technologyPoints !== undefined)
    expect(withTech).toHaveLength(EXPECTED.withTechnologyPoint)

    expect(details.every((d) => d.record.palsCaught > 0)).toBe(true)
    expect(details.every((d) => d.record.paldexUnlocked > 0)).toBe(true)
    expect(details.some((d) => d.record.bossesDefeated > 0)).toBe(true)
  })

  it('gives every player a real position', () => {
    // LastTransform is capitalised, which the shared `translation()` helper
    // misses silently. This is the regression guard for that.
    for (const d of details) {
      expect(d.pos, `${d.sourceFileName} has no position`).toBeDefined()
      expect(Number.isFinite(d.pos!.x)).toBe(true)
    }
  })

  it('upgrades attribution from guessed to exact', () => {
    // Level alone can attribute 4,377 containers exactly (map objects claim
    // them) and guess at the rest. Adding the player files turns every player
    // inventory — six per player — into an exact claim, and leaves under a
    // third as much unattributed.
    //
    // Note the "before" numbers reflect the *current* heuristic — single-slot
    // containers as pal gear. An earlier slot-shape rule labelled 290
    // containers as some player's inventory, of which ground truth showed only
    // 26 actually were, so it was replaced rather than kept as a fallback.
    expect(before.attributedExact).toBe(4377)
    expect(before.unattributedContainers).toBe(88)

    expect(index.stats.attributedExact).toBe(4377 + EXPECTED.itemContainerLinks)
    expect(index.stats.unattributedContainers).toBe(27)
    expect(index.stats.playerDetails).toBe(EXPECTED.playerFiles)
    expect(index.stats.playersInLevel).toBe(EXPECTED.playerFiles)

    const exactPlayer = index.containers.filter(
      (c) => c.ownerKind === 'player' && c.confidence === 'exact',
    )
    expect(exactPlayer).toHaveLength(EXPECTED.itemContainerLinks)
    // No container should still be a *guessed* player inventory.
    expect(
      index.containers.filter(
        (c) => c.ownerKind === 'player' && c.confidence === 'inferred',
      ),
    ).toHaveLength(0)

    // Orphans are containers no map object claims — unchanged by definition.
    expect(index.stats.orphanContainers).toBe(before.orphanContainers)
  })

  it('distinguishes palbox from party', () => {
    const palboxes = index.charContainers.filter(
      (c) => c.ownerSlot === 'palbox',
    )
    const parties = index.charContainers.filter((c) => c.ownerSlot === 'party')
    expect(palboxes).toHaveLength(EXPECTED.playerFiles)
    expect(parties).toHaveLength(EXPECTED.playerFiles)
    expect(
      [...palboxes, ...parties].every((c) => c.confidence === 'exact'),
    ).toBe(true)
  })

  it('is independent of the order player files arrive in', async () => {
    // This is what justifies re-deriving ownership from scratch on every merge
    // rather than patching incrementally.
    // Two indexes of the same tree: `buildIndexes` reads it and never
    // mutates it, and each merge mutates only its own payload.
    const a = buildIndexes(await levelTree())
    mergePlayerDetails(a, details, [])

    const b = buildIndexes(await levelTree())
    mergePlayerDetails(b, [...details].reverse(), [])

    expect(a.containers).toEqual(b.containers)
    expect(a.charContainers).toEqual(b.charContainers)
    expect(a.stats.attributedExact).toBe(b.stats.attributedExact)
  })

  it('grounds the clock model', () => {
    // The finding the entire last-seen design rests on: the guild's
    // last_online_real_time is on the server-uptime clock, so the player who
    // was online when the save was written sits at the world uptime counter.
    // Exactly on it in the first reference save; 16 ms short of it in the
    // current one. Anything past a second either way means the model is
    // wrong, and this says so.
    const guild = index.guilds.find((g) => g.type === 'Guild')!
    const maxTick = Math.max(
      ...guild.members.map((m) => m.lastOnlineTicks ?? 0),
    )
    const TICKS_PER_SECOND = 10_000_000
    expect(Math.abs(index.meta.worldUptimeTicks! - maxTick)).toBeLessThan(
      TICKS_PER_SECOND,
    )
    expect(index.meta.savedAtTicks).toBeGreaterThan(
      index.meta.worldUptimeTicks!,
    )
  })

  it('prefers the absolute clock once every player file is loaded', () => {
    const byUid = new Map(details.map((d) => [d.playerUid, d]))
    expect(lastSeenBasis(index.players, byUid)).toBe('absolute')
    expect(lastSeenBasis(index.players, new Map())).toBe('uptime')

    const guild = index.guilds.find((g) => g.type === 'Guild')!
    let online = 0
    for (const player of index.players) {
      const member = guild.members.find((m) => m.playerUid === player.playerUid)
      const seen = lastSeenFor(
        player,
        byUid.get(player.playerUid),
        member,
        index.meta,
      )
      expect(seen.source).toBe('player-save')
      expect(seen.at).toBeInstanceOf(Date)
      expect(seen.at!.getUTCFullYear()).toBeGreaterThan(2020)
      if (seen.onlineAtSave) online++
    }
    // Exactly one player was connected when the level save was written.
    expect(online).toBe(1)

    // Without a detail, no absolute date may be invented from the uptime clock.
    const uptimeOnly = lastSeenFor(
      index.players[0]!,
      undefined,
      guild.members[0],
      index.meta,
    )
    expect(uptimeOnly.source).toBe('guild-uptime')
    expect(uptimeOnly.at).toBeUndefined()
  })

  it('keeps the payload small after merging', () => {
    // ~7.9 MB for the reference world; see the budget note in level.golden.
    expect(JSON.stringify(payload).length).toBeLessThan(10e6)
  })
})
