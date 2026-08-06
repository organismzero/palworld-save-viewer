import { create } from 'zustand'

import { buildSaveIndex } from '../domain/index.ts'
import type { Guid, SaveIndex } from '../domain/types.ts'
import { explainParseError } from '../parse/explain.ts'
import { partition, type Sniffed } from '../parse/sniff.ts'
import type {
  FromWorker,
  Phase,
  PlayerFileReport,
  ToWorker,
} from '../parse/worker/protocol.ts'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PlayerFileState {
  fileName: string
  bytes: number
  uid?: Guid
  status: 'queued' | 'parsing' | 'loaded' | 'rejected'
  reason?: string
}

interface SaveState {
  status: LoadStatus
  fileName?: string
  fileBytes?: number
  phase?: Phase
  progressLabel?: string
  timings?: Record<string, number>
  index?: SaveIndex
  error?: string

  /** Ingestion ledger, keyed by file name. Drives the player-saves panel. */
  playerFiles: Record<string, PlayerFileState>
  /** Held until a Level.json arrives, then drained automatically. */
  pendingPlayerFiles: File[]

  acceptFiles: (files: File[]) => Promise<void>
  reset: () => void
}

/**
 * One worker for the session. It retains both the ~170 MB raw tree and the
 * derived payload, so merging player saves never re-parses the level.
 */
let worker: Worker | undefined
let nextRequestId = 1

/** Resolvers for in-flight requests, keyed by request id. */
const pending = new Map<
  number,
  { resolve: (msg: FromWorker) => void; reject: (err: Error) => void }
>()

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(
    new URL('../parse/worker/parse.worker.ts', import.meta.url),
    { type: 'module' },
  )

  // One permanent listener dispatching on message type, rather than a one-shot
  // listener per request. With two request kinds and a queue, the per-request
  // approach leaks listeners and drops progress events.
  worker.addEventListener('message', (ev: MessageEvent<FromWorker>) => {
    const msg = ev.data
    if (msg.t === 'progress') {
      useSaveStore.setState({ phase: msg.phase, progressLabel: msg.label })
      return
    }
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.t === 'error') entry.reject(new Error(msg.message))
    else entry.resolve(msg)
  })

  worker.addEventListener('error', (ev) => {
    const err = new Error(ev.message || 'worker failed')
    for (const [, entry] of pending) entry.reject(err)
    pending.clear()
  })

  return worker
}

/** `Omit` over a union collapses it; this preserves each member. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

type Request = DistributiveOmit<Extract<ToWorker, { id: number }>, 'id'>

function request(msg: Request, transfer: Transferable[]) {
  const id = nextRequestId++
  const w = getWorker()
  return new Promise<FromWorker>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ ...msg, id } as ToWorker, transfer)
  })
}

function ledgerFrom(
  sniffed: Sniffed[],
  status: PlayerFileState['status'],
): Record<string, PlayerFileState> {
  return Object.fromEntries(
    sniffed.map((s) => [
      s.file.name,
      {
        fileName: s.file.name,
        bytes: s.file.size,
        uid: s.filenameUid,
        status,
        reason: s.reason,
      } satisfies PlayerFileState,
    ]),
  )
}

async function parsePlayers(files: File[]) {
  if (files.length === 0) return

  useSaveStore.setState((s) => ({
    playerFiles: {
      ...s.playerFiles,
      ...Object.fromEntries(
        files.map((f) => [
          f.name,
          { fileName: f.name, bytes: f.size, status: 'parsing' as const },
        ]),
      ),
    },
  }))

  const bufs = await Promise.all(
    files.map(async (f) => ({ fileName: f.name, buf: await f.arrayBuffer() })),
  )

  const msg = await request(
    { t: 'parsePlayerJson', files: bufs },
    bufs.map((b) => b.buf),
  )
  if (msg.t !== 'playersResult') return

  useSaveStore.setState((s) => ({
    index: buildSaveIndex(msg.payload),
    playerFiles: {
      ...s.playerFiles,
      ...Object.fromEntries(
        msg.reports.map((r: PlayerFileReport) => [
          r.fileName,
          {
            fileName: r.fileName,
            bytes: s.playerFiles[r.fileName]?.bytes ?? 0,
            uid: r.uid,
            status: r.ok ? ('loaded' as const) : ('rejected' as const),
            reason: r.reason,
          },
        ]),
      ),
    },
  }))
}

/**
 * Ingests raw `.sav` files.
 *
 * Which one is the level is decided by the container header rather than the
 * filename: `Level.sav` is the convention, not a rule, and a server operator
 * renaming it should still work. The level is simply the largest — a world is
 * orders of magnitude bigger than any player file.
 */
