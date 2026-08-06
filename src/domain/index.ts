/**
 * Builds the main-thread `SaveIndex` from the worker's flat payload.
 *
 * The payload deliberately crosses the wire as plain arrays with GUID
 * cross-links — `Map`s and object references cost more to structured-clone and
 * cannot be cyclic. Rebuilding the lookup maps here takes a few milliseconds
 * for a full save, which is cheaper than shipping them.
 */

import type { Guid, Pal, SaveIndex, SlimPayload, Structure } from './types.ts'

function groupBy<T, K>(
  items: T[],
  key: (item: T) => K | undefined,
): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    if (k === undefined) continue
    const bucket = out.get(k)
    if (bucket) bucket.push(item)
    else out.set(k, [item])
  }
  return out
}

function byId<T>(items: T[], key: (item: T) => Guid): Map<Guid, T> {
  const out = new Map<Guid, T>()
  for (const item of items) out.set(key(item), item)
  return out
}

export function buildSaveIndex(payload: SlimPayload): SaveIndex {
  const structureByContainer = new Map<Guid, Guid>()
  const containerByStructure = new Map<Guid, Guid>()
  for (const s of payload.structures) {
    if (!s.containerId) continue
    structureByContainer.set(s.containerId, s.instanceId)
    containerByStructure.set(s.instanceId, s.containerId)
  }

  // Inverted index powering global item search: "where are my Ancient
  // Civilization Parts?" resolves to a list rather than a scan.
  const containersByItem = new Map<
    string,
    { containerId: Guid; count: number }[]
  >()
  for (const c of payload.containers) {
    for (const slot of c.slots) {
      const rows = containersByItem.get(slot.staticId)
      const row = rows?.find((r) => r.containerId === c.containerId)
      if (row) row.count += slot.count
      else if (rows)
        rows.push({ containerId: c.containerId, count: slot.count })
      else
        containersByItem.set(slot.staticId, [
          { containerId: c.containerId, count: slot.count },
        ])
    }
  }
  for (const rows of containersByItem.values())
    rows.sort((a, b) => b.count - a.count)

  return {
    ...payload,

    palById: byId(payload.pals, (p) => p.instanceId),
    playerByUid: byId(payload.players, (p) => p.playerUid),
    guildById: byId(payload.guilds, (g) => g.groupId),
    baseById: byId(payload.bases, (b) => b.baseId),
    structureById: byId(payload.structures, (s) => s.instanceId),
    containerById: byId(payload.containers, (c) => c.containerId),
    charContainerById: byId(payload.charContainers, (c) => c.containerId),
    dynamicItemById: byId(payload.dynamicItems, (d) => d.localId),

    palsByOwner: groupBy<Pal, Guid>(payload.pals, (p) => p.ownerPlayerUid),
    palsByContainer: groupBy<Pal, Guid>(payload.pals, (p) => p.containerId),
    palsByGuild: groupBy<Pal, Guid>(payload.pals, (p) => p.groupId),
    palsByCharacterId: groupBy<Pal, string>(payload.pals, (p) => p.characterId),
    structuresByBase: groupBy<Structure, Guid>(
      payload.structures,
      (s) => s.baseCampId,
    ),
    structuresByGuild: groupBy<Structure, Guid>(
      payload.structures,
      (s) => s.groupId,
    ),
    basesByGuild: groupBy(payload.bases, (b) => b.groupId),
    playersByGuild: groupBy(payload.players, (p) => p.groupId),

    containerByStructure,
    structureByContainer,
    containersByItem,
  }
}

/* -------------------------------------------------------------------------
   Selectors
   ------------------------------------------------------------------------- */

/** The real player guilds, largest first. Empty Organizations are excluded. */
export function playerGuilds(index: SaveIndex) {
  return index.guilds
    .filter((g) => g.type === 'Guild')
    .sort((a, b) => b.memberCount - a.memberCount)
}

/** Bookkeeping groups, which the dashboard hides unless asked for. */
export function systemGroups(index: SaveIndex) {
  return index.guilds.filter((g) => g.type !== 'Guild')
}

/** Pals assigned to a base's worker roster. */
export function baseWorkers(index: SaveIndex, baseId: Guid): Pal[] {
  const base = index.baseById.get(baseId)
  if (!base?.workerContainerId) return []
  return index.palsByContainer.get(base.workerContainerId) ?? []
}

/** Species histogram, most numerous first. */
export function speciesCounts(
  index: SaveIndex,
): { id: string; count: number }[] {
  return [...index.palsByCharacterId.entries()]
    .map(([id, pals]) => ({ id, count: pals.length }))
    .sort((a, b) => b.count - a.count)
}

/** Sum of a pal's three IVs, the usual quality shorthand. Absent IVs count 0. */
export function ivTotal(pal: Pal): number {
  return (pal.ivHp ?? 0) + (pal.ivAttack ?? 0) + (pal.ivDefense ?? 0)
}
