/**
 * What of the Breed view goes in a link.
 *
 * The whole point of this view is an answer worth sending someone, so all of it
 * travels: whose pals, whether the guild's pals are pooled in with them, which
 * target, which of the tied routes, and whether the gender assumption was
 * loosened.
 *
 * ## Why the target is not validated here
 *
 * `decode` runs on mount (`useViewParams`), and reference data arrives
 * asynchronously afterwards. Checking `t=faleris` against `Refdata.species` at
 * decode time would therefore reject *every* cold deep link, since the species
 * table is empty at that moment. So the target stays an opaque lowercased
 * string and the view reports "no species by that name" once the data is
 * actually there — the same shape as the Pals view's missing-selection note.
 */

import type { Guid, SaveIndex } from '../../domain/types.ts'
import {
  bool,
  resolveShortId,
  shortId,
  str,
  type ParamCodec,
} from '../../app/viewParams.ts'
import type { BreedPair } from '../../domain/breeding.ts'

export interface BreedParams {
  /** Whose pals to plan from. Absent means "the view's default choice". */
  playerUid?: Guid
  /** Lowercased asset id, unvalidated at decode time. */
  target: string
  /** The target search box. */
  query: string
  /** A pinned first pair, so an alternate route is linkable. */
  route?: BreedPair
  /** Count pals whose gender the save does not record. */
  assumeUnknownGender: boolean
  /** Pool the whole guild's pals, base workers included. */
  includeGuild: boolean
}

export const BREED_DEFAULTS: BreedParams = {
  playerUid: undefined,
  target: '',
  query: '',
  route: undefined,
  assumeUnknownGender: false,
  includeGuild: false,
}

export function breedCodec(index: SaveIndex): ParamCodec<BreedParams> {
  return {
    encode(v) {
      const out: Record<string, string> = {}
      // The fallback player is deliberately not encoded: only a choice the user
      // actually made belongs in a link they might send.
      if (v.playerUid) out.p = shortId(v.playerUid)
      if (v.target) out.t = v.target
      if (v.query) out.q = v.query
      if (v.route) out.r = `${v.route.a},${v.route.b}`
      if (v.assumeUnknownGender) out.ug = '1'
      // `gp`, not a bare `g` — that reads like a guild id, and the Guild view
      // already spends one. Cheap insurance against a future `g=<shortId>`.
      if (v.includeGuild) out.gp = '1'
      return out
    },

    decode(raw, d) {
      return {
        // Ambiguous prefixes resolve to nothing rather than to a guess, so a
        // link from another world plans from the default player instead of
        // silently from the wrong one.
        playerUid: resolveShortId(
          raw.get('p') ?? undefined,
          index.playerByUid.keys(),
        ),
        target: str(raw, 't', d.target).toLowerCase(),
        query: str(raw, 'q', d.query),
        route: parseRoute(raw.get('r')),
        assumeUnknownGender: bool(raw, 'ug', d.assumeUnknownGender),
        includeGuild: bool(raw, 'gp', d.includeGuild),
      }
    },
  }
}

/**
 * `r=aa,bb` to a pair.
 *
 * Exactly two non-empty parts or nothing. `serialiseParams` leaves commas
 * unescaped, which is what makes this readable in the address bar; the cost is
 * that a malformed value has to be rejected rather than half-read.
 */
function parseRoute(raw: string | null): BreedPair | undefined {
  if (!raw) return undefined
  const parts = raw.split(',')
  if (parts.length !== 2) return undefined
  const [a, b] = parts as [string, string]
  if (!a || !b) return undefined
  return { a: a.toLowerCase(), b: b.toLowerCase() }
}
