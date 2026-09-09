/**
 * The passive-aware breeding search, off the main thread.
 *
 * Not a precaution. `pnpm bench:passives` puts the search at ~135 ms for one
 * wanted passive and ten seconds or so for four on the reference save, and the growth is
 * the state space rather than a constant that could be tuned away — see the
 * module comment on `domain/passiveBreeding.ts` for the three prunings that were
 * measured and rejected. Seconds of that on the main thread is a frozen tab, so
 * it runs here and the view shows that it is working.
 *
 * One request, one response, then the worker is terminated — the same shape as
 * `refdata/tiles.worker.ts`, and for the same reason: this is a job, not a
 * service. Cancelling is terminating.
 *
 * The stock crosses the boundary whole. `domain/types.ts` requires a `Pal` to be
 * flat and structured-cloneable precisely so that it can, and the breeding table
 * is rebuilt here from its 67 KB of input rather than posted, because rebuilding
 * it costs less than copying it.
 */

import {
  buildBreedingTable,
  reachFrom,
  type Stock,
} from '../../domain/breeding.ts'
import {
  reachWithPassives,
  type PassiveReach,
} from '../../domain/passiveBreeding.ts'
import type { BreedingData } from '../../refdata/refdata.ts'

export interface SearchRequest {
  stock: Stock
  breeding: BreedingData
  wanted: string[]
}

export type SearchResponse =
  | { t: 'done'; reach: PassiveReach; ms: number }
  | { t: 'error'; message: string }

self.onmessage = (ev: MessageEvent<SearchRequest>) => {
  const { stock, breeding, wanted } = ev.data
  try {
    const started = performance.now()
    const table = buildBreedingTable(breeding)
    // Recomputed rather than posted: `Reach` carries a pair list per species,
    // which is far more to copy than the ~50 ms it costs to derive again.
    const reach = reachFrom(stock, table)
    const result = reachWithPassives(stock, table, reach, wanted)
    const done: SearchResponse = {
      t: 'done',
      reach: result,
      ms: performance.now() - started,
    }
    self.postMessage(done)
  } catch (err) {
    const failed: SearchResponse = {
      t: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(failed)
  }
}
