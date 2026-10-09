/**
 * Which pals the grid shows, and in what order.
 *
 * Out of `PalsView.tsx` so it can be tested: the view had grown eight filters
 * inline in a `useMemo`, and the only way to know one of them worked was to
 * load a save and look.
 */

import { ivTotal } from '../../domain/index.ts'
import { palName } from '../../domain/palText.ts'
import { conditions, workLevel, type PalPlace } from '../../domain/palState.ts'
import { serialiseParams, type ParamCodec } from '../../app/viewParams.ts'
import type { Guid, Pal, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import {
  OWNER_BASE,
  OWNER_NONE,
  PALS_DEFAULTS,
  type PalsParams,
  type SortKey,
} from './params.ts'

export interface FilterContext {
  index: SaveIndex
  /** Absent until reference data lands, and for good in degraded mode. */
  data: Refdata | undefined
  place: (pal: Pal) => PalPlace
}

export function filterPals(
  pals: readonly Pal[],
  params: PalsParams,
  { index, data, place }: FilterContext,
): Pal[] {
  const species = (p: Pal) => data?.species[p.characterId.toLowerCase()]
  const speciesName = (p: Pal) => species(p)?.name ?? p.characterId
  const ownerName = (p: Pal) =>
    (p.ownerPlayerUid && index.playerByUid.get(p.ownerPlayerUid)?.name) || ''

  const q = params.query.trim().toLowerCase()
  const { flags, elements, owner } = params

  const out = pals.filter((p) => {
    if (p.level < params.minLevel) return false
    if (params.maxLevel > 0 && p.level > params.maxLevel) return false
    if (ivTotal(p) < params.minIv) return false
    if (flags.boss && !p.isBoss) return false
    if (flags.rare && !p.isRare) return false
    if (flags.named && !p.nickname) return false
    if (flags.stored && !p.storage) return false
    if (params.gender && p.gender !== params.gender) return false
    if (params.attention && conditions(p).length === 0) return false

    if (owner === OWNER_NONE) {
      if (p.ownerPlayerUid) return false
    } else if (owner === OWNER_BASE) {
      if (place(p).where !== 'base') return false
    } else if (owner && p.ownerPlayerUid !== owner) {
      return false
    }

    // The two below come from reference data. Until it has arrived the test
    // cannot be made, and failing every pal for it would empty the grid and
    // say "no pals match" about a filter that had not been applied yet.
    if (elements.size && data) {
      const info = species(p)
      if (
        !(info?.element1 && elements.has(info.element1)) &&
        !(info?.element2 && elements.has(info.element2))
      ) {
        return false
      }
    }
    if (params.work && data) {
      if (workLevel(data, p, params.work) < params.workMin) return false
    }

    if (q) {
      // Passives by the name on the chip as well as by asset id: typing
      // "Artisan" used to find nothing, because the id is `CraftSpeed_up2`.
      const passives = p.passives
        .map((id) => `${id} ${data?.passives[id.toLowerCase()]?.name ?? ''}`)
        .join(' ')
      const hay = `${p.characterId} ${p.nickname ?? ''} ${speciesName(p)} ${passives}`
      if (!hay.toLowerCase().includes(q)) return false
    }
    return true
  })

  // One key per pal, worked out before the sort and not inside its comparator.
  // A comparator runs about n·log n times, and the name sorts each looked up a
  // species and built a display name on both sides of every comparison.
  const by = <K>(key: (pal: Pal) => K, cmp: (a: K, b: K) => number) =>
    sorted(out, key, cmp, params.reversed)
  const sorts: Record<SortKey, () => Pal[]> = {
    iv: () => by(ivTotal, descending),
    level: () => by((p) => p.level, descending),
    name: () => by((p) => palName(p, species(p)), collator.compare),
    species: () => by(speciesName, collator.compare),
    // Unowned pals last: an empty name would otherwise sort ahead of everyone.
    owner: () =>
      by(
        ownerName,
        (a, b) => Number(!a) - Number(!b) || collator.compare(a, b),
      ),
    hp: () => by((p) => p.hp ?? 0, descending),
    caught: () => by((p) => p.ownedTime ?? 0, descending),
    rarity: () => by((p) => species(p)?.rarity ?? 0, descending),
  }
  return sorts[params.sort]()
}

/**
 * One collator for every name comparison. With no locale and no options it
 * orders exactly as `String.prototype.localeCompare` does, which is what this
 * replaced, without resolving the locale again on each call.
 */
const collator = new Intl.Collator()

const descending = (a: number, b: number) => b - a

/** `pals` ordered by `cmp` over each one's `key`. Stable, as `sort` is. */
function sorted<K>(
  pals: Pal[],
  key: (pal: Pal) => K,
  cmp: (a: K, b: K) => number,
  reversed: boolean,
): Pal[] {
  const keyed = pals.map((pal) => ({ pal, key: key(pal) }))
  keyed.sort(
    reversed ? (a, b) => cmp(b.key, a.key) : (a, b) => cmp(a.key, b.key),
  )
  return keyed.map((k) => k.pal)
}

/** Whether anything is narrowing the grid. Sort and selection are not filters. */
export function isFiltered(params: PalsParams): boolean {
  return Boolean(
    params.query ||
    params.elements.size ||
    params.minLevel > 1 ||
    params.maxLevel > 0 ||
    params.minIv > 0 ||
    params.owner ||
    params.gender ||
    params.work ||
    params.attention ||
    params.flags.boss ||
    params.flags.rare ||
    params.flags.named ||
    params.flags.stored,
  )
}

/**
 * The pals a Pals link would show, by id, or nothing when it filters nothing.
 *
 * For the map, whose Pals layer follows the filter set on the Pals tab: the
 * question "where are my level 50 miners" is asked there and answered here, and
 * it should be one filter rather than two that happen to look alike. "Nothing"
 * is distinct from "everything" so the map can leave its layer alone, and say
 * nothing about a filter, when none is set.
 */
export function filteredPalIds(
  qs: string,
  codec: ParamCodec<PalsParams>,
  context: FilterContext,
): Set<Guid> | undefined {
  const params = codec.decode(new URLSearchParams(qs), PALS_DEFAULTS)
  if (!isFiltered(params)) return undefined
  return new Set(
    filterPals(context.index.pals, params, context).map((p) => p.instanceId),
  )
}

/**
 * The same link with its filter taken off.
 *
 * The sort and the open pal stay: they are not what narrowed the list, and
 * clearing a filter from another tab should not also close a drawer on this
 * one.
 */
export function unfiltered(qs: string, codec: ParamCodec<PalsParams>): string {
  const params = codec.decode(new URLSearchParams(qs), PALS_DEFAULTS)
  return serialiseParams(
    codec.encode(
      {
        ...PALS_DEFAULTS,
        sort: params.sort,
        reversed: params.reversed,
        selectedId: params.selectedId,
      },
      PALS_DEFAULTS,
    ),
  )
}
