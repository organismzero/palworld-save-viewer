/**
 * Turns a raw GVAS tree into the slim, transferable payload.
 *
 * The pass ordering below is not arbitrary — ownership resolution needs both
 * structures and pals, so it runs last.
 *
 * Everything here runs inside the worker. The raw tree (~170 MB for a real
 * save) never leaves it; what crosses to the UI is the ~1.8 MB result of this
 * function — a fortieth of the input.
 */

import type {
  PlayerDetail,
  SaveMeta,
  SaveWarning,
  SlimPayload,
} from '../../domain/types.ts'
import { applyPlayerOwnership, resolveOwnership } from '../ownership.ts'
import { Warnings } from '../warnings.ts'
import { readBases } from './readers/bases.ts'
import { readCharacters } from './readers/characters.ts'
import {
  readCharacterContainers,
  readDungeons,
  readDynamicItems,
  readItemContainers,
} from './readers/containers.ts'
import { readGuilds } from './readers/guilds.ts'
import { readMapObjects } from './readers/mapObjects.ts'

export type Phase =
  | 'decode'
  | 'json'
  /** Reading the GVAS binary — the `.sav` path's equivalent of `json`. */
  | 'gvas'
  | 'characters'
  | 'groups'
  | 'bases'
  | 'mapObjects'
  | 'containers'
  | 'link'
  | 'players'
  | 'merge'
  | 'done'

export interface BuildOptions {
  source: SaveMeta['source']
  onPhase?: (phase: Phase, label: string) => void
}

export function buildIndexes(raw: any, opts: BuildOptions): SlimPayload {
  const warn = new Warnings()
  const phase = (p: Phase, label: string) => opts.onPhase?.(p, label)

  const wsd = raw?.properties?.worldSaveData?.value
  if (!wsd) {
    throw new Error(
      'This does not look like a Palworld Level save: properties.worldSaveData is missing.',
    )
  }

  phase('characters', 'Reading pals and players')
  const { pals, players } = readCharacters(wsd.CharacterSaveParameterMap, warn)

  phase('groups', 'Reading guilds')
  const guilds = readGuilds(wsd.GroupSaveDataMap, warn)

  phase('bases', 'Reading bases')
  const bases = readBases(wsd.BaseCampSaveData, warn)

  phase('mapObjects', 'Reading structures')
  const structures = readMapObjects(wsd.MapObjectSaveData, warn)

  phase('containers', 'Reading inventories')
  const containers = readItemContainers(wsd.ItemContainerSaveData, warn)
  const charContainers = readCharacterContainers(
    wsd.CharacterContainerSaveData,
    warn,
  )
  const dynamicItems = readDynamicItems(wsd.DynamicItemSaveData, warn)
  const dungeons = readDungeons(wsd.DungeonSaveData)

  phase('link', 'Linking')
  const payload: SlimPayload = {
    pals,
    players,
    guilds,
    bases,
    structures,
    containers,
    charContainers,
    dynamicItems,
    dungeons,
    playerDetails: [],
    // Replaced wholesale by mergePlayerDetails below.
    stats: emptyStats(),
    meta: {
      engineVersion: raw?.header?.engine_version_branch,
      saveGameVersion: raw?.header?.save_game_version,
      savedAtTicks: raw?.properties?.Timestamp?.value,
      worldUptimeTicks:
        wsd.GameTimeSaveData?.value?.RealDateTimeTicks?.value ?? undefined,
      gameTimeTicks:
        wsd.GameTimeSaveData?.value?.GameDateTimeTicks?.value ?? undefined,
      source: opts.source,
    },
  }

  mergePlayerDetails(payload, [], warn.list())

  phase('done', 'Done')
  return payload
}

/**
 * Re-derives all ownership and statistics for a payload against a set of
 * player details.
 *
 * Called once during the level parse with an empty set, then again with the
 * full set every time player saves are merged. **Re-derived from scratch each
 * time rather than patched** — a linear pass over ~1,300 containers is
 * sub-millisecond, and doing it this way makes the result a pure function of
 * (payload, details), so it cannot depend on the order files arrived in.
 */
