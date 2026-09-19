/**
 * What of the Builds view goes in a link: the purpose, its inputs, and whose
 * pals it is measured against.
 *
 * The opponent stays an opaque lowercased id for the same reason the Breed
 * view's target does — reference data arrives after `decode` runs, so checking
 * it here would reject every cold deep link.
 */

import type { Guid, SaveIndex } from '../../domain/types.ts'
import type { GoalId } from '../../domain/recommend.ts'
import {
  encodeList,
  list,
  resolveShortId,
  shortId,
  str,
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
  playerUid?: Guid
}

export const BUILDS_DEFAULTS: BuildsParams = {
  goal: 'breeding',
  work: [],
  opponent: '',
  query: '',
  playerUid: undefined,
}

const GOALS: readonly GoalId[] = ['breeding', 'work', 'fight', 'travel']

export function buildsCodec(index: SaveIndex): ParamCodec<BuildsParams> {
  return {
    encode(v, d) {
      const out: Record<string, string> = {}
      if (v.goal !== d.goal) out.g = v.goal
      if (v.work.length > 0) out.w = encodeList(v.work)
      if (v.opponent) out.vs = v.opponent
      if (v.query) out.q = v.query
      if (v.playerUid) out.p = shortId(v.playerUid)
      return out
    },
    decode(raw, d) {
      const goal = raw.get('g') as GoalId | null
      return {
        goal: goal && GOALS.includes(goal) ? goal : d.goal,
        work: [...new Set(list(raw, 'w'))].sort(),
        opponent: str(raw, 'vs', d.opponent).toLowerCase(),
        query: str(raw, 'q', d.query),
        playerUid: resolveShortId(
          raw.get('p') ?? undefined,
          index.playerByUid.keys(),
        ),
      }
    },
  }
}
