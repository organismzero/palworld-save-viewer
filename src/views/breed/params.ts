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
  encodeList,
  list,
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
  /** Pool the whole guild's pals, base workers and every member alike. */
  includeGuild: boolean
  /** Pool the ownerless base workers on their own. */
  includeBase: boolean
  /**
   * Pool these guildmates' palboxes, by player uid.
   *
   * Ignored when `includeGuild` is set — "all of them" is a standing intent
   * that should keep meaning all of them as the guild changes, not freeze into
   * whoever was a member when the link was written.
   */
  includeMembers: Guid[]
  /**
   * Passives the route has to deliver, as lowercased asset ids.
   *
   * Unvalidated here for the same reason the target is: reference data has not
   * arrived when `decode` runs, so checking a name against `Refdata.passives`
   * would reject every cold deep link. The domain caps the set at four — a pal's
   * slot count — and reports what it dropped rather than trimming quietly.
   */
  passives: string[]
  /**
   * Require the target to carry those passives and nothing else.
   *
   * Spares cost nothing to breed, and cost a slot afterwards — which is what a
   * passive breeding cannot supply has to be implanted into.
   */
  noSpares: boolean
}

export const BREED_DEFAULTS: BreedParams = {
  playerUid: undefined,
  target: '',
  query: '',
  route: undefined,
  assumeUnknownGender: false,
  includeGuild: false,
  includeBase: false,
  includeMembers: [],
  passives: [],
  noSpares: false,
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
      // `gp` still means everything, so a link written before these existed
      // keeps meaning what it meant. The finer two only speak when it is off.
      if (!v.includeGuild) {
        if (v.includeBase) out.gb = '1'
        if (v.includeMembers.length > 0) {
          out.gm = encodeList(v.includeMembers.map(shortId))
        }
      }
      // Sorted by `encodeList`, so the same selection made in two different
      // orders produces the same link.
      if (v.passives.length > 0) out.pv = encodeList(v.passives)
      // Meaningless without something to be exact about, so it does not travel
      // on its own — a bare `pvo=1` in a link would tick a box that does nothing.
      if (v.noSpares && v.passives.length > 0) out.pvo = '1'
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
        includeBase: bool(raw, 'gb', d.includeBase),
        // Resolved against everyone who *owns a pal*, not against the player
        // table. A departed member's pals keep their owner uid long after their
        // player record is gone, and those are exactly the palboxes worth
        // pooling — resolving against `playerByUid` silently dropped them, so a
        // link naming one came back unticked and the stock quietly shrank.
        // An id that matches none, or matches two, still resolves to nothing
        // rather than to a guess: a link from another save must not pool the
        // wrong person's palbox.
        includeMembers: list(raw, 'gm')
          .map((short) => resolveShortId(short, owners(index)))
          .filter((uid): uid is Guid => uid !== undefined),
        // Sorted to match `encodeList`, which sorts on the way out. Without
        // this the two disagree, and since the domain keeps only the first four
        // — a pal's slot count — a five-passive link would plan for one set now
        // and a different set after a reload.
        //
        // Deduped here rather than only in `wantedFrom`: the domain ignores a
        // repeat, but the picker renders one chip per entry, so `pv=a,a,a,a`
        // would draw four identical chips on four duplicate React keys and then
        // announce that the four-slot limit had been reached.
        passives: [...new Set(list(raw, 'pv').map((p) => p.toLowerCase()))].sort(),
        noSpares: bool(raw, 'pvo', d.noSpares),
      }
    },
  }
}

/**
 * Every uid that owns a pal in this world, plus every uid with a player record.
 *
 * The union matters in both directions: a departed member owns pals but has no
 * player record, and a member who owns none still has one.
 */
function owners(index: SaveIndex): Guid[] {
  return [
    ...new Set([...index.palsByOwner.keys(), ...index.playerByUid.keys()]),
  ]
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
