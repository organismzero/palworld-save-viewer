/**
 * What of the Pals view goes in a link, and how.
 *
 * Kept out of `PalsView.tsx` because that file is already 650 lines and this is
 * a self-contained contract: nine fields, their defaults, and their two
 * encodings. It is also the only part of deep linking worth testing in
 * isolation.
 *
 * ## What is deliberately absent
 *
 * `columns` is not here. It is not a preference and not user state — it is
 * re-measured from the scroll container's width on every scroll, so putting it
 * in a link would push the sender's window size onto the recipient for exactly
 * one frame before being corrected. A measurement is not something to share.
 */

import type { SaveIndex } from '../../domain/types.ts'
import {
  bool,
  encodeList,
  list,
  num,
  resolveShortId,
  shortId,
  str,
  unresolved,
  type ParamCodec,
} from '../../app/viewParams.ts'

export type SortKey =
  'iv' | 'level' | 'name' | 'species' | 'owner' | 'hp' | 'caught' | 'rarity'

const SORTS: readonly SortKey[] = [
  'iv',
  'level',
  'name',
  'species',
  'owner',
  'hp',
  'caught',
  'rarity',
]

/**
 * The two owners that are not a player.
 *
 * `none` is a pal nobody owns; `base` is one on a base's worker roster,
 * whoever caught it. Neither can collide with a real owner: those are GUIDs.
 */
export const OWNER_NONE = 'none'
export const OWNER_BASE = 'base'
const OWNER_SENTINELS: readonly string[] = [OWNER_NONE, OWNER_BASE]

export type GenderFilter = '' | 'Male' | 'Female'

export interface PalsParams {
  query: string
  elements: Set<string>
  minLevel: number
  /** Zero means no ceiling, so the default does not depend on the level cap. */
  maxLevel: number
  minIv: number
  /** A player uid, {@link OWNER_NONE}, {@link OWNER_BASE}, or empty. */
  owner: string
  gender: GenderFilter
  /** A work type id and the lowest level in it worth showing. */
  work: string
  workMin: number
  /** Only pals that are sick, injured, starving or low on sanity. */
  attention: boolean
  /** A party preset from the client's own save, by name. */
  preset: string
  flags: { boss: boolean; rare: boolean; named: boolean }
  sort: SortKey
  /** Each sort has a natural direction; this turns it over. */
  reversed: boolean
  selectedId?: string
}

export const PALS_DEFAULTS: PalsParams = {
  query: '',
  elements: new Set(),
  minLevel: 1,
  maxLevel: 0,
  minIv: 0,
  owner: '',
  gender: '',
  work: '',
  workMin: 1,
  attention: false,
  preset: '',
  flags: { boss: false, rare: false, named: false },
  sort: 'iv',
  reversed: false,
  selectedId: undefined,
}

/**
 * A codec bound to the save, because resolving a short id needs the id space.
 *
 * That makes its identity change whenever a player save merges, which is why
 * `useViewParams` reads it through a ref rather than as a dependency — a merge
 * re-decoding the hash would throw away whatever has been clicked since.
 */
export function palsCodec(index: SaveIndex): ParamCodec<PalsParams> {
  return {
    encode(v, d) {
      const out: Record<string, string> = {}
      if (v.query !== d.query) out.q = v.query
      if (v.elements.size) out.el = encodeList(v.elements)
      if (v.minLevel !== d.minLevel) out.lvl = String(v.minLevel)
      if (v.maxLevel !== d.maxLevel) out.max = String(v.maxLevel)
      if (v.minIv !== d.minIv) out.iv = String(v.minIv)
      if (v.owner !== d.owner) {
        out.owner = OWNER_SENTINELS.includes(v.owner)
          ? v.owner
          : shortId(v.owner)
      }
      if (v.gender) out.sex = v.gender === 'Male' ? 'm' : 'f'
      // One param for the pair: a minimum with no job means nothing, and two
      // params would let a link carry one without the other.
      if (v.work) out.job = `${v.work}:${v.workMin}`
      if (v.attention) out.att = '1'
      if (v.preset) out.pre = v.preset
      if (v.sort !== d.sort) out.sort = v.sort
      if (v.reversed) out.rev = '1'
      if (v.selectedId) out.sel = shortId(v.selectedId)

      // One param, not three booleans: three defaults to omit is three chances
      // for the encoder and decoder to disagree about what "off" looks like.
      const flags = (['boss', 'rare', 'named'] as const).filter(
        (k) => v.flags[k],
      )
      if (flags.length) out.f = flags.join(',')

      return out
    },

    decode(raw, d) {
      const flags = new Set(list(raw, 'f'))
      return {
        query: str(raw, 'q', d.query),
        elements: new Set(list(raw, 'el')),
        minLevel: num(raw, 'lvl', d.minLevel),
        maxLevel: Math.max(0, num(raw, 'max', d.maxLevel)),
        minIv: num(raw, 'iv', d.minIv),
        // Resolved against real players: a stale or truncated owner param
        // should filter by nothing rather than by a uid that matches no pal.
        owner:
          ownerSentinel(raw) ??
          resolveShortId(
            raw.get('owner') ?? undefined,
            index.playerByUid.keys(),
          ) ?? // prettier-ignore
          d.owner,
        gender:
          raw.get('sex') === 'm'
            ? 'Male'
            : raw.get('sex') === 'f'
              ? 'Female'
              : d.gender,
        ...job(raw, d),
        attention: bool(raw, 'att', d.attention),
        preset: str(raw, 'pre', d.preset),
        reversed: bool(raw, 'rev', d.reversed),
        flags: {
          boss: flags.has('boss'),
          rare: flags.has('rare'),
          named: flags.has('named'),
        },
        sort: SORTS.includes(raw.get('sort') as SortKey)
          ? (raw.get('sort') as SortKey)
          : d.sort,
        selectedId: resolveShortId(
          raw.get('sel') ?? undefined,
          index.palById.keys(),
        ),
      }
    },

    missing(raw) {
      const out: string[] = []
      if (
        !ownerSentinel(raw) &&
        unresolved(raw, 'owner', index.playerByUid.keys())
      ) {
        out.push('a player')
      }
      if (unresolved(raw, 'sel', index.palById.keys())) out.push('a pal')
      return out
    },
  }
}

function ownerSentinel(raw: URLSearchParams): string | undefined {
  const v = raw.get('owner')
  return v !== null && OWNER_SENTINELS.includes(v) ? v : undefined
}

/**
 * `job=Mining:3` to a work type and a minimum.
 *
 * The id is not checked against anything: the list of jobs is reference data,
 * which has not arrived when `decode` runs. A job nothing has simply matches no
 * pal, and the rail shows it selected, which is the honest reading of the link.
 */
function job(
  raw: URLSearchParams,
  d: PalsParams,
): Pick<PalsParams, 'work' | 'workMin'> {
  const [id, min] = (raw.get('job') ?? '').split(':')
  if (!id) return { work: d.work, workMin: d.workMin }
  const n = Number(min)
  return {
    work: id,
    workMin: Number.isFinite(n) && n >= 1 ? Math.floor(n) : d.workMin,
  }
}
