/**
 * What of the Bases view goes in a link.
 *
 * ## Why `selectedStructure` is not here
 *
 * It is derived. `locate()` already recovers both the source pane and the
 * structure from a container id, and encoding all three invites a URL whose
 * parts contradict each other — `src=world` next to a container that lives in
 * a base. One authoritative field, two derived ones.
 */

import type { Guid, SaveIndex } from '../../domain/types.ts'
import {
  bool,
  resolveShortId,
  shortId,
  str,
  type ParamCodec,
} from '../../app/viewParams.ts'

export type Source =
  { kind: 'base'; baseId: Guid } | { kind: 'world' } | { kind: 'unattributed' }

export interface BasesParams {
  source: Source
  containerId?: Guid
  /**
   * Real state, but **never encoded**.
   *
   * A structure with no storage can still be selected — that is how you read a
   * wall or a bed — so this cannot simply be derived from `containerId` at all
   * times. It *is* derived when decoding a link, because a URL carrying both
   * could contradict itself, and the container is the half worth keeping.
   */
  structureId?: Guid
  query: string
  /** Mirrors the "storage only" checkbox; encoded as `all=1` when off. */
  storageOnly: boolean
}

export const BASES_DEFAULTS: BasesParams = {
  source: { kind: 'world' },
  containerId: undefined,
  structureId: undefined,
  query: '',
  storageOnly: true,
}

export function basesCodec(index: SaveIndex): ParamCodec<BasesParams> {
  return {
    encode(v, d) {
      const out: Record<string, string> = {}
      if (v.source.kind === 'base') out.src = `base:${shortId(v.source.baseId)}`
      else if (v.source.kind === 'unattributed') out.src = 'orphans'
      else out.src = 'world'
      if (v.containerId) out.c = shortId(v.containerId)
      if (v.query !== d.query) out.q = v.query
      // The default is on, so the param records the departure from it.
      if (!v.storageOnly) out.all = '1'
      return out
    },

    decode(raw, d) {
      const src = raw.get('src')
      // No `src` at all means no preference has been expressed — open the
      // first base, as the view has always done. `encode` always writes one,
      // so an explicit "world" is a real choice and survives a round trip.
      const firstBase = index.bases[0]
      let source: Source = firstBase
        ? { kind: 'base', baseId: firstBase.baseId }
        : d.source

      if (src === 'orphans') source = { kind: 'unattributed' }
      else if (src === 'world') source = { kind: 'world' }
      else if (src?.startsWith('base:')) {
        const baseId = resolveShortId(src.slice(5), index.baseById.keys())
        // A base that is not in this save falls back rather than showing an
        // empty pane titled after something that does not exist.
        if (baseId) source = { kind: 'base', baseId }
      }

      const containerId = resolveShortId(
        raw.get('c') ?? undefined,
        index.containerById.keys(),
      )

      return {
        source,
        containerId,
        // Derived on the way in, so a link cannot claim a structure that does
        // not hold the container beside it.
        structureId: containerId
          ? index.structureByContainer.get(containerId)
          : undefined,
        query: str(raw, 'q', d.query),
        storageOnly: !bool(raw, 'all', false),
      }
    },
  }
}