async function acceptSavs(
  savs: Sniffed[],
  set: (
    partial: Partial<SaveState> | ((s: SaveState) => Partial<SaveState>),
  ) => void,
) {
  // Player files are named after their UID; a level save is not. Size cannot
  // do this job — a compressed level save is under a megabyte, smaller than
  // any cap that would still admit a real player file.
  const named = savs.filter((s) => s.filenameUid !== undefined)
  const unnamed = savs.filter((s) => s.filenameUid === undefined)

  const sorted = unnamed.length > 0 ? unnamed : [...savs]
  sorted.sort((a, b) => b.file.size - a.file.size)
  const level = sorted[0]!
  const players = [...sorted.slice(1), ...(unnamed.length > 0 ? named : [])]

  set({
    status: 'loading',
    fileName: level.file.name,
    fileBytes: level.file.size,
    error: undefined,
    index: undefined,
    playerFiles: ledgerFrom(players, 'queued'),
    pendingPlayerFiles: [],
    phase: 'decode',
    progressLabel: 'Reading file',
  })

  try {
    const buf = await level.file.arrayBuffer()
    const msg = await request({ t: 'parseSav', buf }, [buf])
    if (msg.t !== 'result') return
    set({
      status: 'ready',
      index: buildSaveIndex(msg.payload),
      timings: msg.timings,
      phase: 'done',
      progressLabel: undefined,
    })
  } catch (err) {
    const { message } = explainParseError(err, level.file.name)
    set({ status: 'error', error: message, progressLabel: undefined })
    return
  }

  if (players.length === 0) return
  await parsePlayerSavs(players, set)
}

/** Decompresses and merges raw player saves into the world already loaded. */
async function parsePlayerSavs(
  players: Sniffed[],
  set: (
    partial: Partial<SaveState> | ((s: SaveState) => Partial<SaveState>),
  ) => void,
) {
  set((s) => ({
    playerFiles: { ...s.playerFiles, ...ledgerFrom(players, 'parsing') },
  }))

  const bufs = await Promise.all(
    players.map(async (p) => ({
      fileName: p.file.name,
      buf: await p.file.arrayBuffer(),
    })),
  )
  const msg = await request(
    { t: 'parsePlayerSav', files: bufs },
    bufs.map((b) => b.buf),
  )
  if (msg.t !== 'playersResult') return

  set((s) => ({
    index: buildSaveIndex(msg.payload),
    playerFiles: {
      ...s.playerFiles,
      ...Object.fromEntries(
        msg.reports.map((r: PlayerFileReport) => [
          r.fileName,
          {
            fileName: r.fileName,
            bytes: s.playerFiles[r.fileName]?.bytes ?? 0,
            uid: r.uid,
            status: r.ok ? ('loaded' as const) : ('rejected' as const),
            reason: r.reason,
          },
        ]),
      ),
    },
  }))
}

export const useSaveStore = create<SaveState>((set, get) => ({
  status: 'idle',
  playerFiles: {},
  pendingPlayerFiles: [],

  reset: () => {
    // A new world invalidates everything — stale container ids from a previous
    // save would silently mis-attribute against the new one.
    worker?.postMessage({ t: 'dropRaw' } satisfies ToWorker)
    set({
      status: 'idle',
      index: undefined,
      error: undefined,
      fileName: undefined,
      fileBytes: undefined,
      timings: undefined,
      playerFiles: {},
      pendingPlayerFiles: [],
    })
  },

  async acceptFiles(files) {
    const { level, players, rejected, savs } = await partition(files)

    // Raw saves are only used when no converted JSON came with them: a folder
    // drop contains both, and the JSON is cheaper to read and is what the
    // golden tests are written against.
    if (!level && players.length === 0 && savs.length > 0) {
      // Player `.sav` files dropped onto a world already open are an addition,
      // not a replacement. Without this they fell through to "treat the
      // largest as the level", which threw away the loaded save and reported
      // the player file as a malformed level.
      const named = savs.filter((s) => s.filenameUid !== undefined)
      if (get().index && named.length === savs.length) {
        await parsePlayerSavs(named, set)
        return
      }
      await acceptSavs(savs, set)
      return
    }

    if (!level && players.length === 0) {
      set({
        status: rejected.length ? 'error' : get().status,
        error:
          rejected[0]?.reason ??
          'Nothing here looks like a Palworld save. Drop a converted Level.json.',
      })
      return
    }

    set((s) => ({
      playerFiles: { ...s.playerFiles, ...ledgerFrom(rejected, 'rejected') },
    }))

    // Players dropped with no level loaded are held, not rejected — the user
    // very reasonably may drop the folder first.
    if (!level && !get().index) {
      set((s) => ({
        pendingPlayerFiles: [
          ...s.pendingPlayerFiles,
          ...players.map((p) => p.file),
        ],
        playerFiles: { ...s.playerFiles, ...ledgerFrom(players, 'queued') },
      }))
      return
    }

    if (level) {
      set({
        status: 'loading',
        fileName: level.file.name,
        fileBytes: level.file.size,
        error: undefined,
        index: undefined,
        playerFiles: ledgerFrom(players, 'queued'),
        pendingPlayerFiles: [],
        phase: 'decode',
        progressLabel: 'Reading file',
      })

      try {
        const buf = await level.file.arrayBuffer()
        const msg = await request({ t: 'parseJson', buf }, [buf])
        if (msg.t !== 'result') return
        set({
          status: 'ready',
          index: buildSaveIndex(msg.payload),
          timings: msg.timings,
          phase: 'done',
          progressLabel: undefined,
        })
      } catch (err) {
        // The worker's message is accurate but often unactionable; this turns
        // it into something the user can do something about.
        const { message } = explainParseError(err, level.file.name)
        set({ status: 'error', error: message, progressLabel: undefined })
        return
      }
    }

    // Anything held from an earlier gesture goes in with this batch.
    const queued = get().pendingPlayerFiles
    const batch = [...queued, ...players.map((p) => p.file)]
    if (batch.length > 0) {
      set({ pendingPlayerFiles: [] })
      try {
        await parsePlayers(batch)
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) })
      }
    }
  },
}))
