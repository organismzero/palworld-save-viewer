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

import type { Pal, SaveIndex } from '../../domain/types.ts'
import {
  encodeList,
  list,
  num,
  resolveShortId,
  shortId,
  str,
  type ParamCodec,
} from '../../app/viewParams.ts'

export type SortKey = 'iv' | 'level' | 'name' | 'caught' | 'rarity'

const SORTS: readonly SortKey[] = ['iv', 'level', 'name', 'caught', 'rarity']

export interface PalsParams {
  query: string
  elements: Set<string>
  minLevel: number
  minIv: number
  owner: string
  flags: { boss: boolean; rare: boolean; named: boolean }
  sort: SortKey
  selectedId?: string
}

export const PALS_DEFAULTS: PalsParams = {
  query: '',
  elements: new Set(),
  minLevel: 1,
  minIv: 0,
  owner: '',
  flags: { boss: false, rare: false, named: false },
  sort: 'iv',
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
      if (v.minIv !== d.minIv) out.iv = String(v.minIv)
      if (v.owner !== d.owner) out.owner = shortId(v.owner)
      if (v.sort !== d.sort) out.sort = v.sort
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
        minIv: num(raw, 'iv', d.minIv),
        // Resolved against real players: a stale or truncated owner param
        // should filter by nothing rather than by a uid that matches no pal.
        owner:
          resolveShortId(raw.get('owner') ?? undefined, index.playerByUid.keys()) ?? // prettier-ignore
          d.owner,
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
  }
}

/** Whether a link's `sel` named a pal this save does not have. */
export function selectionMissing(
  raw: string | undefined,
  resolved: Pal | undefined,
): boolean {
  return Boolean(raw) && !resolved
}
