/**
 * Builds the main-thread `SaveIndex` from the worker's flat payload.
 *
 * The payload deliberately crosses the wire as plain arrays with GUID
 * cross-links — `Map`s and object references cost more to structured-clone and
 * cannot be cyclic. Rebuilding the lookup maps here takes a few milliseconds
 * for a full save, which is cheaper than shipping them.
 */

import type { Guid, Pal, SaveIndex, SlimPayload, Structure } from './types.ts'
import { looseEggsByFarm } from './looseEggs.ts'

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

/**
 * The inverse of {@link buildSaveIndex}: an index back down to its payload.
 *
 * The twelve `SlimPayload` keys, picked by name rather than by stripping the
 * derived ones. `SaveIndex extends SlimPayload` and adds nineteen `Map` fields;
 * anything that structured-clones an index — persisting it, or posting it to a
 * worker — would clone every one of them, tens of thousands of duplicated key
 * strings, and would silently pick up whatever derived field gets added next.
 *
 * Lives here rather than with either caller because it is the exact mirror of
 * the function below and the two have to stay in step.
 */
export function toSlim(index: SaveIndex): SlimPayload {
  return {
    pals: index.pals,
    players: index.players,
    guilds: index.guilds,
    bases: index.bases,
    structures: index.structures,
    containers: index.containers,
    charContainers: index.charContainers,
    dynamicItems: index.dynamicItems,
    dungeons: index.dungeons,
    playerDetails: index.playerDetails,
    stats: index.stats,
    meta: index.meta,
  }
}

export function buildSaveIndex(payload: SlimPayload): SaveIndex {
  const structureByContainer = new Map<Guid, Guid>()
  const containerByStructure = new Map<Guid, Guid>()
  for (const s of payload.structures) {
    if (!s.containerId) continue
    structureByContainer.set(s.containerId, s.instanceId)
    containerByStructure.set(s.instanceId, s.containerId)
  }

  // Eggs waiting on a Breeding Farm are folded into it — see `looseEggs.ts`.
  // Here and nowhere else: `payload` keeps each egg as the structure the save
  // says it is, and every lookup below answers as if the farm held them.
  const containerById = byId(payload.containers, (c) => c.containerId)
  const eggsByFarm = looseEggsByFarm(payload.structures)
  const looseEggFarm = new Map<Guid, Guid>()
  /** The eggs' own containers, which the farm's now speaks for. */
  const folded = new Set<Guid>()
  for (const [farmId, eggs] of eggsByFarm) {
    const farmContainerId = containerByStructure.get(farmId)
    const farmContainer = farmContainerId && containerById.get(farmContainerId)
    if (!farmContainer) continue
    // After whatever the farm holds itself, which is the cake.
    let slot = farmContainer.slots.reduce((n, s) => Math.max(n, s.slot + 1), 0)
    const slots = [...farmContainer.slots]
    for (const egg of eggs) {
      looseEggFarm.set(egg.instanceId, farmId)
      folded.add(egg.containerId!)
      // Asking where an egg's container is should lead to the farm.
      structureByContainer.set(egg.containerId!, farmId)
      const own = containerById.get(egg.containerId!)
      if (!own) continue
      for (const s of own.slots) slots.push({ ...s, slot: slot++ })
      // Emptied here, so that the egg is in one place and not two: anything
      // that adds up every container would otherwise count it twice.
      containerById.set(own.containerId, { ...own, slots: [] })
    }
    containerById.set(farmContainer.containerId, { ...farmContainer, slots })
  }
  const standing = (s: Structure) => !looseEggFarm.has(s.instanceId)

  // Inverted index powering global item search: "where are my Ancient
  // Civilization Parts?" resolves to a list rather than a scan.
  const containersByItem = new Map<
    string,
    { containerId: Guid; count: number }[]
  >()
  for (const listed of payload.containers) {
    if (folded.has(listed.containerId)) continue
    // The farm's, with its eggs, where it has any.
    const c = containerById.get(listed.containerId) ?? listed
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
    containerById,
    charContainerById: byId(payload.charContainers, (c) => c.containerId),
    dynamicItemById: byId(payload.dynamicItems, (d) => d.localId),

    palsByOwner: groupBy<Pal, Guid>(payload.pals, (p) => p.ownerPlayerUid),
    palsByContainer: groupBy<Pal, Guid>(payload.pals, (p) => p.containerId),
    palsByGuild: groupBy<Pal, Guid>(payload.pals, (p) => p.groupId),
    palsByCharacterId: groupBy<Pal, string>(payload.pals, (p) =>
      p.characterId.toLowerCase(),
    ),
    // Without the eggs: an egg on a farm is not something anybody built.
    structuresByBase: groupBy<Structure, Guid>(
      payload.structures.filter(standing),
      (s) => s.baseCampId,
    ),
    structuresByGuild: groupBy<Structure, Guid>(
      payload.structures.filter(standing),
      (s) => s.groupId,
    ),
    basesByGuild: groupBy(payload.bases, (b) => b.groupId),
    playersByGuild: groupBy(payload.players, (p) => p.groupId),

    containerByStructure,
    structureByContainer,
    containersByItem,
    looseEggsByFarm: eggsByFarm,
    looseEggFarm,
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

/**
 * Species histogram, most numerous first.
 *
 * `id` is the species as the save spells it — the first pal's spelling, where
 * a save has two — because it is shown as written when there is no reference
 * data to name it. Look it up in `palsByCharacterId` lowercased.
 */
export function speciesCounts(
  index: SaveIndex,
): { id: string; count: number }[] {
  return [...index.palsByCharacterId.values()]
    .map((pals) => ({ id: pals[0]!.characterId, count: pals.length }))
    .sort((a, b) => b.count - a.count)
}

/** Sum of a pal's three IVs, the usual quality shorthand. Absent IVs count 0. */
export function ivTotal(pal: Pal): number {
  return (pal.ivHp ?? 0) + (pal.ivAttack ?? 0) + (pal.ivDefense ?? 0)
}
