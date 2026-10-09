/**
 * Selectors for the base and inventory explorer.
 *
 * Three things live here because all three are decisions rather than lookups,
 * and every one of them is easier to test in isolation than through a view:
 *
 * 1. **Naming a base.** The save's own name is a Japanese placeholder, so a
 *    base is named by its nearest fast-travel landmark instead.
 * 2. **Sizing a container.** The save stores only occupied slots, so a
 *    container's real capacity is unknowable and has to be presented as a
 *    floor rather than a fact.
 * 3. **Attributing a container.** Only the 966 claimed by a structure are
 *    certain; the rest carry a confidence the UI has to keep visible.
 */

import type {
  Base,
  Container,
  DynamicItem,
  Guid,
  ItemStack,
  Pal,
  SaveIndex,
  Structure,
  Vec3,
} from './types.ts'
import type { Landmark } from '../refdata/refdata.ts'
import { baseWorkers } from './index.ts'
import { conditions, type Condition } from './palState.ts'

/* -------------------------------------------------------------------------
   Naming
   ------------------------------------------------------------------------- */

/**
 * The nearest fast-travel point to a world position.
 *
 * Squared distance in raw world space — the coordinate transform is a uniform
 * scale plus a translation, so ordering is identical in map space and a square
 * root would only cost time.
 */
export function nearestLandmark(
  landmarks: Landmark[] | undefined,
  pos: Vec3,
): Landmark | undefined {
  let best: Landmark | undefined
  let bestD = Infinity
  for (const l of landmarks ?? []) {
    const d = (l.x - pos.x) ** 2 + (l.y - pos.y) ** 2
    if (d < bestD) {
      bestD = d
      best = l
    }
  }
  return best
}

/**
 * A base's display name.
 *
 * `Base.rawName` is `新規生成拠点テンプレート名1(仮)` — "new base template
 * name 1 (provisional)" — for every base in every save, so it is never shown.
 * "Base 2 · near Sea Breeze Archipelago" is both more useful than the game's
 * own label and stable across reloads, which a position-derived name is not.
 *
 * Falls back to the ordinal alone when reference data is unavailable; the
 * degraded state must still name things.
 */
export function baseLabel(
  base: Base,
  ordinal: number,
  landmarks: Landmark[] | undefined,
): string {
  const near = nearestLandmark(landmarks, base.pos)
  return near ? `Base ${ordinal} · near ${near.name}` : `Base ${ordinal}`
}

/* -------------------------------------------------------------------------
   Storage
   ------------------------------------------------------------------------- */

export interface StorageTotals {
  /** Containers counted. */
  containers: number
  /** Occupied slots — stacks, not items. */
  stacks: number
  /** Total item count across every stack. */
  items: number
}

export function storageTotals(
  index: SaveIndex,
  containerIds: Iterable<Guid>,
): StorageTotals {
  const totals: StorageTotals = { containers: 0, stacks: 0, items: 0 }
  for (const id of containerIds) {
    const container = index.containerById.get(id)
    if (!container) continue
    totals.containers += 1
    totals.stacks += container.slots.length
    for (const slot of container.slots) totals.items += slot.count
  }
  return totals
}

/**
 * The slot grid a container should render into.
 *
 * **A container's capacity is not in the save.** Only occupied slots are
 * stored, and they carry their real `slot_index` — 29 of 1,317 containers in
 * the reference save have gaps, which is the proof that indices are positional
 * rather than sequential. So the highest occupied index plus one is a *floor*
 * on the capacity, never the capacity itself, and the UI has to say so.
 *
 * Rounded up to a whole row so the grid reads as a grid rather than a ragged
 * edge, and given one empty row of headroom so a nearly-full chest does not
 * look deceptively exactly full.
 */
export function slotGridSize(slots: ItemStack[], columns: number): number {
  let highest = -1
  for (const s of slots) {
    if (Number.isFinite(s.slot) && s.slot > highest) highest = s.slot
  }
  if (highest < 0) return columns
  const rows = Math.ceil((highest + 1) / columns)
  // The index is a raw i32 from the file and the grid draws one cell per slot,
  // so one stack claiming slot fifty million must not be taken at its word.
  return Math.min(
    (rows + 1) * columns,
    MAX_GRID_CELLS - (MAX_GRID_CELLS % columns),
  )
}

