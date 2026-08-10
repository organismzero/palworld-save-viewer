import { create } from 'zustand'

import { buildSaveIndex } from '../domain/index.ts'
import type { Guid, LocalDataPayload, SaveIndex } from '../domain/types.ts'
import { explainParseError } from '../parse/explain.ts'
import { partition, type Partitioned, type Sniffed } from '../parse/sniff.ts'
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

export interface SaveState {
  status: LoadStatus
  fileName?: string
  fileBytes?: number
  phase?: Phase
  progressLabel?: string
  /**
   * Absent on a restored session — nothing was parsed, so there is nothing to
   * time. Both readers (`Diagnostics`, `SaveSummary`) must say so rather than
   * quietly dropping the row, hence {@link SaveState.restoredFrom}.
   */
  timings?: Record<string, number>
  index?: SaveIndex
  error?: string

  /**
   * When this world came back from browser storage rather than a file, the
   * time the snapshot was written. Undefined for a freshly parsed save.
   */
  restoredFrom?: number

  /**
   * The client's own save, if one has been dropped. Kept beside the index
   * rather than inside it: one file describes one player's client, so it is
   * neither derived from the world nor invalidated by merging player saves.
   */
  localData?: LocalDataPayload

  /** Ingestion ledger, keyed by file name. Drives the player-saves panel. */
  playerFiles: Record<string, PlayerFileState>
  /** Held until a Level.json arrives, then drained automatically. */
  pendingPlayerFiles: File[]
  /** Same, for `LocalData` — reading it needs a world to attribute it to. */
  pendingLocalFile?: File

  acceptFiles: (files: File[]) => Promise<void>
  reset: () => void
}

type Setter = (
  partial: Partial<SaveState> | ((s: SaveState) => Partial<SaveState>),
) => void

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
async function acceptSavs(savs: Sniffed[], set: Setter) {
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
    // Same reasoning as the JSON path in `ingestWorld`, and missing here until
    // now: a different world means different exploration, so the previous
    // world's fog would be drawn over terrain it never described.
    localData: undefined,
    restoredFrom: undefined,
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
async function parsePlayerSavs(players: Sniffed[], set: Setter) {
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

/**
 * Whose client `LocalData.sav` belongs to.
 *
 * The file names nobody: its own `PlayerUId` fields are the zero GUID. But
 * every pal in every party preset carries an instance id that resolves against
 * the level save, and those pals have owners — 30 of 30 in the reference save,
 * all agreeing. Unanimity is the whole test: a preset holding someone else's
 * pal, or a stale id from before a trade, should leave this blank rather than
 * put the wrong name on somebody's exploration.
 */
export function inferOwner(
  local: LocalDataPayload,
  index: SaveIndex | undefined,
): Guid | undefined {
  if (!index) return undefined
  const owners = new Set<Guid>()
  for (const preset of local.presets) {
    for (const id of preset.palIds) {
      const owner = index.palById.get(id)?.ownerPlayerUid
      if (owner) owners.add(owner)
    }
  }
  return owners.size === 1 ? [...owners][0] : undefined
}

/**
 * Reads the client's own save onto the world already open.
 *
 * Purely additive, like a player save: it never touches `index`, so dropping it
 * onto a loaded world costs nothing but the read. A file that turns out not to
 * be a `LocalData` comes back as a rejected ledger row rather than an error,
 * because tearing down a loaded world over a mis-drop is a bad trade.
 */
async function parseLocal(file: File, set: Setter) {
  set((s) => ({
    playerFiles: {
      ...s.playerFiles,
      [file.name]: {
        fileName: file.name,
        bytes: file.size,
        status: 'parsing' as const,
      },
    },
  }))

  const buf = await file.arrayBuffer()
  const msg = await request({ t: 'parseLocal', fileName: file.name, buf }, [
    buf,
  ])
  if (msg.t !== 'localResult') return

  set((s) => ({
    // A rejected drop leaves any previously loaded client data alone.
    localData: msg.payload
      ? { ...msg.payload, ownerUid: inferOwner(msg.payload, s.index) }
      : s.localData,
    playerFiles: {
      ...s.playerFiles,
      [msg.report.fileName]: {
        fileName: msg.report.fileName,
        bytes: file.size,
        status: msg.report.ok ? ('loaded' as const) : ('rejected' as const),
        reason: msg.report.reason,
      },
    },
  }))
}

/**
 * Applies the `LocalData` from a drop, or holds it until a world arrives.
 *
 * Attribution needs `palById`, so this can never run before the level — and a
 * fog mask with no map under it would be nothing to look at anyway.
 */
async function applyLocal(
  local: Sniffed | undefined,
  set: Setter,
  get: () => SaveState,
) {
  // A `LocalData` held from an earlier gesture is drained here too, which is
  // what makes "drop the client file, then the world" work as well as the
  // other order.
  const file = local?.file ?? get().pendingLocalFile
  if (!file) return

  if (!get().index) {
    if (local) {
      set((s) => ({
        pendingLocalFile: local.file,
        playerFiles: { ...s.playerFiles, ...ledgerFrom([local], 'queued') },
      }))
    }
    return
  }

  set({ pendingLocalFile: undefined })
  await parseLocal(file, set)
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
      localData: undefined,
      restoredFrom: undefined,
      playerFiles: {},
      pendingPlayerFiles: [],
      pendingLocalFile: undefined,
    })
  },

  /**
   * `LocalData` is routed apart from everything else in the drop. It must never
   * reach the "largest unnamed `.sav` is the level" heuristic below, and it
   * merges onto whichever world ends up open — including one loaded by this
   * same call — so it is applied last, after the rest has settled.
   */
  async acceptFiles(files) {
    const parts = await partition(files)
    await ingestWorld(parts, set, get)
    await applyLocal(parts.local, set, get)
  },
}))

/**
 * Everything in a drop except the client's own save.
 *
 * Lifted out of `acceptFiles` so `LocalData` can be applied after it, whatever
 * path this takes and whichever of its many exits it leaves by.
 */
async function ingestWorld(
  { level, players, rejected, savs, local }: Partitioned,
  set: Setter,
  get: () => SaveState,
) {
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
    // A `LocalData` on its own is a complete, sensible drop — the caller
    // handles it next — so it must not be reported as nothing.
    if (local) return
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
      // A different world means different exploration; the fog from the last
      // one would be drawn over terrain it never described.
      localData: undefined,
      // This one is being parsed, whatever the last one was.
      restoredFrom: undefined,
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
}
