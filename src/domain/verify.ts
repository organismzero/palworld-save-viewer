/**
 * Does this file belong to the world that is open?
 *
 * Files arrive one gesture at a time — a level first, then its metadata, then
 * player saves one by one or a folder at a time, then a client save — so every
 * addition after the first has to be checked against what is already loaded.
 * Otherwise a file from a *different* world merges quietly and mis-attributes:
 * a foreign player save inflates "3 of 2 player saves" and puts a nameless row
 * in the progression table, and a foreign client save draws one world's fog over
 * another world's terrain.
 *
 * Each check is a pure function over the smallest shape that can answer it, so
 * the worker can run the one it needs against a `SlimPayload` while the main
 * thread runs the others against a built index, and the tests need neither.
 *
 * How much evidence exists is not the same for each kind, and pretending
 * otherwise would be the wrong kind of confidence:
 *
 * - A **player save** names its player, and the level lists its players. Exact.
 * - A **client save** names nobody, but its party presets hold pal instance ids
 *   that either resolve against this world or do not. Strong, unless it happens
 *   to have no presets, in which case there is nothing to go on.
 * - **World metadata** carries no world identity at all — a format version, a
 *   naive-clock timestamp, an in-game day, and a label that reads `"Autosave_W"`
 *   in every autosave. Nothing can be proved; the clock can only be found
 *   implausible.
 *
 * So two of these answer `true`/`false`, and the ones that can be undecidable
 * return `undefined` for "no evidence" rather than guessing at `false`.
 */

import type {
  Guid,
  LevelMetaPayload,
  OtomoPreset,
  Pal,
  Player,
} from './types.ts'

/**
 * Whether a player save's `PlayerUId` names someone in this world.
 *
 * A `false` covers two cases that are genuinely indistinguishable from the
 * files: a save from another world, and a save left behind by a player who has
 * since left this one. Neither can contribute anything attributable — their
 * container ids do not exist here either — so both are refused, and the message
 * says both.
 */
export function playerBelongs(
  players: readonly Pick<Player, 'playerUid'>[],
  uid: Guid,
): boolean {
  return players.some((p) => p.playerUid === uid)
}

/** What a client save's party presets say about which world it came from. */
export interface PresetOwnership {
  /** The owner every resolved preset pal agrees on, if they agree. */
  ownerUid?: Guid
  /** Pal ids the presets name at all. Zero means no evidence either way. */
  referenced: number
  /** How many of those ids are pals in this world. */
  resolved: number
}

/**
 * Resolves a client save's party presets against the world.
 *
 * Two answers out of one pass. **Whose client this is**: the file's own
 * `PlayerUId` fields are the zero GUID, but every pal in every preset carries an
 * instance id that resolves against the level save, and those pals have owners —
 * 30 of 30 in the reference save, all agreeing. Unanimity is the whole test: a
 * preset holding someone else's pal, or a stale id from before a trade, should
 * leave the owner blank rather than put the wrong name on somebody's
 * exploration.
 *
 * **And whether it is this world's client at all**, which is the same evidence
 * counted rather than collapsed. A pal that exists here but belongs to nobody —
 * a base worker in shared storage — still proves the world matches, so
 * `resolved` counts existence while `ownerUid` only considers ownership.
 */
export function resolvePresetOwner(
  presets: readonly OtomoPreset[],
  palById: ReadonlyMap<Guid, Pick<Pal, 'ownerPlayerUid'>>,
): PresetOwnership {
  const owners = new Set<Guid>()
  let referenced = 0
  let resolved = 0

  for (const preset of presets) {
    for (const id of preset.palIds) {
      referenced += 1
      const pal = palById.get(id)
      if (!pal) continue
      resolved += 1
      if (pal.ownerPlayerUid) owners.add(pal.ownerPlayerUid)
    }
  }

  return {
    ownerUid: owners.size === 1 ? [...owners][0] : undefined,
    referenced,
    resolved,
  }
}

/**
 * Whether a client save came from this world.
 *
 * `undefined` when its presets name no pals at all: a client that has never
 * saved a party gives nothing to check, and refusing a file for being empty
 * would be worse than reading it.
 */
export function localDataBelongs({
  referenced,
  resolved,
}: PresetOwnership): boolean | undefined {
  if (referenced === 0) return undefined
  return resolved > 0
}

/**
 * Whether world metadata describes an *earlier* save than the level it landed
 * on — which is as close to a match test as this file allows.
 *
 * Nothing in `LevelMeta.sav` identifies a world, so the only handle is its
 * clock. `savedAtTicks` and a pal's `ownedTime` are both naive .NET ticks from
 * the same unrecorded timezone, which is why the app can already say "caught
 * nine days before this save" exactly while refusing to turn either into a real
 * instant. Differences are safe, so this comparison is sound.
 *
 * A level cannot have been written *before* a capture it records, so metadata
 * older than the newest pal in the world is from an earlier snapshot — usually
 * an autosave folder, sometimes a different world altogether. `undefined` when
 * the metadata has no timestamp or the world holds no dated pals: there is
 * nothing to compare, and a missing comparison is not a pass.
 */
export function levelMetaPredatesWorld(
  meta: Pick<LevelMetaPayload, 'savedAtTicks'>,
  pals: readonly Pick<Pal, 'ownedTime'>[],
): boolean | undefined {
  const written = meta.savedAtTicks
  if (written === undefined || !Number.isFinite(written) || written <= 0) {
    return undefined
  }

  let newest = 0
  for (const pal of pals) {
    const owned = pal.ownedTime
    if (typeof owned === 'number' && Number.isFinite(owned) && owned > newest) {
      newest = owned
    }
  }
  if (newest === 0) return undefined

  return written < newest
}
