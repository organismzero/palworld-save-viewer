/**
 * Messages exchanged with the parse worker. Imported by both sides, so it must
 * stay free of anything that cannot run in a worker.
 */

import type { Guid, SlimPayload } from '../../domain/types.ts'
import type { Phase } from './buildIndexes.ts'

export type { Phase } from './buildIndexes.ts'

export type ToWorker =
  /** Raw file bytes; transfer the buffer so this costs nothing to send. */
  | { t: 'parseJson'; id: number; buf: ArrayBuffer }
  /**
   * A whole folder's worth of player saves in one message. Batched so a
   * ten-file drop costs one payload round-trip rather than ten.
   */
  | {
      t: 'parsePlayerJson'
      id: number
      files: { fileName: string; buf: ArrayBuffer }[]
    }
  /** Raw `.sav`: decompressed and read as GVAS in the worker. */
  | { t: 'parseSav'; id: number; buf: ArrayBuffer }
  | {
      t: 'parsePlayerSav'
      id: number
      files: { fileName: string; buf: ArrayBuffer }[]
    }
  /** Lazily pull a raw subtree for the debug inspector, without re-parsing. */
  | { t: 'query'; id: number; path: string[] }
  /** Release the retained raw tree under memory pressure. */
  | { t: 'dropRaw' }

export interface PlayerFileReport {
  fileName: string
  uid?: Guid
  ok: boolean
  reason?: string
}

export type FromWorker =
  | { t: 'progress'; phase: Phase; label: string }
  | {
      t: 'result'
      id: number
      payload: SlimPayload
      timings: Record<string, number>
    }
  /**
   * Re-posts the whole payload with ownership re-derived, rather than a
   * surgical patch. One code path, and a new object identity so React
   * re-renders — a patch would mutate objects inside an already-built index
   * and silently fail to.
   */
  | {
      t: 'playersResult'
      id: number
      payload: SlimPayload
      reports: PlayerFileReport[]
    }
  | { t: 'error'; id: number; phase: Phase; message: string; stack?: string }
  | { t: 'queryResult'; id: number; json: string | null }
