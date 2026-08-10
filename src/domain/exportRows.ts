/**
 * Column definitions for the CSV/JSON exports.
 *
 * These live with the domain rather than in the views for one reason: what a
 * row *means* is a domain question, and the same definitions have to serve two
 * formats. The views own where the button sits; this owns what comes out.
 *
 * ## Names, and the degraded case
 *
 * Every display name here resolves through reference data with a fall back to
 * the raw asset id. That is not defensive padding — reference data is fetched
 * from a CDN at runtime and the app has a designed `degraded` state where none
 * of it is available. An export that throws, or writes `undefined`, in that
 * state would be worse than one that writes `SheepBall` instead of `Lamball`.
 *
 * ## The casing trap
 *
 * `Refdata.species` and `Refdata.items` are keyed by **lowercased** asset id.
 * `Pal.characterId` and `ItemStack.staticId` are not lowercased. Every lookup
 * has to `.toLowerCase()`, and forgetting silently yields the raw id for every
 * row — which looks like working code with bad reference data rather than a
 * bug. Both helpers below do it in one place so no call site has to remember.
 */

import type { Column } from '../lib/export.ts'
import type { Refdata } from '../refdata/refdata.ts'
import { containerLocation, type ItemHit } from './bases.ts'
import { palName } from './palText.ts'
import { formatMapPos, posToMap } from './coords.ts'
import type { Container, Pal, SaveIndex } from './types.ts'

/** Species name for an asset id, or the id itself. Handles the casing. */
export function speciesName(refdata: Refdata | undefined, id: string): string {
  return refdata?.species[id.toLowerCase()]?.name ?? id
}

/** Item name for a static id, or the id itself. Handles the casing. */
export function itemName(refdata: Refdata | undefined, id: string): string {
  return refdata?.items[id.toLowerCase()]?.name ?? id
}

/* -------------------------------------------------------------------------
   Pals
   ------------------------------------------------------------------------- */

/**
 * One row per pal.
 *
 * Column order follows what someone opening this in a spreadsheet sorts by:
 * identity, then quality, then the housekeeping. `instanceId` is last because
 * it is never what you sort on but is the only thing that lets you join this
 * export back against another one.
 */
export function palColumns(
  index: SaveIndex,
  refdata: Refdata | undefined,
): Column<Pal>[] {
  const owner = (uid: string | undefined) =>
    uid ? (index.playerByUid.get(uid)?.name ?? uid) : ''

  return [
    { header: 'name', value: (p) => palName(p, refdata?.species[p.characterId.toLowerCase()]) }, // prettier-ignore
    { header: 'species', value: (p) => speciesName(refdata, p.characterId) },
    { header: 'species_id', value: (p) => p.characterId },
    { header: 'nickname', value: (p) => p.nickname },
    { header: 'level', value: (p) => p.level },
    { header: 'alpha', value: (p) => p.isBoss },
    { header: 'lucky', value: (p) => p.isRare },
    { header: 'gender', value: (p) => p.gender },
    { header: 'iv_hp', value: (p) => p.ivHp },
    { header: 'iv_attack', value: (p) => p.ivAttack },
    { header: 'iv_defense', value: (p) => p.ivDefense },
    { header: 'condenser_rank', value: (p) => p.rank },
    { header: 'rank_attack', value: (p) => p.rankAttack },
    { header: 'rank_defence', value: (p) => p.rankDefence },
    { header: 'rank_hp', value: (p) => p.rankHp },
    { header: 'rank_craft_speed', value: (p) => p.rankCraftSpeed },
    { header: 'hp', value: (p) => p.hp },
    // Semicolons, not commas: a comma here is legal CSV but forces the field
    // to be quoted and then reads as a column split in half by eye.
    { header: 'passives', value: (p) => p.passives.map((id) => passiveName(refdata, id)).join('; ') }, // prettier-ignore
    { header: 'owner', value: (p) => owner(p.ownerPlayerUid) },
    { header: 'guild', value: (p) => (p.groupId ? (index.guildById.get(p.groupId)?.name ?? '') : '') }, // prettier-ignore
    { header: 'sickness', value: (p) => p.sickness },
    { header: 'position', value: (p) => (p.pos ? formatMapPos(posToMap(p.pos)) : '') }, // prettier-ignore
    { header: 'instance_id', value: (p) => p.instanceId },
  ]
}

function passiveName(refdata: Refdata | undefined, id: string): string {
  return refdata?.passives[id.toLowerCase()]?.name ?? id
}

/* -------------------------------------------------------------------------
   Containers
   ------------------------------------------------------------------------- */

/** One row per *stack*, not per container — a container is not a rectangle. */
export interface ContainerStackRow {
  containerId: string
  where: string
  detail: string
  exact: boolean
  slot: number
  itemId: string
  item: string
  count: number
}

export function containerRows(
  index: SaveIndex,
  refdata: Refdata | undefined,
  containers: readonly Container[],
): ContainerStackRow[] {
  const structureName = (s: { mapObjectId: string }) => s.mapObjectId
  const baseName = () => 'Base'

  return containers.flatMap((c) => {
    const at = containerLocation(index, c, structureName, baseName)
    return c.slots.map((slot) => ({
      containerId: c.containerId,
      where: at.label,
      detail: at.detail ?? '',
      exact: at.exact,
      slot: slot.slot,
      itemId: slot.staticId,
      item: itemName(refdata, slot.staticId),
      count: slot.count,
    }))
  })
}

export const CONTAINER_COLUMNS: Column<ContainerStackRow>[] = [
  { header: 'item', value: (r) => r.item },
  { header: 'item_id', value: (r) => r.itemId },
  { header: 'count', value: (r) => r.count },
  { header: 'where', value: (r) => r.where },
  { header: 'detail', value: (r) => r.detail },
  // Whether the location is known or guessed travels with the row. Dropping it
  // would export an inference as a fact, which is the one thing the container
  // attribution model is careful never to do on screen.
  { header: 'location_exact', value: (r) => r.exact },
  { header: 'slot', value: (r) => r.slot },
  { header: 'container_id', value: (r) => r.containerId },
]

/* -------------------------------------------------------------------------
   Item search hits
   ------------------------------------------------------------------------- */

/** One row per place an item was found, flattened out of {@link ItemHit}. */
export interface ItemHitRow {
  item: string
  itemId: string
  total: number
  count: number
  where: string
  detail: string
  exact: boolean
  containerId: string
}

export function itemHitRows(
  index: SaveIndex,
  hits: readonly ItemHit[],
): ItemHitRow[] {
  const structureName = (s: { mapObjectId: string }) => s.mapObjectId
  const baseName = () => 'Base'

  return hits.flatMap((hit) =>
    hit.places.flatMap((place) => {
      const container = index.containerById.get(place.containerId)
      if (!container) return []
      const at = containerLocation(index, container, structureName, baseName)
      return [
        {
          item: hit.name,
          itemId: hit.staticId,
          total: hit.total,
          count: place.count,
          where: at.label,
          detail: at.detail ?? '',
          exact: at.exact,
          containerId: place.containerId,
        },
      ]
    }),
  )
}

export const ITEM_HIT_COLUMNS: Column<ItemHitRow>[] = [
  { header: 'item', value: (r) => r.item },
  { header: 'item_id', value: (r) => r.itemId },
  { header: 'count_here', value: (r) => r.count },
  { header: 'count_total', value: (r) => r.total },
  { header: 'where', value: (r) => r.where },
  { header: 'detail', value: (r) => r.detail },
  { header: 'location_exact', value: (r) => r.exact },
  { header: 'container_id', value: (r) => r.containerId },
]
