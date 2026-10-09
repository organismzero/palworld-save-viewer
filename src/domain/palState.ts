/**
 * What the save says about one pal beyond its stats: where it is kept, what
 * state it is in, and what it can do at a base.
 *
 * All of it was already parsed. None of it was on screen in one place: where a
 * pal is lived in Builds, its sickness was a pill with a raw enum name in it,
 * and its hunger and sanity were read from the file and then shown nowhere.
 * Pure, and free of reference data except where a name is needed, so the
 * drawer, the card, the filters and the export all ask the same questions and
 * get the same answers.
 */

import { speciesOf } from './names.ts'
import type { Refdata } from '../refdata/refdata.ts'
import type { Guid, Pal, SaveIndex } from './types.ts'

/* -------------------------------------------------------------------------
   Where it is kept
   ------------------------------------------------------------------------- */

export type Where = 'party' | 'palbox' | 'base' | 'dimensional' | 'unknown'

export interface PalPlace {
  where: Where
  /** The base whose roster it is on, when `where` is `base`. */
  baseId?: Guid
  /** Its slot in that container, zero-based, as the save numbers it. */
  slot?: number
}

/** A palbox page, in the game's own layout: six across, five down. */
export const PALBOX_PAGE = 30

/**
 * A page of Dimensional Pal Storage.
 *
 * Taken to be the palbox's: the storage file holds 9,600 slots, which is 320
 * pages of 30 exactly. The slot order is the file's own, and in the reference
 * save one player's stored pals sit in the first seventeen slots in descending
 * level — what the game's sort button leaves behind.
 */
export const STORAGE_PAGE = PALBOX_PAGE

/**
 * Where each pal is right now, as far as the save says.
 *
 * Built once per index. A worker roster is recognised from the base that points
 * at it, which is exact; party and palbox come from a player save naming its
 * containers, or failing that from the container's own inferred slot. Without
 * a player save most pals are `unknown`: `Level.sav` records which container a
 * pal is in, but not whose party or palbox that container is.
 */
export function placer(index: SaveIndex): (pal: Pal) => PalPlace {
  const workers = new Map<Guid, Guid>()
  for (const b of index.bases) {
    if (b.workerContainerId) workers.set(b.workerContainerId, b.baseId)
  }
  const party = new Set<Guid>()
  const palbox = new Set<Guid>()
  for (const p of index.playerDetails) {
    if (p.otomoContainerId) party.add(p.otomoContainerId)
    if (p.palboxContainerId) palbox.add(p.palboxContainerId)
  }

  return (pal) => {
    const slot = pal.slotIndex
    // Before the container: a stored pal is in none, and is not in the level
    // save for any of the tests below to find.
    if (pal.storage === 'dimensional') return { where: 'dimensional', slot }
    const id = pal.containerId
    if (!id) return { where: 'unknown' }
    if (workers.has(id)) {
      return { where: 'base', baseId: workers.get(id), slot }
    }
    if (party.has(id)) return { where: 'party', slot }
    if (palbox.has(id)) return { where: 'palbox', slot }
    const cc = index.charContainerById.get(id)
    if (cc?.ownerBaseId || cc?.ownerSlot === 'workers') {
      return { where: 'base', baseId: cc.ownerBaseId, slot }
    }
    if (cc?.ownerSlot === 'party') return { where: 'party', slot }
    if (cc?.ownerSlot === 'palbox') return { where: 'palbox', slot }
    return { where: 'unknown' }
  }
}

/** {@link placer}, for callers that only want the kind. */
export function locator(index: SaveIndex): (pal: Pal) => Where {
  const place = placer(index)
  return (pal) => place(pal).where
}

/**
 * A place in words: "Party · slot 2", "Palbox · page 3, slot 14", "Base 2 ·
 * near Desolate Church", "Dimensional storage · page 1, slot 9". Nothing for a pal whose container the save does not
 * explain; "unknown" in a row of facts reads as a fact.
 */