export function mergePlayerDetails(
  payload: SlimPayload,
  details: PlayerDetail[],
  /**
   * Warnings from the passes that are *not* re-run here: the level read and the
   * player-file reads. Anything this pass regenerates — ownership conflicts, and
   * every kind in `DERIVED_KINDS` — is filtered out of it below, or it would be
   * reported twice for the same underlying data.
   */
  carried: SaveWarning[],
): void {
  const warn = new Warnings()
  const {
    containers,
    charContainers,
    structures,
    bases,
    pals,
    players,
    guilds,
  } = payload

  // Reset anything the previous derivation wrote, so this really is a rebuild.
  for (const c of containers) {
    c.ownerKind = 'unknown'
    c.ownerId = undefined
    c.ownerSlot = undefined
    c.confidence = 'inferred'
  }
  for (const cc of charContainers) {
    cc.ownerPlayerUid = undefined
    cc.ownerBaseId = undefined
    cc.ownerSlot = undefined
    cc.confidence = 'inferred'
  }

  resolveOwnership(containers, charContainers, structures, bases, pals)
  applyPlayerOwnership(
    containers,
    charContainers,
    details,
    players.length,
    warn,
  )
  checkReferences(payload, warn)

  payload.playerDetails = details
  payload.stats = {
    characters: pals.length + players.length,
    pals: pals.length,
    players: players.length,
    species: new Set(pals.map((p) => p.characterId)).size,
    guilds: guilds.filter((g) => g.type === 'Guild').length,
    organizations: guilds.filter((g) => g.type === 'Organization').length,
    bases: bases.length,
    structures: structures.length,
    containers: containers.length,
    attributedExact: containers.filter((c) => c.confidence === 'exact').length,
    attributedInferred: containers.filter(
      (c) => c.confidence === 'inferred' && c.ownerKind !== 'unknown',
    ).length,
    unattributedContainers: containers.filter((c) => c.ownerKind === 'unknown')
      .length,
    orphanContainers: containers.filter((c) => c.ownerKind !== 'structure')
      .length,
    charContainers: charContainers.length,
    dynamicItems: payload.dynamicItems.length,
    dungeons: payload.dungeons.length,
    playerDetails: details.length,
    playersInLevel: players.length,
    warnings: [
      ...carried.filter((w) => !DERIVED_KINDS.has(w.kind)),
      ...warn.list(),
    ],
  }
}

function emptyStats(): SlimPayload['stats'] {
  return {
    characters: 0,
    pals: 0,
    players: 0,
    species: 0,
    guilds: 0,
    organizations: 0,
    bases: 0,
    structures: 0,
    containers: 0,
    attributedExact: 0,
    attributedInferred: 0,
    unattributedContainers: 0,
    orphanContainers: 0,
    charContainers: 0,
    dynamicItems: 0,
    dungeons: 0,
    playerDetails: 0,
    playersInLevel: 0,
    warnings: [],
  }
}

/**
 * Cross-reference check.
 *
 * These dangling-link counts are the early-warning system for a save format
 * change: if a patch moves where guild ids live, this lights up long before
 * anyone notices a half-empty screen.
 */
/**
 * The warning kinds `checkReferences` derives from the slim payload.
 *
 * They are recomputed on every merge, so a previous pass's copies must be
 * dropped rather than carried — otherwise a Players drop leaves the diagnostics
 * list saying "2× structure references an unknown item container" twice, once
 * from the level read and once from the merge, for the same two structures.
 */
const DERIVED_KINDS: ReadonlySet<SaveWarning['kind']> = new Set([
  'dangling-container',
  'dangling-group',
  'dangling-base',
])

function checkReferences(
  d: Pick<
    SlimPayload,
    'pals' | 'guilds' | 'bases' | 'structures' | 'containers' | 'charContainers'
  >,
  warn: Warnings,
): void {
  const guildIds = new Set(d.guilds.map((g) => g.groupId))
  const baseIds = new Set(d.bases.map((b) => b.baseId))
  const containerIds = new Set(d.containers.map((c) => c.containerId))
  const charContainerIds = new Set(d.charContainers.map((c) => c.containerId))

  for (const pal of d.pals) {
    if (pal.groupId && !guildIds.has(pal.groupId)) {
      warn.add(
        'dangling-group',
        'pal references a group that is not in the save',
      )
    }
    // A pal's SlotId points into CharacterContainerSaveData, never into the
    // item containers — checking it against the wrong set flags every pal.
    if (pal.containerId && !charContainerIds.has(pal.containerId)) {
      warn.add('dangling-container', 'pal references an unknown pal container')
    }
  }

  for (const s of d.structures) {
    if (s.baseCampId && !baseIds.has(s.baseCampId)) {
      warn.add('dangling-base', 'structure references a base not in the save')
    }
    if (s.containerId && !containerIds.has(s.containerId)) {
      warn.add(
        'dangling-container',
        'structure references an unknown item container',
      )
    }
  }

  for (const g of d.guilds) {
    for (const b of g.baseIds) {
      if (!baseIds.has(b)) {
        warn.add('dangling-base', 'guild references a base not in the save')
      }
    }
  }
}