/**
 * The most cells a container grid will draw. Far above any real container —
 * the largest in the reference save has a few dozen slots.
 */
export const MAX_GRID_CELLS = 1200

/** Occupied slots by index, for rendering a grid with its gaps intact. */
export function slotsByIndex(slots: ItemStack[]): Map<number, ItemStack> {
  return new Map(slots.map((s) => [s.slot, s]))
}

/**
 * What a container holds, as the contents table lists it.
 *
 * One material fills many slots, so stacks of the same item are merged into one
 * row. A stack with a state of its own is not: two pickaxes at different wear
 * are two things, and adding them up would leave nowhere to say which is which.
 */
export interface ContentRow {
  staticId: string
  count: number
  /** Present when the row is a single stack that carries its own state. */
  dynamic?: DynamicItem
}

export function containerContents(
  index: SaveIndex,
  container: Container,
): ContentRow[] {
  const merged = new Map<string, ContentRow>()
  const single: ContentRow[] = []
  for (const slot of container.slots) {
    const dynamic = slot.dynamicLocalId
      ? index.dynamicItemById.get(slot.dynamicLocalId)
      : undefined
    if (dynamic && hasState(dynamic)) {
      single.push({ staticId: slot.staticId, count: slot.count, dynamic })
      continue
    }
    const row = merged.get(slot.staticId)
    if (row) row.count += slot.count
    else
      merged.set(slot.staticId, { staticId: slot.staticId, count: slot.count })
  }
  // Most of something first, as before; the single stacks keep slot order after
  // whatever outnumbers them, which for gear is nearly always everything.
  return [...merged.values(), ...single].sort((a, b) => b.count - a.count)
}

function hasState(d: DynamicItem): boolean {
  return d.durability !== undefined || !!d.ammo || d.passives.length > 0
}

/**
 * How much of an item's durability is left, 0 to 1.
 *
 * Only against the item's full value: a durability with no denominator is a
 * number, not a condition, so without reference data this is undefined.
 */
export function wearFraction(
  dynamic: DynamicItem | undefined,
  full: number | undefined,
): number | undefined {
  if (dynamic?.durability === undefined || !full) return undefined
  return Math.max(0, Math.min(1, dynamic.durability / full))
}

/* -------------------------------------------------------------------------
   Condition
   ------------------------------------------------------------------------- */

/** Below full hit points. A structure with no recorded maximum is not damaged. */
export function isDamaged(s: Structure): boolean {
  return (
    s.hpMax !== undefined && s.hpCurrent !== undefined && s.hpCurrent < s.hpMax
  )
}

/** Hit points left as a whole percentage, when the save records both halves. */
export function hpPercent(s: Structure): number | undefined {
  if (s.hpMax === undefined || s.hpCurrent === undefined || s.hpMax <= 0) {
    return undefined
  }
  return Math.round((s.hpCurrent / s.hpMax) * 100)
}

export interface BaseHealth {
  structures: number
  damaged: number
  /** Structures with a password set: chests, and doors. */
  locked: number
  workers: number
  /** Workers that are sick, hungry, hurt or low on sanity. */
  workersAiling: number
}

/** A worker with something wrong, and what. */
export interface AilingWorker {
  pal: Pal
  conditions: Condition[]
}

/** A base's workers that are sick, hurt, starving or low on sanity. */
export function ailingWorkers(index: SaveIndex, base: Base): AilingWorker[] {
  return baseWorkers(index, base.baseId).flatMap((pal) => {
    const found = conditions(pal)
    return found.length ? [{ pal, conditions: found }] : []
  })
}

export function baseHealth(index: SaveIndex, base: Base): BaseHealth {
  const structures = index.structuresByBase.get(base.baseId) ?? []
  const workers = baseWorkers(index, base.baseId)
  return {
    structures: structures.length,
    damaged: structures.filter(isDamaged).length,
    locked: structures.filter((s) => s.locked).length,
    workers: workers.length,
    workersAiling: ailingWorkers(index, base).length,
  }
}

