import { create } from 'zustand'

import {
  getTileSet,
  loadRefdata,
  refreshRefdata,
  type Refdata,
  type TileSet,
} from '../refdata/refdata.ts'
import type { TilesFromWorker } from '../refdata/tiles.worker.ts'

/**
 * `degraded` is a designed state, not an error path: the map falls back to a
 * coordinate grid and names fall back to raw asset ids, and everything stays
 * usable. Positions are computed locally and are exact either way.
 */
export type RefdataStatus = 'cold' | 'loading' | 'ready' | 'degraded'

interface RefdataState {
  status: RefdataStatus
  data?: Refdata
  tiles?: TileSet
  bakeLabel?: string
  ensure: (force?: boolean) => Promise<void>
  /**
   * Fetch the game data again and swap it in. Resolves to whether it worked;
   * a failure leaves whatever was loaded exactly as it was.
   */
  refresh: () => Promise<boolean>
}

let inFlight: Promise<void> | undefined

export const useRefdataStore = create<RefdataState>((set, get) => ({
  status: 'cold',

  async refresh() {
    try {
      const data = await refreshRefdata()
      // The tiles are the map art, cut once and keyed on the same version, so
      // they are kept; a degraded session that now has data still needs them.
      set({ data })
      if (get().status !== 'ready') await get().ensure(true)
      return true
    } catch {
      return false
    }
  },

  async ensure(force = false) {
    if (!force && (get().status === 'ready' || inFlight)) return inFlight
    inFlight = (async () => {
      set({ status: 'loading', bakeLabel: 'Loading game data' })
      try {
        const { data } = await loadRefdata()
        set({ data })

        let tiles = await getTileSet()
        if (!tiles) {
          set({ bakeLabel: 'Preparing map — this happens once' })
          tiles = await bakeTiles((label) => set({ bakeLabel: label }))
        }
        set({ status: 'ready', tiles, bakeLabel: undefined })
      } catch {
        // Offline, blocked, or the art moved. Still fully usable.
        set({ status: 'degraded', bakeLabel: undefined })
      } finally {
        inFlight = undefined
      }
    })()
    return inFlight
  },
}))

function bakeTiles(onLabel: (label: string) => void): Promise<TileSet> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../refdata/tiles.worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.onmessage = (ev: MessageEvent<TilesFromWorker>) => {
      const msg = ev.data
      if (msg.t === 'progress') return onLabel(msg.label)
      worker.terminate()
      if (msg.t === 'done') {
        resolve({ size: msg.size, tile: msg.tile, levels: msg.levels })
      } else {
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'tile bake failed'))
    }
    worker.postMessage({ t: 'bake' })
  })
}
