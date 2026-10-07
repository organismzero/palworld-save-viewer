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
 * bug. The helpers in `names.ts` do it in one place so no call site has to
 * remember.
 */

import type { Column } from '../lib/export.ts'
import type { Refdata } from '../refdata/refdata.ts'
import { containerLocation, type ItemHit } from './bases.ts'
import { WORK_TYPES } from '../lib/color.ts'
import { ticksToDate } from '../lib/format.ts'
import { ivTotal } from './index.ts'
import {
  baseNames,
  itemName,
  skillName,
  speciesName,
  structureName,
} from './names.ts'
import { placeText, placer, workLevel } from './palState.ts'
import { palName } from './palText.ts'
import { formatMapPos, posToMap } from './coords.ts'
import type { Container, ItemStack, Pal, SaveIndex } from './types.ts'

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
  const place = placer(index)
  const bases = baseNames(index, refdata)
  const elements = (p: Pal) => {
    const info = refdata?.species[p.characterId.toLowerCase()]
    return [info?.element1, info?.element2].filter(Boolean).join('; ')
  }
  const moves = (ids: string[]) =>
    ids.map((id) => skillName(refdata, id)).join('; ')

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
    { header: 'iv_total', value: (p) => ivTotal(p) },
    { header: 'elements', value: (p) => elements(p) },
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
    { header: 'health', value: (p) => p.physicalHealth },
    { header: 'hunger', value: (p) => p.fullStomach },
    // Left out of the save at full, so an empty cell here means 100.
    { header: 'sanity', value: (p) => p.sanity },
    { header: 'friendship', value: (p) => p.friendship },
    { header: 'current_work', value: (p) => p.currentWork },
    { header: 'caught', value: (p) => ticksToDate(p.ownedTime)?.toISOString() }, // prettier-ignore
    { header: 'location', value: (p) => placeText(place(p), (id) => bases.get(id)) }, // prettier-ignore
    { header: 'position', value: (p) => (p.pos ? formatMapPos(posToMap(p.pos)) : '') }, // prettier-ignore
    { header: 'moves_equipped', value: (p) => moves(p.equipWaza) },
    { header: 'moves_learned', value: (p) => moves(p.masteredWaza) },
    // One column per job, always all of them and always in the game's order,
    // so two exports line up whatever the pals in them can do. Empty without
    // reference data: a level is the species' plus the pal's, and the species'
    // half is not in the save.
    ...WORK_TYPES.map((t): Column<Pal> => ({
      header: `work_${t.id.toLowerCase()}`,
      value: (p) => (refdata ? workLevel(refdata, p, t.id) || '' : ''),
    })),
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
  /** Left on this stack, for an item that wears. */
  durability?: number
  /** The item's full durability, from reference data. */
  durabilityFull?: number
  /** Rounds loaded. */
  ammo?: number
  magazine?: number
}

/** A stack's own state, with the reference values it is read against. */
function stackState(
  index: SaveIndex,
  refdata: Refdata | undefined,
  slot: ItemStack,
) {
  const dynamic = slot.dynamicLocalId
    ? index.dynamicItemById.get(slot.dynamicLocalId)
    : undefined
  const info = refdata?.items[slot.staticId.toLowerCase()]
  const wears = dynamic?.durability !== undefined
  return {
    durability: wears ? Math.round(dynamic.durability!) : undefined,
    durabilityFull: wears ? info?.durability : undefined,
    ammo: dynamic?.ammo || undefined,
    magazine: dynamic?.ammo ? info?.magazine : undefined,
  }
}

/**
 * Where a container is, in the words the Bases view uses for it.
 *
 * The exports used to pass stubs here — the structure's asset id, and the
 * literal "Base" — so a file saved from a screen reading "Wooden Chest · Base 3
 * · near Sea Breeze Archipelago" said `Chest_Wood` and `Base`.
 */
function locator(index: SaveIndex, refdata: Refdata | undefined) {
  const bases = baseNames(index, refdata)
  return (c: Container) =>
    containerLocation(
      index,
      c,
      (s) => structureName(refdata, s),
      (b) => bases.get(b.baseId) ?? 'Base',
    )
}

export function containerRows(
  index: SaveIndex,
  refdata: Refdata | undefined,
  containers: readonly Container[],
): ContainerStackRow[] {
  const where = locator(index, refdata)

  return containers.flatMap((c) => {
    const at = where(c)
    return c.slots.map((slot) => ({
      containerId: c.containerId,
      where: at.label,
      detail: at.detail ?? '',
      exact: at.exact,
      slot: slot.slot,
      itemId: slot.staticId,
      item: itemName(refdata, slot.staticId),
      count: slot.count,
      ...stackState(index, refdata, slot),
    }))
  })
}

export const CONTAINER_COLUMNS: Column<ContainerStackRow>[] = [
  { header: 'item', value: (r) => r.item },
  { header: 'item_id', value: (r) => r.itemId },
  { header: 'count', value: (r) => r.count },
  // Empty for anything that does not wear or load, which is most things.
  { header: 'durability', value: (r) => r.durability },
  { header: 'durability_full', value: (r) => r.durabilityFull },
  { header: 'ammo', value: (r) => r.ammo },
  { header: 'magazine', value: (r) => r.magazine },
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
  /**
   * The most worn of this item in this place. A place can hold several, and
   * the one about to break is the one worth a row.
   */
  durabilityLowest?: number
  durabilityFull?: number
  /** Rounds loaded across every one of this item in this place. */
  ammo?: number
  where: string
  detail: string
  exact: boolean
  containerId: string
}

export function itemHitRows(
  index: SaveIndex,
  refdata: Refdata | undefined,
  hits: readonly ItemHit[],
): ItemHitRow[] {
  const where = locator(index, refdata)

  return hits.flatMap((hit) =>
    hit.places.flatMap((place) => {
      const container = index.containerById.get(place.containerId)
      if (!container) return []
      const at = where(container)
      const states = container.slots
        .filter((s) => s.staticId === hit.staticId)
        .map((s) => stackState(index, refdata, s))
      const worn = states.flatMap((s) =>
        s.durability === undefined ? [] : [s.durability],
      )
      const ammo = states.reduce((sum, s) => sum + (s.ammo ?? 0), 0)
      return [
        {
          item: hit.name,
          itemId: hit.staticId,
          total: hit.total,
          count: place.count,
          durabilityLowest: worn.length ? Math.min(...worn) : undefined,
          durabilityFull: states.find((s) => s.durabilityFull)?.durabilityFull,
          ammo: ammo || undefined,
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
  { header: 'durability_lowest', value: (r) => r.durabilityLowest },
  { header: 'durability_full', value: (r) => r.durabilityFull },
  { header: 'ammo', value: (r) => r.ammo },
  { header: 'where', value: (r) => r.where },
  { header: 'detail', value: (r) => r.detail },
  { header: 'location_exact', value: (r) => r.exact },
  { header: 'container_id', value: (r) => r.containerId },
]
