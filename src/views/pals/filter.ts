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
import type { Guid, Pal, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import {
  OWNER_BASE,
  OWNER_NONE,
  type PalsParams,
  type SortKey,
} from './params.ts'

export interface FilterContext {
  index: SaveIndex
  /** Absent until reference data lands, and for good in degraded mode. */
  data: Refdata | undefined
  place: (pal: Pal) => PalPlace
  /** The pals in the chosen party preset, when one is chosen and known. */
  preset?: ReadonlySet<Guid>
}

export function filterPals(
  pals: readonly Pal[],
  params: PalsParams,
  { index, data, place, preset }: FilterContext,
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
    if (params.gender && p.gender !== params.gender) return false
    if (params.attention && conditions(p).length === 0) return false
    if (preset && !preset.has(p.instanceId)) return false

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

  const cmp: Record<SortKey, (a: Pal, b: Pal) => number> = {
    iv: (a, b) => ivTotal(b) - ivTotal(a),
    level: (a, b) => b.level - a.level,
    name: (a, b) =>
      palName(a, species(a)).localeCompare(palName(b, species(b))),
    species: (a, b) => speciesName(a).localeCompare(speciesName(b)),
    // Unowned pals last: an empty name would otherwise sort ahead of everyone.
    owner: (a, b) =>
      Number(!ownerName(a)) - Number(!ownerName(b)) ||
      ownerName(a).localeCompare(ownerName(b)),
    hp: (a, b) => (b.hp ?? 0) - (a.hp ?? 0),
    caught: (a, b) => (b.ownedTime ?? 0) - (a.ownedTime ?? 0),
    rarity: (a, b) => (species(b)?.rarity ?? 0) - (species(a)?.rarity ?? 0),
  }
  const by = cmp[params.sort]
  return out.sort(params.reversed ? (a, b) => by(b, a) : by)
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
    params.preset ||
    params.flags.boss ||
    params.flags.rare ||
    params.flags.named,
  )
}
