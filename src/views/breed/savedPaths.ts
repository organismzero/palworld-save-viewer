/**
 * Breeding paths kept for later: what one is, and how it is stored.
 *
 * A path is the Breed view's own link — the same query string `breedCodec`
 * writes into the address bar — plus a name. Nothing about the *answer* is
 * kept: the route is worked out again from whatever save is open, which is the
 * point. Load a newer save and every stored path shortens around what was
 * actually hatched since.
 *
 * ## Why it names its player
 *
 * A link leaves out the player when it is the view's default pick, on purpose:
 * only a choice somebody made is worth sending. A stored path cannot afford
 * that. The default is "whoever holds the most pals", which is not a stable
 * fact about a world, and a path that silently re-pointed at someone else
 * after a guildmate's good week would be planning from the wrong palbox.
 *
 * The player is also the only thing that says which world a path belongs to.
 * A save carries no world id and every level file is called `Level.sav`, so
 * "this path is for another world" can only be read as "its player is not in
 * this one".
 */

import { serialiseParams } from '../../app/viewParams.ts'
import { busiestPlayer } from '../../domain/guild.ts'
import type { Guid, SaveIndex } from '../../domain/types.ts'
import { BREED_DEFAULTS, breedCodec, type BreedParams } from './params.ts'
import type { PassiveText } from './passiveText.ts'
import type { SpeciesText } from './speciesText.ts'

export interface SavedPath {
  id: string
  name: string
  /** The Breed view's params, exactly as its link would carry them. */
  qs: string
  /** Whose pals it plans from. In full: this is what scopes it to a world. */
  playerUid: Guid
  /** Milliseconds since the epoch. */
  createdAt: number
}

/** Enough that the list never becomes the thing being managed. */
export const MAX_PATHS = 50

/** The Breed params a query string stands for, against this save. */
export function decodePath(qs: string, index: SaveIndex): BreedParams {
  return breedCodec(index).decode(new URLSearchParams(qs), BREED_DEFAULTS)
}

/** Whether there is anything here worth keeping. */
export function isSaveable(params: BreedParams): boolean {
  return params.mode === 'pair'
    ? params.pairA !== undefined && params.pairB !== undefined
    : params.target !== ''
}

/**
 * The one string a set of params is stored and compared as.
 *
 * Two things differ from the link in the address bar. The player is always
 * filled in, for the reason at the top of this file. And what does not belong
 * to the mode is dropped: the search box in both, and in pair mode the target
 * and passives left over from whatever was being planned before — otherwise
 * the same pair saved twice would be two different paths.
 */
export function canonicalPath(
  params: BreedParams,
  index: SaveIndex,
): { qs: string; playerUid: Guid } | undefined {
  const playerUid = params.playerUid ?? busiestPlayer(index)?.playerUid
  if (!playerUid || !isSaveable(params)) return undefined

  const kept: BreedParams =
    params.mode === 'pair'
      ? {
          ...params,
          playerUid,
          query: '',
          target: '',
          route: undefined,
          passives: [],
          noSpares: false,
        }
      : { ...params, playerUid, query: '' }

  return {
    qs: serialiseParams(breedCodec(index).encode(kept, BREED_DEFAULTS)),
    playerUid,
  }
}

/** `Anubis · Legend, Musclehead`, or `Anubis × Penking` for a pair. */
export function defaultName(
  params: BreedParams,
  index: SaveIndex,
  species: SpeciesText,
  passives: PassiveText,
): string {
  if (params.mode === 'pair') {
    const of = (id: Guid | undefined) => {
      const pal = id ? index.palById.get(id) : undefined
      return pal ? species.name(pal.characterId.toLowerCase()) : '?'
    }
    return `${of(params.pairA)} × ${of(params.pairB)}`
  }
  const target = species.name(params.target)
  if (params.passives.length === 0) return target
  return `${target} · ${params.passives.map(passives.name).join(', ')}`
}

/**
 * Whether a path is about the save that is open.
 *
 * Its player has a record here, or owns pals here — the second half is the
 * departed guildmate whose palbox is still in the world, the same case
 * `breedCodec` resolves `includeMembers` against.
 */
export function belongsHere(path: SavedPath, index: SaveIndex): boolean {
  return (
    index.playerByUid.has(path.playerUid) ||
    index.palsByOwner.has(path.playerUid)
  )
}

/* -------------------------------------------------------------------------
   Storage
   ------------------------------------------------------------------------- */

const VERSION = 1

export interface StoredPaths {
  paths: SavedPath[]
  /**
   * False when what is stored was written by a newer version of the app.
   *
   * The session snapshot throws an unreadable version away, because it can be
   * rebuilt from the file. These cannot: somebody named them. So they are left
   * exactly as found and nothing is written over them.
   */
  writable: boolean
}

function isPath(v: unknown): v is SavedPath {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.qs === 'string' &&
    typeof p.playerUid === 'string' &&
    typeof p.createdAt === 'number'
  )
}

export function parseStored(raw: string | null): StoredPaths {
  if (!raw) return { paths: [], writable: true }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    // Not JSON at all, so there is nothing of anybody's to protect.
    return { paths: [], writable: true }
  }
  if (typeof data !== 'object' || data === null) {
    return { paths: [], writable: true }
  }
  const { v, paths } = data as { v?: unknown; paths?: unknown }
  if (v !== VERSION) return { paths: [], writable: false }
  return {
    // A damaged entry is dropped on its own rather than taking the rest of the
    // list with it.
    paths: Array.isArray(paths) ? paths.filter(isPath) : [],
    writable: true,
  }
}

export function serialiseStored(paths: SavedPath[]): string {
  return JSON.stringify({ v: VERSION, paths })
}
