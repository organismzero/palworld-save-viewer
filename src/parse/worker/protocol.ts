/**
 * Messages exchanged with the parse worker. Imported by both sides, so it must
 * stay free of anything that cannot run in a worker.
 */

import type { Guid, LocalDataPayload, SlimPayload } from '../../domain/types.ts'
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
  /**
   * The client's `LocalData`, in either format. One file, not a batch: it
   * describes a single client, so there is never more than one to read.
   */
  | { t: 'parseLocal'; id: number; fileName: string; buf: ArrayBuffer }
  /**
   * Seeds the worker from a payload the main thread already has.
   *
   * A restored session never started this worker, so it holds no `payload` and
   * `parsePlayerSav` would reject with "load a level save first". This hands it
   * enough state to merge player saves onto a world it did not parse. Sent
   * lazily, on the first player-file drop after a restore, because it costs
   * ~1.85 MB of `postMessage` for a capability most sessions never use.
   */
  | { t: 'adopt'; id: number; payload: SlimPayload }
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
  /**
   * Stands alone rather than folding into `SlimPayload`, because the fog masks
   * are a megabyte of texture that would otherwise be cloned into the index on
   * every player merge. Their buffers ride the transfer list, so the worker's
   * copy is detached once this is sent — the worker keeps no `LocalData` state.
   */
  | {
      t: 'localResult'
      id: number
      /** Absent when the file was rejected; `report` says why. */
      payload?: LocalDataPayload
      report: PlayerFileReport
    }
  | { t: 'adopted'; id: number }
  | { t: 'error'; id: number; phase: Phase; message: string; stack?: string }
  | { t: 'queryResult'; id: number; json: string | null }
