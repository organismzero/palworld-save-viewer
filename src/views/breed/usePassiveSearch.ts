/**
 * Runs the passive search in a worker, and says so while it does.
 *
 * A hook rather than a store because nothing outside the Breed view wants this,
 * and because a job with one caller does not need a subscription. The state it
 * owns is the whole contract: a result, whether one is being worked out, and
 * whether the last attempt failed.
 *
 * Restarting cancels: a superseded search is terminated rather than left to
 * finish and be thrown away, which matters when the one it superseded had four
 * passives and several seconds left to run.
 */

import { useEffect, useState } from 'react'

import type { Stock } from '../../domain/breeding.ts'
import {
  rehydrate,
  type PassiveReach,
} from '../../domain/passiveBreeding.ts'
import type { BreedingData } from '../../refdata/refdata.ts'
import type { SearchRequest, SearchResponse } from './search.worker.ts'

export interface PassiveSearch {
  reach?: PassiveReach
  /** A search is running. The result, if any, is for an older question. */
  pending: boolean
  /** The worker failed. The species plan is still perfectly good. */
  failed: boolean
  /** How long the last search took, for the diagnostics panel. */
  ms?: number
}

export function usePassiveSearch(
  stock: Stock,
  breeding: BreedingData | undefined,
  wanted: string[],
): PassiveSearch {
  // What the search was asked. Written down so the answer can carry it and
  // "still working" is derived rather than stored — there is no moment where a
  // stale result is presented as a fresh one, and no synchronous setState to
  // arrange it.
  //
  // The stock is part of the question by *identity*, not by a summary of its
  // settings. Whose pals and which flags are not enough: assembling a save a
  // file at a time grows the same player's roster without changing any of them,
  // and a summary key would leave the previous stock's answer on screen looking
  // current. `BreedView` memoises the stock, so identity is stable across
  // renders and changes exactly when the pals do.
  const key = wanted.join(',')
  const [answer, setAnswer] = useState<Answer>()
  const answered = answer?.key === key && answer.stock === stock

  // `stock` is in the dependencies, which is only safe because `BreedView`
  // memoises it — the view already has to, since `reachFrom` is keyed on it.
  // A caller that rebuilt it every render would restart the search every render.
  useEffect(() => {
    if (wanted.length === 0 || !breeding) return

    let live = true
    const worker = new Worker(new URL('./search.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (ev: MessageEvent<SearchResponse>) => {
      worker.terminate()
      if (!live) return
      const msg = ev.data
      setAnswer(
        msg.t === 'done'
          ? { key, stock, reach: rehydrate(msg.reach, stock), ms: msg.ms }
          : { key, stock, failed: true },
      )
    }
    worker.onerror = () => {
      worker.terminate()
      if (live) setAnswer({ key, stock, failed: true })
    }

    const request: SearchRequest = { stock, breeding, wanted }
    worker.postMessage(request)

    return () => {
      // Superseded, so terminate rather than let it finish into nothing. A
      // four-passive search left running would hold a core for seconds after
      // its answer stopped being wanted.
      live = false
      worker.terminate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stock, breeding])

  // Nothing asked, or nothing to ask it of. Neither is "working on it": with no
  // breeding data the view already says so, and a spinner beside that message
  // would promise an answer that is never coming.
  if (wanted.length === 0 || !breeding) return { pending: false, failed: false }

  const current = answered ? answer : undefined
  return {
    reach: current?.reach,
    // Nothing for this question yet, so a search is either running or about to
    // be. Either way the honest thing to show is that it is being worked out.
    pending: current === undefined,
    failed: current?.failed === true,
    ms: current?.ms,
  }
}

interface Answer {
  /** The passives asked for. */
  key: string
  /** The exact stock asked about — identity, so a changed roster invalidates. */
  stock: Stock
  reach?: PassiveReach
  failed?: boolean
  ms?: number
}
