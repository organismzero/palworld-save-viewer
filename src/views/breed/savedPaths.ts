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
import type { BreedStep, BreedingPlan } from '../../domain/breeding.ts'
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
  /** How the route stood when this path was last looked at. */
  summary?: PathSummary
  /** Steps ticked off by hand, as {@link stepKey}s. */
  ticks?: string[]
}

/**
 * A route in four numbers, for the list.
 *
 * Kept rather than computed for the list because computing it is the whole
 * cost of the Breed view: a path with four passives is a ten-second search,
 * and a list of eight of them is not something to work out on opening a tray.
 * So each path remembers what it looked like when it was last on screen, and
 * says which save that was.
 */
export interface PathSummary {
  status: BreedingPlan['status']
  /** Eggs in the route. */
  steps: number
  /** Of those, how many are ticked off or already met by a held pal. */
  done: number
  /** Hatches to expect, when passives make that more than the egg count. */
  hatches?: number
  /** How many of the target the stock already holds. */
  owned: number
  /** The save's own timestamp, so a summary can say which save it describes. */
  savedAt?: number
  /** What the route was under the save before this one, if it has changed. */
  previous?: { steps: number; hatches?: number }
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

  // How the species list is filtered is not part of what is being bred.
  const list = {
    listElements: [],
    listReachable: false,
    listUnowned: false,
    listSort: 'paldex' as const,
  }
  const kept: BreedParams =
    params.mode === 'pair'
      ? {
          ...params,
          ...list,
          playerUid,
          query: '',
          target: '',
          route: undefined,
          passives: [],
          noSpares: false,
        }
      : { ...params, ...list, playerUid, query: '' }

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
   Progress
   ------------------------------------------------------------------------- */

/**
 * What a step is, in a form that survives the plan being worked out again.
 *
 * Not its number: steps are numbered in execution order, and a route that
 * shortens renumbers everything after the step that went. The egg, its two
 * parents and what it has to carry are what "I have done this one" refers to.
 * Parents are sorted because the planner does not promise which side is which.
 */
export function stepKey(step: BreedStep): string {
  const parents = [step.a.species, step.b.species].sort().join('+')
  const carries = [...(step.carries ?? [])].sort().join(',')
  return `${step.species}<${parents}#${carries}`
}

/** Ticks that still name a step in this plan. */
export function liveTicks(
  plan: BreedingPlan,
  ticks: readonly string[],
): string[] {
  const keys = new Set(plan.steps.map(stepKey))
  return ticks.filter((t) => keys.has(t))
}

/**
 * Sum a plan up for the list.
 *
 * `before` is the summary already stored. When it describes a different save
 * and the route has changed since, its numbers are kept as `previous` — that
 * difference is the progress, and the reason to look at the list at all.
 */
export function summarisePlan(
  plan: BreedingPlan,
  ticks: readonly string[],
  savedAt: number | undefined,
  before?: PathSummary,
): PathSummary {
  const ticked = new Set(ticks)
  const hatches =
    plan.expectedEggs !== undefined &&
    plan.expectedEggs > plan.steps.length + 0.5
      ? Math.round(plan.expectedEggs)
      : undefined

  const out: PathSummary = {
    status: plan.status,
    steps: plan.steps.length,
    done: plan.steps.filter(
      (s) => s.progress?.meets === true || ticked.has(stepKey(s)),
    ).length,
    owned: plan.ownedTarget.length,
  }
  if (hatches !== undefined) out.hatches = hatches
  if (savedAt !== undefined) out.savedAt = savedAt

  if (before) {
    const sameSave = before.savedAt === savedAt
    const moved = before.steps !== out.steps || before.hatches !== out.hatches
    // The same save again: whatever was being compared against still is.
    if (sameSave && before.previous) out.previous = before.previous
    else if (!sameSave && moved) {
      out.previous = { steps: before.steps }
      if (before.hatches !== undefined) out.previous.hatches = before.hatches
    }
  }
  return out
}

/** `4 eggs · 1 done · ≈38 hatches`, or what stands in for that. */
export function summaryText(s: PathSummary): string {
  if (s.status === 'unreachable') return 'no route from this stock'
  if (s.status !== 'plan') return 'not worked out'
  if (s.steps === 0) return s.owned > 0 ? 'already held' : 'nothing to breed'
  const parts = [`${s.steps} ${s.steps === 1 ? 'egg' : 'eggs'}`]
  if (s.done > 0) parts.push(`${s.done} done`)
  if (s.hatches !== undefined) parts.push(`≈${s.hatches} hatches`)
  return parts.join(' · ')
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

/** Keeps the optional fields only when they are the shape the app reads. */
function tidy(path: SavedPath): SavedPath {
  const { summary, ticks, ...rest } = path
  const out: SavedPath = rest
  if (Array.isArray(ticks)) {
    out.ticks = ticks.filter((t): t is string => typeof t === 'string')
  }
  if (
    typeof summary === 'object' &&
    summary !== null &&
    typeof summary.steps === 'number' &&
    typeof summary.done === 'number' &&
    typeof summary.owned === 'number' &&
    typeof summary.status === 'string'
  ) {
    out.summary = summary
  }
  return out
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
    paths: Array.isArray(paths) ? paths.filter(isPath).map(tidy) : [],
    writable: true,
  }
}

export function serialiseStored(paths: SavedPath[]): string {
  return JSON.stringify({ v: VERSION, paths })
}
