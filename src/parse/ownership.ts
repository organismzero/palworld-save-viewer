/**
 * Ownership inference for both container kinds.
 *
 * Neither section records an owner, so most attribution is deduced. Every
 * result carries a `confidence` so the UI can be honest about which is which,
 * and so that loading a per-player `.sav` later can supersede the guesses
 * without any of this needing to be reworked.
 *
 * ## Item containers (`ItemContainerSaveData`)
 *
 * Most are claimed outright by a map object through its `ItemContainer`
 * module — in a real save, 967 of 1,317. The rest are orphans: player
 * inventories, pal equipment and ground drops, whose owning records live in
 * `Players/<uid>.sav`, which `Level.sav` does not contain.
 *
 * ## Character containers (`CharacterContainerSaveData`)
 *
 * These hold pals, not items. A pal's `SlotId.ContainerId` points here, which
 * is what makes the majority vote possible: a palbox full of one player's pals
 * is that player's palbox. This is the step ported from PalworldSaveTools
 * `src/palworld_aio/inventory/container_ownership.py`.
 *
 * Note the two are *not* interchangeable — attributing item containers by pal
 * vote finds nothing at all, because no pal ever points at one.
 */

import type {
  Base,
  CharacterContainer,
  Container,
  Guid,
  Pal,
  PlayerContainerSlot,
  PlayerDetail,
  Structure,
} from '../domain/types.ts'
import type { Warnings } from './warnings.ts'

/** Share of the vote required before an owner is named. */
const PLURALITY_THRESHOLD = 0.6

export interface OwnershipResult {
  structureByContainer: Map<Guid, Guid>
  containerByStructure: Map<Guid, Guid>
}

/** Returns the modal key, if it clears the plurality threshold. */
function modal<K>(tally: Map<K, number>): K | undefined {
  let best: K | undefined
  let bestCount = 0
  let total = 0
  for (const [key, count] of tally) {
    total += count
    if (count > bestCount) {
      bestCount = count
      best = key
    }
  }
  return total > 0 && bestCount / total >= PLURALITY_THRESHOLD
    ? best
    : undefined
}

/** Mutates both container arrays in place. */
export function resolveOwnership(
  containers: Container[],
  charContainers: CharacterContainer[],
  structures: Structure[],
  bases: Base[],
  pals: Pal[],
): OwnershipResult {
  const structureByContainer = new Map<Guid, Guid>()
  const containerByStructure = new Map<Guid, Guid>()
  for (const s of structures) {
    if (!s.containerId) continue
    structureByContainer.set(s.containerId, s.instanceId)
    containerByStructure.set(s.instanceId, s.containerId)
  }

  /* --- item containers ------------------------------------------------- */

  for (const container of containers) {
    const structureId = structureByContainer.get(container.containerId)
    if (structureId) {
      container.ownerKind = 'structure'
      container.ownerId = structureId
      container.confidence = 'exact'
      continue
    }

    if (container.belongGroupId) {
      container.ownerKind = 'guild'
      container.ownerId = container.belongGroupId
      container.confidence = 'inferred'
      continue
    }

    // Single-slot containers are pal gear. Checked against ground truth from
    // the player saves: of 290 containers an earlier slot-shape rule labelled
    // "some player's inventory", only 26 actually were, and 262 of the hits
    // were exactly one slot. Real player main bags measure 10–41 slots, so the
    // old ">= 42 means a main inventory" test never fired on one at all.
    if (container.slotCount === 1) {
      container.ownerKind = 'pal'
      container.confidence = 'inferred'
      continue
    }

    container.ownerKind = 'unknown'
    container.confidence = 'inferred'
  }

  /* --- character containers -------------------------------------------- */

  const votes = new Map<Guid, Map<Guid, number>>()
  for (const pal of pals) {
    if (!pal.containerId || !pal.ownerPlayerUid) continue
    let tally = votes.get(pal.containerId)
    if (!tally) votes.set(pal.containerId, (tally = new Map()))
    tally.set(pal.ownerPlayerUid, (tally.get(pal.ownerPlayerUid) ?? 0) + 1)
  }

  const baseByWorkerContainer = new Map<Guid, Guid>()
  for (const b of bases) {
    if (b.workerContainerId)
      baseByWorkerContainer.set(b.workerContainerId, b.baseId)
  }

  for (const cc of charContainers) {
    const baseId = baseByWorkerContainer.get(cc.containerId)
    if (baseId) {
      // A base's worker roster is a hard link out of BaseCampSaveData.
      cc.ownerBaseId = baseId
      cc.confidence = 'exact'
      continue
    }

    // A slot that names its player is authoritative; most record a zero GUID.
    const slotOwner = cc.slots.find((s) => s.playerUid)?.playerUid
    if (slotOwner) {
      cc.ownerPlayerUid = slotOwner
      cc.confidence = 'exact'
      continue
    }

    const voted = modal(votes.get(cc.containerId) ?? new Map())
    if (voted) {
      cc.ownerPlayerUid = voted
      cc.confidence = 'inferred'
    }
  }

  return { structureByContainer, containerByStructure }
}