export function placeText(
  place: PalPlace,
  baseName: (id: Guid) => string | undefined,
): string | undefined {
  const { slot } = place
  switch (place.where) {
    case 'party':
      return slot === undefined ? 'Party' : `Party · slot ${slot + 1}`
    case 'palbox':
      return slot === undefined
        ? 'Palbox'
        : `Palbox · page ${Math.floor(slot / PALBOX_PAGE) + 1}, slot ${(slot % PALBOX_PAGE) + 1}`
    case 'base':
      return (place.baseId && baseName(place.baseId)) || 'A base'
    case 'dimensional':
      return slot === undefined
        ? 'Dimensional storage'
        : `Dimensional storage · page ${Math.floor(slot / STORAGE_PAGE) + 1}, slot ${(slot % STORAGE_PAGE) + 1}`
    case 'unknown':
      return undefined
  }
}

/**
 * Where in dimensional storage a pal is, or nothing for a pal that is not.
 *
 * For the places that have a pal and no index to hand: unlike every other
 * location this one is written on the pal itself.
 */
export function storedText(pal: Pal): string | undefined {
  return pal.storage === 'dimensional'
    ? placeText({ where: 'dimensional', slot: pal.slotIndex }, () => undefined)
    : undefined
}

/* -------------------------------------------------------------------------
   What state it is in
   ------------------------------------------------------------------------- */

export interface Condition {
  id: 'dying' | 'injured' | 'sick' | 'starving' | 'sanity'
  /** Short enough for a card: "dying", "sick", "starving". */
  label: string
  /** The save's own word for it, spaced: "Depression Sprain". */
  detail?: string
  tone: 'danger' | 'warn'
}

/**
 * Below this a pal's sanity is called out.
 *
 * Ours, not the game's: the save holds the number and the sicknesses low sanity
 * eventually causes, but not the point at which the game starts warning. Half
 * is where a base is plainly not keeping up; the number itself is always shown
 * beside the flag, so nobody has to take the line on trust.
 */
export const LOW_SANITY = 50

/** `DepressionSprain` to "Depression Sprain". */
export function spaced(enumTail: string): string {
  return enumTail.replace(/([a-z])([A-Z])/g, '$1 $2')
}

/**
 * Everything about a pal that wants doing something about, worst first.
 *
 * Empty for a healthy pal, which is nearly all of them: three with an injury
 * and two with a sickness among 3,963 in the reference save. That rarity is the
 * case for flagging them — nobody finds two sick pals in four thousand by
 * opening drawers.
 */
export function conditions(pal: Pal): Condition[] {
  const out: Condition[] = []
  if (pal.physicalHealth === 'Dying') {
    out.push({ id: 'dying', label: 'dying', tone: 'danger' })
  } else if (pal.physicalHealth) {
    out.push({
      id: 'injured',
      label: 'injured',
      detail: spaced(pal.physicalHealth),
      tone: 'warn',
    })
  }
  if (pal.sickness) {
    out.push({
      id: 'sick',
      label: 'sick',
      detail: spaced(pal.sickness),
      tone: 'danger',
    })
  }
  // Zero is the game's own boundary: a pal with an empty stomach is starving.
  // Anything above it cannot be called low without the species' maximum, which
  // the reference data does not carry.
  if (pal.fullStomach !== undefined && pal.fullStomach <= 0) {
    out.push({ id: 'starving', label: 'starving', tone: 'danger' })
  }
  if (pal.sanity !== undefined && pal.sanity < LOW_SANITY) {
    out.push({ id: 'sanity', label: 'low sanity', tone: 'warn' })
  }
  return out
}

/* -------------------------------------------------------------------------
   What it can do
   ------------------------------------------------------------------------- */

/**
 * Moves a pal has learned and is not using.
 *
 * A pal equips three and can have learned many more, from fruit or by
 * levelling. The save keeps both lists and `masteredWaza` includes the
 * equipped ones, so this is the difference.
 */
export function learnedNotEquipped(pal: Pal): string[] {
  return pal.masteredWaza.filter((w) => !pal.equipWaza.includes(w))
}

/**
 * A pal's level in a job: its species' level plus any the save has added.
 *
 * Zero when the species cannot do the job at all, whatever bonus is recorded.
 * The drawer used to add the two unconditionally, which would have invented a
 * job from a bonus alone; the save never does that (none of the 21 bonuses in
 * the reference save sits on a job its species lacks), so one rule serves both.
 */
export function workLevel(data: Refdata, pal: Pal, workId: string): number {
  const base = speciesOf(data, pal)?.work?.[workId] ?? 0
  if (base <= 0) return 0
  return base + (pal.workSuitabilityBonus[workId] ?? 0)
}
