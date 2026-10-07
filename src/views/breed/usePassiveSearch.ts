/**
 * Runs the passive search in a worker, and says so while it does.
 *
 * A hook rather than a store because nothing outside the Breed view wants this,
 * and because a job with one caller does not need a subscription. The state it
 * owns is the whole contract: a result, whether one is being worked out, and
 * whether the last attempt failed or was called off.
 *
 * Restarting cancels: a superseded search is terminated rather than left to
 * finish and be thrown away, which matters when the one it superseded had four
 * passives and several seconds left to run.
 *
 * Finished answers are kept, per stock, so that coming back to a question —
 * another tab and back, one saved path and then the one before it — is a
 * lookup rather than the same seconds again. See `stockCache.ts` for why a
 * stock's identity is a sound thing to key that on.
 */

import { useEffect, useState } from 'react'

import type { Stock } from '../../domain/breeding.ts'
import { rehydrate, type PassiveReach } from '../../domain/passiveBreeding.ts'
import type { BreedingData } from '../../refdata/refdata.ts'
import type { SearchRequest, SearchResponse } from './search.worker.ts'
import { Recent } from './stockCache.ts'

export interface PassiveSearch {
  reach?: PassiveReach
  /** A search is running. The result, if any, is for an older question. */
  pending: boolean
  /** The worker failed. The species plan is still perfectly good. */
  failed: boolean
  /** The user called this search off. Nothing is running. */
  stopped: boolean
  /** How long the search took, when one finished. */
  ms?: number
  /** Stop the running search and leave the species plan showing. */
  cancel: () => void
  /** Run a search that was called off. */
  retry: () => void
}

/**
 * Answers to keep per stock. Each is a full reach table, which is the largest
 * thing the view holds, so this is a handful rather than everything ever asked.
 */
const ANSWERS_PER_STOCK = 4

const answers = new WeakMap<Stock, Recent<string, Answer>>()

function remember(answer: Answer) {
  let recent = answers.get(answer.stock)
  if (!recent) {
    answers.set(answer.stock, (recent = new Recent(ANSWERS_PER_STOCK)))
  }
  recent.set(answer.key, answer)
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
  // current. `stockFor` hands back one object per index and settings, so
  // identity is stable across renders and changes exactly when the pals do.
  const key = wanted.join(',')
  const [answer, setAnswer] = useState<Answer>()
  // Read on every render rather than held in state: it is a lookup, and it is
  // what makes a remembered answer show on the first frame instead of after a
  // flash of "working it out".
  const kept = answers.get(stock)?.peek(key)
  const fresh = answer?.key === key && answer.stock === stock
  const current = fresh ? answer : kept

  // Calling a search off is remembered against the question, like the answer
  // is, so asking something else is not also "stopped".
  const [stop, setStop] = useState<{ key: string; stock: Stock }>()
  const stopped = stop?.key === key && stop.stock === stock
  const answered = current !== undefined

  // `stock` is in the dependencies, which is only safe because `stockFor`
  // returns a stable one — the view already depends on that, since the reach is
  // keyed on it too.
  useEffect(() => {
    if (wanted.length === 0 || !breeding || answered || stopped) return

    let live = true
    const worker = new Worker(new URL('./search.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (ev: MessageEvent<SearchResponse>) => {
      worker.terminate()
      if (!live) return
      const msg = ev.data
      if (msg.t !== 'done') {
        // Not remembered: a failure is worth another try next time.
        setAnswer({ key, stock, failed: true })
        return
      }
      const done = {
        key,
        stock,
        reach: rehydrate(msg.reach, stock),
        ms: msg.ms,
      }
      remember(done)
      setAnswer(done)
    }
    worker.onerror = () => {
      worker.terminate()
      if (live) setAnswer({ key, stock, failed: true })
    }

    const request: SearchRequest = { stock, breeding, wanted }
    worker.postMessage(request)

    return () => {
      // Superseded or called off, so terminate rather than let it finish into
      // nothing. A four-passive search left running would hold a core for
      // seconds after its answer stopped being wanted.
      live = false
      worker.terminate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stock, breeding, answered, stopped])

  const cancel = () => setStop({ key, stock })
  const retry = () => setStop(undefined)

  // Nothing asked, or nothing to ask it of. Neither is "working on it": with no
  // breeding data the view already says so, and a spinner beside that message
  // would promise an answer that is never coming.
  if (wanted.length === 0 || !breeding) {
    return { pending: false, failed: false, stopped: false, cancel, retry }
  }

  return {
    reach: current?.reach,
    // Nothing for this question yet and nobody has called it off, so a search
    // is either running or about to be.
    pending: !answered && !stopped,
    failed: current?.failed === true,
    stopped: !answered && stopped,
    ms: current?.ms,
    cancel,
    retry,
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