/**
 * Upgrades attribution using loaded player saves — and, just as importantly,
 * **withdraws** the guesses those saves disprove.
 *
 * Run after {@link resolveOwnership}, which must be re-run from scratch each
 * time rather than patched. That keeps the result a pure function of (level
 * payload, set of details) and therefore independent of the order player files
 * happen to arrive in. It costs one linear pass; the correctness is free.
 */
export function applyPlayerOwnership(
  containers: Container[],
  charContainers: CharacterContainer[],
  details: PlayerDetail[],
  playersInLevel: number,
  warn: Warnings,
): void {
  const byId = new Map(containers.map((c) => [c.containerId, c]))
  const charById = new Map(charContainers.map((c) => [c.containerId, c]))

  /** Every container any loaded player claims, and as which slot. */
  const claimed = new Set<Guid>()

  for (const detail of details) {
    for (const [slot, containerId] of Object.entries(detail.inventory) as [
      PlayerContainerSlot,
      Guid,
    ][]) {
      claimed.add(containerId)
      const container = byId.get(containerId)
      if (!container) continue

      if (container.ownerKind === 'structure') {
        // Two exact sources disagreeing is format drift, not noise. Keep the
        // structure link and say so loudly.
        warn.add(
          'ownership-conflict',
          'container claimed by both a structure and a player',
        )
        continue
      }

      container.ownerKind = 'player'
      container.ownerId = detail.playerUid
      container.ownerSlot = slot
      container.confidence = 'exact'
    }

    for (const [containerId, slot] of [
      [detail.palboxContainerId, 'palbox'],
      [detail.otomoContainerId, 'party'],
    ] as const) {
      if (!containerId) continue
      const cc = charById.get(containerId)
      if (!cc) continue

      if (cc.ownerPlayerUid && cc.ownerPlayerUid !== detail.playerUid) {
        // The majority vote is 20/20 correct on real data, so a disagreement
        // is genuinely news.
        warn.add(
          'ownership-conflict',
          'pal container vote disagrees with its player save',
        )
      }
      cc.ownerPlayerUid = detail.playerUid
      cc.ownerSlot = slot
      cc.confidence = 'exact'
    }
  }

  // Withdraw disproven guesses — but only once every player is accounted for.
  // With a partial set, an unclaimed container may simply belong to a player
  // whose file has not been loaded, and concluding otherwise would be wrong.
  if (details.length >= playersInLevel && playersInLevel > 0) {
    for (const container of containers) {
      if (
        container.ownerKind === 'player' &&
        container.confidence === 'inferred' &&
        !claimed.has(container.containerId)
      ) {
        container.ownerKind = 'unknown'
        container.ownerId = undefined
        container.ownerSlot = undefined
      }
    }
  }
}