/* -------------------------------------------------------------------------
   The structure list
   ------------------------------------------------------------------------- */

export interface StructureFilter {
  storageOnly: boolean
  /** A player uid, or empty for anyone. */
  builder: string
  damaged: boolean
  locked: boolean
}

export function filterStructures(
  structures: readonly Structure[],
  f: StructureFilter,
): Structure[] {
  return structures.filter(
    (s) =>
      (!f.storageOnly || !!s.containerId) &&
      (!f.builder || s.buildPlayerUid === f.builder) &&
      (!f.damaged || isDamaged(s)) &&
      (!f.locked || s.locked),
  )
}

export interface Builder {
  uid: Guid
  /** Undefined for a player the save has structures from but no record of. */
  name?: string
  count: number
}

/** Who built these, whoever built most first. */
export function buildersOf(
  index: SaveIndex,
  structures: readonly Structure[],
): Builder[] {
  const counts = new Map<Guid, number>()
  for (const s of structures) {
    if (!s.buildPlayerUid) continue
    counts.set(s.buildPlayerUid, (counts.get(s.buildPlayerUid) ?? 0) + 1)
  }
  return [...counts]
    .map(([uid, count]) => ({
      uid,
      name: index.playerByUid.get(uid)?.name,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.uid.localeCompare(b.uid))
}

/**
 * Storage, fullest first.
 *
 * "Full" is stacks held, not a share of capacity: capacity is not in the save
 * (see {@link slotGridSize}), so a percentage would be a share of a guess.
 */
export function byFullness(
  index: SaveIndex,
  structures: readonly Structure[],
): Structure[] {
  const held = (s: Structure) =>
    s.containerId
      ? (index.containerById.get(s.containerId)?.slots.length ?? 0)
      : -1
  return [...structures].sort(
    (a, b) => held(b) - held(a) || a.instanceId.localeCompare(b.instanceId),
  )
}

/* -------------------------------------------------------------------------
   Wear
   ------------------------------------------------------------------------- */

export interface WornItem {
  staticId: string
  dynamicId: Guid
  containerId: Guid
  slot: number
  durability: number
  full: number
  /** 0 to 1, of `full`. */
  fraction: number
}

/**
 * Every item in a container at or under `threshold` of its full durability,
 * worst first.
 *
 * `fullOf` is injected because the denominator is reference data: without it
 * nothing can be called worn, and this returns nothing rather than guessing.
 */
export function wornItems(
  index: SaveIndex,
  fullOf: (staticId: string) => number | undefined,
  threshold: number,
): WornItem[] {
  const out: WornItem[] = []
  for (const c of index.containers) {
    for (const slot of c.slots) {
      if (!slot.dynamicLocalId) continue
      const dynamic = index.dynamicItemById.get(slot.dynamicLocalId)
      const full = fullOf(slot.staticId)
      const fraction = wearFraction(dynamic, full)
      if (fraction === undefined || fraction > threshold) continue
      out.push({
        staticId: slot.staticId,
        dynamicId: slot.dynamicLocalId,
        containerId: c.containerId,
        slot: slot.slot,
        durability: dynamic!.durability!,
        full: full!,
        fraction,
      })
    }
  }
  return out.sort(
    (a, b) =>
      a.fraction - b.fraction ||
      a.containerId.localeCompare(b.containerId) ||
      a.slot - b.slot,
  )
}

/* -------------------------------------------------------------------------
   Attribution
   ------------------------------------------------------------------------- */

export interface ContainerLocation {
  /** One line naming where this container is. */
  label: string
  /** Qualifier — the base it sits in, or how the owner was guessed. */
  detail?: string
  structure?: Structure
  base?: Base
  exact: boolean
}

/**
 * Resolves a container to somewhere a person can go and look.
 *
 * This is what makes global item search worth having: "312 Wood" is noise,
 * "312 Wood in a Wooden Chest at Base 1" is an answer.
 */
export function containerLocation(
  index: SaveIndex,
  container: Container,
  structureName: (s: Structure) => string,
  baseName: (b: Base) => string,
): ContainerLocation {
  if (container.ownerKind === 'structure' && container.ownerId) {
    const structure = index.structureById.get(container.ownerId)
    if (structure) {
      const base = structure.baseCampId
        ? index.baseById.get(structure.baseCampId)
        : undefined
      return {
        label: structureName(structure),
        detail: base ? baseName(base) : 'out in the world',
        structure,
        base,
        exact: true,
      }
    }
  }

  if (container.ownerKind === 'player' && container.ownerId) {
    const player = index.playerByUid.get(container.ownerId)
    return {
      label: player ? `${player.name}'s inventory` : 'Player inventory',
      detail: container.ownerSlot,
      exact: container.confidence === 'exact',
    }
  }

  if (container.ownerKind === 'guild' && container.ownerId) {
    const guild = index.guildById.get(container.ownerId)
    return {
      label: guild ? `${guild.name} guild storage` : 'Guild storage',
      detail: 'from the container’s own guild link',
      exact: false,
    }
  }

  if (container.ownerKind === 'pal') {
    return {
      label: 'Pal equipment',
      detail: 'single-slot container',
      exact: false,
    }
  }

  return {
    label: 'Unattributed',
    detail: 'no map object, player or guild claims this',
    exact: false,
  }
}

/* -------------------------------------------------------------------------
   Global item search
   ------------------------------------------------------------------------- */

export interface ItemHit {
  staticId: string
  name: string
  /** Total count of this item across every container. */
  total: number
  /** Where it is, largest holding first. */
  places: { containerId: Guid; count: number }[]
}

/**
 * Finds every stack of everything matching `query`.
 *
 * Runs off the inverted index built with the save, so this is a scan of the
 * ~330 distinct item ids a save contains rather than of its 1,317 containers.
 *
 * `nameOf` is injected rather than read from a store so this stays a pure
 * function — and so it keeps working in the degraded state, where the only
 * name an item has is its raw asset id.
 */
export function searchItems(
  index: SaveIndex,
  query: string,
  nameOf: (staticId: string) => string,
  limit = 40,
): ItemHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const hits: ItemHit[] = []
  for (const [staticId, places] of index.containersByItem) {
    const name = nameOf(staticId)
    if (
      !name.toLowerCase().includes(q) &&
      !staticId.toLowerCase().includes(q)
    ) {
      continue
    }
    hits.push({
      staticId,
      name,
      total: places.reduce((sum, p) => sum + p.count, 0),
      places,
    })
  }

  // Ranked exact, then prefix, then anywhere — and only within a tier by how
  // much of it there is. Sorting by quantity alone buries the thing that was
  // actually typed: "PalSphere" would come back below "PalSphere_Giga" purely
  // because there is more of the latter.
  return hits
    .sort((a, b) => rank(a, q) - rank(b, q) || b.total - a.total)
    .slice(0, limit)
}

function rank(hit: ItemHit, q: string): number {
  const name = hit.name.toLowerCase()
  const id = hit.staticId.toLowerCase()
  if (name === q || id === q) return 0
  if (name.startsWith(q) || id.startsWith(q)) return 1
  return 2
}

/* -------------------------------------------------------------------------
   Where an item is, as places on a map
   ------------------------------------------------------------------------- */

export interface ItemPlace {
  containerId: Guid
  structure: Structure
  count: number
}

/**
 * The containers holding an item that stand somewhere.
 *
 * Only a container a structure claims has a position. What a player carries or
 * a guild stores has none, so those are counted and left off rather than drawn
 * at a guess.
 */
export function itemPlaces(
  index: SaveIndex,
  staticId: string,
): { places: ItemPlace[]; unplaced: number } {
  const places: ItemPlace[] = []
  let unplaced = 0
  for (const p of index.containersByItem.get(staticId) ?? []) {
    const structureId = index.structureByContainer.get(p.containerId)
    const structure = structureId
      ? index.structureById.get(structureId)
      : undefined
    if (structure) {
      places.push({ containerId: p.containerId, structure, count: p.count })
    } else unplaced += 1
  }
  return { places, unplaced }
}
