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
  Guid,
  ItemStack,
  SaveIndex,
  Structure,
  Vec3,
} from './types.ts'
import type { Landmark } from '../refdata/refdata.ts'

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
  if (slots.length === 0) return columns
  const highest = Math.max(...slots.map((s) => s.slot))
  const rows = Math.ceil((highest + 1) / columns)
  return (rows + 1) * columns
}

/** Occupied slots by index, for rendering a grid with its gaps intact. */
export function slotsByIndex(slots: ItemStack[]): Map<number, ItemStack> {
  return new Map(slots.map((s) => [s.slot, s]))
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
