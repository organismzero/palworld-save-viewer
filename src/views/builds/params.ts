/**
 * What of the Builds view goes in a link: the purpose, its inputs, and whose
 * pals it is measured against.
 *
 * The opponent stays an opaque lowercased id for the same reason the Breed
 * view's target does — reference data arrives after `decode` runs, so checking
 * it here would reject every cold deep link.
 */

import { element } from '../../lib/color.ts'
import { owners } from '../breed/params.ts'
import type { Guid, SaveIndex } from '../../domain/types.ts'
import type { GoalId } from '../../domain/recommend.ts'
import { DEFAULT_CAKE, cakeRecipe } from '../../domain/recipes.ts'
import {
  bool,
  encodeList,
  list,
  resolveShortId,
  shortId,
  str,
  unresolved,
  type ParamCodec,
} from '../../app/viewParams.ts'

export interface BuildsParams {
  goal: GoalId
  /** Work type ids. Empty means the goal's own default set. */
  work: string[]
  /** Lowercased species id of the pal being fought. */
  opponent: string
  /** The opponent search box. */
  query: string
  /** Element names the opponent list is narrowed to. Empty means all. */
  elements: string[]
  /** Longer lists: more species and more of your own pals in each. */
  more: boolean
  /** The cake tier a cake base is for, by item id. */
  cake: string
  playerUid?: Guid
  /**
   * Whose pals count as "yours" beside the player's own. The same three
   * settings, under the same keys, as the Breed view's.
   */
  includeGuild: boolean
  includeBase: boolean
  includeMembers: Guid[]
}

export const BUILDS_DEFAULTS: BuildsParams = {
  goal: 'breeding',
  work: [],
  opponent: '',
  query: '',
  elements: [],
  more: false,
  cake: DEFAULT_CAKE,
  playerUid: undefined,
  includeGuild: false,
  includeBase: false,
  includeMembers: [],
}

const GOALS: readonly GoalId[] = [
  'breeding',
  'work',
  'fight',
  'travel',
  'fishing',
  'food',
  'cake',
  'ranch',
]

export function buildsCodec(index: SaveIndex): ParamCodec<BuildsParams> {
  return {
    encode(v, d) {
      const out: Record<string, string> = {}
      if (v.goal !== d.goal) out.g = v.goal
      if (v.work.length > 0) out.w = encodeList(v.work)
      if (v.opponent) out.vs = v.opponent
      if (v.query) out.q = v.query
      if (v.elements.length > 0) out.el = encodeList(v.elements)
      if (v.more) out.more = '1'
      if (v.cake !== d.cake) out.c = v.cake
      if (v.playerUid) out.p = shortId(v.playerUid)
      // `gp` means everything; the finer two only speak when it is off.
      if (v.includeGuild) out.gp = '1'
      else {
        if (v.includeBase) out.gb = '1'
        if (v.includeMembers.length > 0) {
          out.gm = encodeList(v.includeMembers.map(shortId))
        }
      }
      return out
    },
    decode(raw, d) {
      const goal = raw.get('g') as GoalId | null
      return {
        goal: goal && GOALS.includes(goal) ? goal : d.goal,
        work: [...new Set(list(raw, 'w'))].sort(),
        opponent: str(raw, 'vs', d.opponent).toLowerCase(),
        query: str(raw, 'q', d.query),
        elements: list(raw, 'el').flatMap((e) => element(e)?.name ?? []),
        more: bool(raw, 'more', d.more),
        // Checked against the typed-in recipes, which need no reference data.
        cake: cakeRecipe(str(raw, 'c', d.cake))?.item ?? d.cake,
        playerUid: resolveShortId(
          raw.get('p') ?? undefined,
          index.playerByUid.keys(),
        ),
        includeGuild: bool(raw, 'gp', d.includeGuild),
        includeBase: bool(raw, 'gb', d.includeBase),
        // Against everyone who owns a pal, as Breed resolves them, so a
        // departed member's palbox can still be named.
        includeMembers: list(raw, 'gm')
          .map((short) => resolveShortId(short, owners(index)))
          .filter((uid): uid is Guid => uid !== undefined),
      }
    },
    missing(raw) {
      return unresolved(raw, 'p', index.playerByUid.keys()) ? ['a player'] : []
    },
  }
}
