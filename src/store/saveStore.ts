import { create } from 'zustand'

import { buildSaveIndex, toSlim } from '../domain/index.ts'
import type {
  Guid,
  LevelMetaPayload,
  LocalDataPayload,
  SaveIndex,
} from '../domain/types.ts'
import {
  levelMetaPredatesWorld,
  localDataBelongs,
  resolvePresetOwner,
} from '../domain/verify.ts'
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
  /**
   * Which slot this file belongs to.
   *
   * The ledger has always held `LocalData` and `LevelMeta` rows despite being
   * called `playerFiles`; now that the Files panel groups by slot, saying so is
   * cheaper than inferring it from the name. Absent on rows written before a
   * sniff could say — a `.sav` batch whose level is picked by size.
   */
  kind?: 'player' | 'local' | 'levelmeta'
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

  /**
   * The world's `LevelMeta`, if it was in the drop. Beside the index for the same
   * reason as `localData` — it describes the save file, not its contents.
   *
   * Unlike `localData` this needs no world to attribute it to, so it is read
   * immediately whichever order the files arrive in.
   */
  levelMeta?: LevelMetaPayload

  /** Ingestion ledger, keyed by file name. Drives the player-saves panel. */
  playerFiles: Record<string, PlayerFileState>
  /** Held until a Level.json arrives, then drained automatically. */
  pendingPlayerFiles: File[]
  /** Same, for `LocalData` — reading it needs a world to attribute it to. */
  pendingLocalFile?: File
  /**
   * Same, for `LevelMeta`.
   *
   * Reading it needs no world — it describes the save file rather than its
   * contents — but *keeping* it does: a level arriving afterwards is a different
   * world as far as anything here can tell, and the reset that loads one clears
   * `levelMeta` for the same reason it clears the fog. Holding the file instead
   * means "metadata first, then the level" ends up with metadata, and that it
   * gets checked against the world like every other addition.
   */
  pendingLevelMetaFile?: File

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
        kind: slotOf(s.kind),
      } satisfies PlayerFileState,
    ]),
  )
}

/**
 * Folds the worker's per-file verdicts back into the ledger.
 *
 * Shared by the JSON and `.sav` player paths, which report identically. `bytes`
 * comes from whatever row is already there — the worker is handed buffers and
 * never learns a file's size — and `kind` is asserted rather than carried,
 * because a report only comes back for a file that was sent to a player reader.
 */
function mergeReports(
  reports: readonly PlayerFileReport[],
  existing: Record<string, PlayerFileState>,
): Record<string, PlayerFileState> {
  return Object.fromEntries(
    reports.map((r) => [
      r.fileName,
      {
        fileName: r.fileName,
        bytes: existing[r.fileName]?.bytes ?? 0,
        uid: r.uid,
        status: r.ok ? ('loaded' as const) : ('rejected' as const),
        reason: r.reason,
        kind: 'player' as const,
      } satisfies PlayerFileState,
    ]),
  )
}

/** The sniffer's kinds are about file shape; the ledger's are about slots. */
function slotOf(kind: Sniffed['kind']): PlayerFileState['kind'] {
  if (kind === 'local') return 'local'
  if (kind === 'levelmeta') return 'levelmeta'
  if (kind === 'player' || kind === 'sav') return 'player'
  return undefined
}

/**
 * Hands the worker a world it never parsed, once.
 *
 * A restored session skipped the worker entirely, so its `payload` is null and
 * a player-save merge would come back "load a level save before adding player
 * saves". This is called immediately before any merge; it is a no-op unless
 * the current world came from storage, and it only fires once because the
 * worker keeps what it is given.
 *
 * Deliberately lazy rather than part of `restoreSession`: it costs a ~1.85 MB
 * structured clone across `postMessage`, and most restored sessions never drop
 * a player file at all.
 */
let adoptedFor: SaveIndex | undefined

async function adoptIfRestored(): Promise<void> {
  const s = useSaveStore.getState()
  if (s.restoredFrom === undefined || !s.index) return
  if (adoptedFor === s.index) return
  const payload = toSlim(s.index)
  await request({ t: 'adopt', payload }, [])
  adoptedFor = s.index
}

