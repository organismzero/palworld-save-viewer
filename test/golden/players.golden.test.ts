/**
 * Player-save ingestion against the real files in `data/Players/`.
 *
 * Self-skips when they are absent. The counts below were measured; they are
 * exact on purpose, because the whole value of this milestone is that guessed
 * attribution becomes exact and the numbers are how you can tell.
 *
 * **This suite must never read `*_dps.json`.** The one in the reference set is
 * 244 MB; reading it would blow the vitest heap and the failure would look
 * like something else entirely. `sniff` is what prevents that in the app, and
 * the enumeration here mirrors it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildIndexes,
  mergePlayerDetails,
} from '@/parse/worker/buildIndexes.ts'
import { readPlayerSave } from '@/parse/worker/readers/playerSave.ts'
import { buildSaveIndex } from '@/domain/index.ts'
import { lastSeenBasis, lastSeenFor } from '@/domain/lastSeen.ts'
import { Warnings } from '@/parse/warnings.ts'
import { looksLikeDpsName } from '@/parse/sniff.ts'
import type { PlayerDetail, SaveIndex, SlimPayload } from '@/domain/types.ts'

const LEVEL_JSON = resolve(process.cwd(), 'data/Level.json')
const PLAYERS_DIR = resolve(process.cwd(), 'data/Players')
const hasData = existsSync(LEVEL_JSON) && existsSync(PLAYERS_DIR)

const EXPECTED = {
  playerFiles: 10,
  dpsIgnored: 1,
  itemContainerLinks: 60,
  charContainerLinks: 20,
  linkMisses: 0,
  withTechnologyPoint: 9,
  platforms: { Steam: 6, PS5: 2, Xbox: 2 },
} as const

/** Mirrors `sniff`'s exclusion. Never stat-then-read a `_dps` file. */
function playerFilePaths(): string[] {
  return readdirSync(PLAYERS_DIR)
    .filter((f) => f.endsWith('.json') && !looksLikeDpsName(f))
    .sort()
    .map((f) => join(PLAYERS_DIR, f))
}

describe.skipIf(!hasData)('golden: player saves', () => {
  let details: PlayerDetail[]
  let before: SlimPayload['stats']
  let index: SaveIndex
  let payload: SlimPayload

  beforeAll(() => {
    const raw = JSON.parse(readFileSync(LEVEL_JSON, 'utf8'))
    payload = buildIndexes(raw, { source: 'json' })
    before = { ...payload.stats }

    const warn = new Warnings()
    details = playerFilePaths().map((p) =>
      readPlayerSave(
        JSON.parse(readFileSync(p, 'utf8')),
        p.split('/').pop()!,
        warn,
      ),
    )

    mergePlayerDetails(payload, details, [])
    index = buildSaveIndex(payload)
  })

  it('excludes the DPS storage file from enumeration', () => {
    const all = readdirSync(PLAYERS_DIR).filter((f) => f.endsWith('.json'))
    const dps = all.filter(looksLikeDpsName)
    expect(dps).toHaveLength(EXPECTED.dpsIgnored)
    expect(playerFilePaths()).toHaveLength(EXPECTED.playerFiles)

    // And it is genuinely enormous — this is why the exclusion matters.
    const bytes = statSync(join(PLAYERS_DIR, dps[0]!)).size
    expect(bytes).toBeGreaterThan(100e6)
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
    // Level alone can attribute 966 containers exactly (map objects claim
    // them) and guess at the rest. Adding the player files converts 60 of
    // those guesses into exact claims and halves what remains unattributed.
    //
    // Note the "before" numbers reflect the *current* heuristic — single-slot
    // containers as pal gear. An earlier slot-shape rule labelled 290
    // containers as some player's inventory, of which ground truth here shows
    // only 26 actually were, so it was replaced rather than kept as a
    // fallback. That rule is why an earlier estimate put this line at 60.
    expect(before.attributedExact).toBe(966)
    expect(before.unattributedContainers).toBe(88)

    expect(index.stats.attributedExact).toBe(1026)
    expect(index.stats.unattributedContainers).toBe(30)
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

  it('is independent of the order player files arrive in', () => {
    // This is what justifies re-deriving ownership from scratch on every merge
    // rather than patching incrementally.
    const forward = JSON.parse(readFileSync(LEVEL_JSON, 'utf8'))
    const a = buildIndexes(forward, { source: 'json' })
    mergePlayerDetails(a, details, [])

    const b = buildIndexes(JSON.parse(readFileSync(LEVEL_JSON, 'utf8')), {
      source: 'json',
    })
    mergePlayerDetails(b, [...details].reverse(), [])

    expect(a.containers).toEqual(b.containers)
    expect(a.charContainers).toEqual(b.charContainers)
    expect(a.stats.attributedExact).toBe(b.stats.attributedExact)
  })

  it('grounds the clock model', () => {
    // The finding the entire last-seen design rests on: the guild's
    // last_online_real_time is on the server-uptime clock, so its maximum is
    // exactly the world uptime counter. If a patch breaks this, the model is
    // wrong and this says so.
    const guild = index.guilds.find((g) => g.type === 'Guild')!
    const maxTick = Math.max(
      ...guild.members.map((m) => m.lastOnlineTicks ?? 0),
    )
    expect(maxTick).toBe(index.meta.worldUptimeTicks)
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
    expect(JSON.stringify(payload).length).toBeLessThan(2.5e6)
  })
})