async function parsePlayers(files: File[]) {
  if (files.length === 0) return
  await adoptIfRestored()

  useSaveStore.setState((s) => ({
    playerFiles: {
      ...s.playerFiles,
      ...Object.fromEntries(
        files.map((f) => [
          f.name,
          {
            fileName: f.name,
            bytes: f.size,
            status: 'parsing' as const,
            kind: 'player' as const,
          },
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
      ...mergeReports(msg.reports, s.playerFiles),
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
    levelMeta: undefined,
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
  await adoptIfRestored()
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
      ...mergeReports(msg.reports, s.playerFiles),
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
  return resolvePresetOwner(local.presets, index.palById).ownerUid
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
        kind: 'local' as const,
      },
    },
  }))

  const buf = await file.arrayBuffer()
  const msg = await request({ t: 'parseLocal', fileName: file.name, buf }, [
    buf,
  ])
  if (msg.t !== 'localResult') return

  set((s) => {
    const row = {
      fileName: msg.report.fileName,
      bytes: file.size,
      kind: 'local' as const,
    }

    /**
     * Does this client belong to the world that is open?
     *
     * The file names no world and no player, but its party presets hold pal
     * instance ids that either resolve here or do not. None resolving means a
     * different world — and accepting it would draw one world's fog over
     * another world's terrain, which looks like a rendering bug rather than a
     * mis-drop. A client with no presets gives nothing to check, so
     * `localDataBelongs` withholds an opinion and the file is read.
     */
    const presets =
      msg.payload && s.index
        ? resolvePresetOwner(msg.payload.presets, s.index.palById)
        : undefined
    const belongs = presets ? localDataBelongs(presets) : undefined

    if (msg.payload && belongs === false) {
      return {
        // Untouched: a refusal must not discard client data already loaded.
        localData: s.localData,
        playerFiles: {
          ...s.playerFiles,
          [msg.report.fileName]: {
            ...row,
            status: 'rejected' as const,
            reason: `Not this world's client — none of its ${presets?.referenced} party pals are in this save.`,
          },
        },
      }
    }

    return {
      // A rejected drop leaves any previously loaded client data alone.
      localData: msg.payload
        ? { ...msg.payload, ownerUid: presets?.ownerUid }
        : s.localData,
      playerFiles: {
        ...s.playerFiles,
        [msg.report.fileName]: {
          ...row,
          status: msg.report.ok ? ('loaded' as const) : ('rejected' as const),
          reason: msg.report.reason,
        },
      },
    }
  })
}

/**
 * Applies the `LocalData` from a drop, or holds it until a world arrives.
 *
 * Attribution needs `palById`, so this can never run before the level — and a
 * fog mask with no map under it would be nothing to look at anyway.
 */
/**
 * Reads `LevelMeta.sav` if one was dropped.
 *
 * Simpler than `applyLocal`: `LocalData` has to wait for a world because its fog
 * is meaningless without one to draw it over, whereas this describes the save file
 * itself and is just as true before the level finishes parsing. So there is no
 * pending slot and no drop-order dance.
 */
async function applyLevelMeta(
  meta: Sniffed | undefined,
  set: Setter,
  get: () => SaveState,
) {
  // Drained here as well as delivered, which is what makes either order work.
  const file = meta?.file ?? get().pendingLevelMetaFile
  if (!file) return

  if (!get().index) {
    if (meta) {
      set((s) => ({
        pendingLevelMetaFile: meta.file,
        playerFiles: { ...s.playerFiles, ...ledgerFrom([meta], 'queued') },
      }))
    }
    return
  }

  set({ pendingLevelMetaFile: undefined })
  const buf = await file.arrayBuffer()
  const msg = await request({ t: 'parseLevelMeta', fileName: file.name, buf }, [
    buf,
  ])
  if (msg.t !== 'levelMetaResult') return

  set((s) => ({
    // A rejected drop leaves whatever was already read alone, as the other
    // readers do.
    levelMeta: msg.payload ?? s.levelMeta,
    playerFiles: {
      ...s.playerFiles,
      [msg.report.fileName]: {
        fileName: msg.report.fileName,
        bytes: file.size,
        kind: 'levelmeta' as const,
        status: msg.report.ok ? ('loaded' as const) : ('rejected' as const),
        /**
         * Loaded, but said out loud when the clock does not add up.
         *
         * Nothing in this file identifies a world, so it cannot be refused on
         * identity — see `levelMetaPredatesWorld`. What it can be is obviously
         * older than the world it was dropped on, which means an earlier
         * autosave folder, and the row says so rather than quietly relabelling
         * when the save was written.
         */
        reason:
          msg.payload && s.index
            ? levelMetaPredatesWorld(msg.payload, s.index.pals)
              ? 'Older than this world — from an earlier snapshot of it, or from another save.'
              : undefined
            : msg.report.reason,
      },
    },
  }))
}

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
      levelMeta: undefined,
      localData: undefined,
      restoredFrom: undefined,
      playerFiles: {},
      pendingPlayerFiles: [],
      pendingLocalFile: undefined,
      pendingLevelMetaFile: undefined,
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
    // After `ingestWorld`, not before: that replaces the ingestion ledger
    // wholesale, so an entry written earlier would be dropped on the floor.
    await applyLevelMeta(parts.levelMeta, set, get)
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
  { level, players, rejected, ignored, savs, local, levelMeta }: Partitioned,
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
    // A `LocalData` or a `LevelMeta` on its own is a complete, sensible drop —
    // the caller reads both after this — so neither may be reported as nothing.
    // Without `levelMeta` here, adding world metadata to an open world planted
    // "Nothing here looks like a Palworld save" in the store while succeeding,
    // and dropping it *first* showed that message on the landing screen.
    if (local || levelMeta) return

    /**
     * A mis-drop onto an open world must never cost the user that world.
     *
     * This branch used to set `status: 'error'` unconditionally, which was
     * survivable while the only drop target was the landing screen — there was
     * nothing to lose. Now that every gesture is an incremental one it was
     * actively destructive: dropping a stray `notes.txt` onto a loaded save
     * replaced the entire app with "Could not read that file", with the parsed
     * index still sitting in the store and no way back to it. Caught by the
     * last step of this feature's own walkthrough.
     *
     * So with a world open the rejection is *reported*, in the ledger the Files
     * panel already reads, and nothing else changes. `error` is for the landing
     * screen, where a message is the only feedback there is.
     */
    if (get().index) {
      set((s) => ({
        playerFiles: {
          ...s.playerFiles,
          ...ledgerFrom(rejected, 'rejected'),
          // A `*_dps.sav` is normally kept silent — see `Partitioned.ignored` —
          // but if it is all that arrived, silence is indistinguishable from the
          // app having missed the drop.
          ...(rejected.length === 0 ? ledgerFrom(ignored, 'rejected') : {}),
        },
      }))
      return
    }

    // Nothing usable and nothing loaded, so an ignored file is worth explaining
    // after all: a drop that produces no visible change at all reads as a bug.
    const unusable = rejected[0] ?? ignored[0]
    set({
      status: unusable ? 'error' : get().status,
      error:
        unusable?.reason ??
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

  /**
   * Read before the reset below, not after.
   *
   * Files held from an earlier gesture are for *this* level — that is the whole
   * point of holding them — but the reset that starts a new world cleared
   * `pendingPlayerFiles` first and the drain at the bottom of this function then
   * read the emptied list. So "drop your Players folder, then the level", the
   * exact flow the hold exists for, silently parsed nothing and left every row
   * queued forever.
   */
  const held = get().pendingPlayerFiles
  const heldNames = new Set(held.map((f) => f.name))

  if (level) {
    set((s) => ({
      status: 'loading' as const,
      fileName: level.file.name,
      fileBytes: level.file.size,
      error: undefined,
      index: undefined,
      // A different world means different exploration; the fog from the last
      // one would be drawn over terrain it never described.
      levelMeta: undefined,
      localData: undefined,
      // This one is being parsed, whatever the last one was.
      restoredFrom: undefined,
      // A new world gets a new ledger, except for the rows it is about to
      // parse: those files were dropped for this level.
      playerFiles: {
        ...Object.fromEntries(
          Object.entries(s.playerFiles).filter(([name]) => heldNames.has(name)),
        ),
        ...ledgerFrom(players, 'queued'),
      },
      pendingPlayerFiles: [],
      phase: 'decode' as const,
      progressLabel: 'Reading file',
    }))

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
  const batch = [...held, ...players.map((p) => p.file)]
  if (batch.length > 0) {
    set({ pendingPlayerFiles: [] })
    try {
      await parsePlayers(batch)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  }
}
