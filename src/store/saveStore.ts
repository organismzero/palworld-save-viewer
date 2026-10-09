import { create } from 'zustand'

import { buildSaveIndex, toSlim } from '../domain/index.ts'
import type {
  Guid,
  LevelMetaPayload,
  LocalDataPayload,
  SaveIndex,
  WorldSettings,
} from '../domain/types.ts'
import {
  levelMetaPredatesWorld,
  localDataBelongs,
  resolvePresetOwner,
} from '../domain/verify.ts'
import { explainParseError } from '../parse/explain.ts'
import { parseWorldSettings } from '../parse/settings.ts'
import { useUiStore } from './uiStore.ts'
import {
  chooseWorld,
  partition,
  type Partitioned,
  type Sniffed,
} from '../parse/sniff.ts'
import type {
  FromWorker,
  Phase,
  PlayerFileReport,
  ToWorker,
} from '../parse/worker/protocol.ts'

/**
 * `restoring` is a remembered save being read back out of this browser, as
 * against `loading`, which is a file being parsed. Nothing is in flight in the
 * worker, so it has no phase and no progress to show.
 */
export type LoadStatus = 'idle' | 'restoring' | 'loading' | 'ready' | 'error'

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
  kind?: 'player' | 'local' | 'levelmeta' | 'settings' | 'storage'
  /** How many pals a dimensional storage file added. */
  pals?: number
}

export interface SaveState {
  status: LoadStatus
  fileName?: string
  fileBytes?: number
  phase?: Phase
  progressLabel?: string
  /**
   * How far through the current phase, 0 to 1, when the phase can say. Absent
   * means "working, with no way of telling how long".
   */
  progress?: number
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
   * The world is the sample shipped with the app, not anyone's save. It is
   * never offered for remembering and never written to browser storage.
   */
  isSample?: boolean

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

  /**
   * The server's `PalWorldSettings.ini`, if it was added. Beside the index for
   * the same reason as the two above, and more so: it is not in the save
   * folder at all and describes the server as configured now, not this save.
   * Passwords and addresses in the file never reach this; see
   * `parse/settings.ts`.
   */
  worldSettings?: WorldSettings

  /** Ingestion ledger, keyed by file name. Drives the player-saves panel. */
  playerFiles: Record<string, PlayerFileState>
  /**
   * Player saves dropped before any world, held until a level arrives and then
   * read with it — dropping the `Players/` folder first is a natural order.
   */
  pendingPlayerFiles: Sniffed[]
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
  /** Same again, for the server settings: kept only alongside a world. */
  pendingSettingsFile?: File

  acceptFiles: (files: File[]) => Promise<void>
  reset: () => void
  /** Stop reading the save that is loading and go back to the drop zone. */
  cancelLoad: () => void
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
/**
 * Counts level loads, so one that was cancelled or overtaken can tell when it
 * finally hears back, and say nothing.
 */
let loadGen = 0

/**
 * Counts the times a world was closed on purpose — cancelled, or "Load
 * another" — so a drop still working through its files can tell that the one
 * it was for has gone.
 *
 * Apart from `loadGen`, which a drop bumps *itself* when it starts its level:
 * the rest of that same drop is very much still wanted.
 */
let closeGen = 0

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
      useSaveStore.setState({
        phase: msg.phase,
        progressLabel: msg.label,
        progress:
          msg.done !== undefined && msg.total
            ? Math.min(1, msg.done / msg.total)
            : undefined,
      })
      return
    }
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.t === 'error') entry.reject(new Error(msg.message))
    else entry.resolve(msg)
  })

  const failAll = (message: string) => {
    const err = new Error(message)
    for (const [, entry] of pending) entry.reject(err)
    pending.clear()
  }
  worker.addEventListener('error', (ev) =>
    failAll(ev.message || 'worker failed'),
  )
  // A reply that could not be deserialised. Nothing says which request it was
  // for, and left unanswered that request would wait for ever.
  worker.addEventListener('messageerror', () =>
    failAll('The reader sent back something that could not be read.'),
  )

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
 * `bytes` comes from whatever row is already there — the worker is handed buffers and
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
        kind: r.storage ? ('storage' as const) : ('player' as const),
        pals: r.pals,
      } satisfies PlayerFileState,
    ]),
  )
}

/** The sniffer's kinds are about file shape; the ledger's are about slots. */
function slotOf(kind: Sniffed['kind']): PlayerFileState['kind'] {
  if (kind === 'local') return 'local'
  if (kind === 'levelmeta') return 'levelmeta'
  if (kind === 'settings') return 'settings'
  if (kind === 'sav') return 'player'
  if (kind === 'dps') return 'storage'
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
  // The sample is the other world the worker never saw.
  if ((s.restoredFrom === undefined && !s.isSample) || !s.index) return
  if (adoptedFor === s.index) return
  const payload = toSlim(s.index)
  await request({ t: 'adopt', payload }, [])
  adoptedFor = s.index
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
  /** Dimensional storage files in the same drop, read with the player saves. */
  storage: Sniffed[],
  set: Setter,
  get: () => SaveState,
) {
  // Player files are named after their UID; a level save is not. Which of
  // several level saves is the one meant, and which copy of each player's
  // file goes with it, is `chooseWorld`'s to say.
  const { level, players: dropped, ignored } = chooseWorld(savs, storage)
  // Replacing a world that is open. Its filters, selections and breeding
  // target name things the next one does not contain. Not on a first load:
  // there the params came from a link, and are the point of it.
  if (get().index) useUiStore.getState().clearViewParams()
  // Held from an earlier gesture, for this level — see `pendingPlayerFiles`.
  // Read before the reset below, which empties the list.
  const droppedNames = new Set(dropped.map((p) => p.file.name))
  const players = [
    ...get().pendingPlayerFiles.filter((p) => !droppedNames.has(p.file.name)),
    ...dropped,
  ]

  const gen = ++loadGen
  set({
    status: 'loading',
    fileName: level.file.name,
    fileBytes: level.file.size,
    error: undefined,
    index: undefined,
    // A different world means different exploration, so the previous world's
    // fog would be drawn over terrain it never described.
    levelMeta: undefined,
    localData: undefined,
    // Another world may be another server.
    worldSettings: undefined,
    restoredFrom: undefined,
    isSample: false,
    playerFiles: ledgerFrom(players, 'queued'),
    pendingPlayerFiles: [],
    phase: 'decode',
    progressLabel: 'Reading file',
    progress: undefined,
  })

  try {
    const buf = await level.file.arrayBuffer()
    // Cancelled while the file was being read off disk: do not start a worker
    // for a load nobody is waiting on.
    if (gen !== loadGen) return
    const msg = await request({ t: 'parseSav', buf }, [buf])
    if (msg.t !== 'result' || gen !== loadGen) return
    set({
      status: 'ready',
      index: buildSaveIndex(msg.payload),
      timings: msg.timings,
      phase: 'done',
      progressLabel: undefined,
      progress: undefined,
    })
  } catch (err) {
    // Cancelled, or overtaken by another load: the failure is the worker
    // being stopped on purpose, and is not something to show anyone.
    if (gen !== loadGen) return
    const { message } = explainParseError(err, level.file.name)
    set({ status: 'error', error: message, progressLabel: undefined })
    return
  }

  if (ignored.length > 0) {
    useUiStore
      .getState()
      .notify(
        `Opened the ${level.file.name} nearest the top of what was added, and left out ${ignored.length === 1 ? 'one file' : `${ignored.length} files`} from further down — backups, most likely.`,
        { tone: 'warn', ttl: 12000 },
      )
  }

  if (players.length === 0) return
  await parsePlayerSavs(players, set)
}

/** Why a file that would not come off the disk is being refused. */
const UNREADABLE =
  'Could not be read. The file may have changed or moved since it was added — add it again.'

const reasonOf = (err: unknown) =>
  err instanceof Error && err.message ? err.message : UNREADABLE

/** Flips ledger rows to rejected, keeping what is already known about each. */
function refuse(set: Setter, names: string[], reason: string) {
  set((s) => ({
    playerFiles: {
      ...s.playerFiles,
      ...Object.fromEntries(
        names.map((name) => [
          name,
          {
            ...(s.playerFiles[name] ?? { fileName: name, bytes: 0 }),
            status: 'rejected' as const,
            reason,
          },
        ]),
      ),
    },
  }))
}

/** Decompresses and merges raw player saves into the world already loaded. */
async function parsePlayerSavs(players: Sniffed[], set: Setter) {
  const gen = loadGen
  await adoptIfRestored()
  if (gen !== loadGen) return
  set((s) => ({
    playerFiles: { ...s.playerFiles, ...ledgerFrom(players, 'parsing') },
  }))

  // Settled one by one: a file the game rewrote after it was picked refuses to
  // be read, and that must cost its own row, not the whole folder's.
  const read = await Promise.allSettled(
    players.map((p) => p.file.arrayBuffer()),
  )
  if (gen !== loadGen) return
  const bufs: { fileName: string; buf: ArrayBuffer }[] = []
  const unread: string[] = []
  read.forEach((r, i) => {
    const fileName = players[i]!.file.name
    if (r.status === 'fulfilled') bufs.push({ fileName, buf: r.value })
    else unread.push(fileName)
  })
  if (unread.length > 0) refuse(set, unread, UNREADABLE)
  if (bufs.length === 0) return

  let msg: FromWorker
  try {
    msg = await request(
      { t: 'parsePlayerSav', files: bufs },
      bufs.map((b) => b.buf),
    )
  } catch (err) {
    // Cancelled or overtaken: those rows are gone with the world they were for.
    if (gen !== loadGen) return
    refuse(
      set,
      bufs.map((b) => b.fileName),
      reasonOf(err),
    )
    return
  }
  // Answered for a world that has since been closed or replaced.
  if (msg.t !== 'playersResult' || gen !== loadGen) return

  const before = useSaveStore.getState().index
  const index = buildSaveIndex(msg.payload)
  // The worker has this world, merge and all, so it does not need handing it
  // again. Without this every later drop onto a restored world re-sent the lot.
  if (adoptedFor && adoptedFor === before) adoptedFor = index
  set((s) => ({
    index,
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

  const gen = loadGen
  let msg: FromWorker
  try {
    const buf = await file.arrayBuffer()
    msg = await request({ t: 'parseLocal', fileName: file.name, buf }, [buf])
  } catch (err) {
    if (gen === loadGen) refuse(set, [file.name], reasonOf(err))
    return
  }
  if (msg.t !== 'localResult' || gen !== loadGen) return

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
  const gen = loadGen
  let msg: FromWorker
  try {
    const buf = await file.arrayBuffer()
    msg = await request({ t: 'parseLevelMeta', fileName: file.name, buf }, [
      buf,
    ])
  } catch (err) {
    if (gen === loadGen) refuse(set, [file.name], reasonOf(err))
    return
  }
  if (msg.t !== 'levelMetaResult' || gen !== loadGen) return

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

/**
 * Reads `PalWorldSettings.ini` if one was added, or holds it for a world.
 *
 * No worker: it is a few kilobytes of text. Held until there is a world for
 * the reason `LevelMeta` is: loading a level clears what described the last
 * one, so "settings first, then the level" has to end with settings.
 */
async function applySettings(
  dropped: Sniffed | undefined,
  set: Setter,
  get: () => SaveState,
) {
  const file = dropped?.file ?? get().pendingSettingsFile
  if (!file) return

  if (!get().index) {
    if (dropped) {
      set((s) => ({
        pendingSettingsFile: dropped.file,
        playerFiles: { ...s.playerFiles, ...ledgerFrom([dropped], 'queued') },
      }))
    }
    return
  }

  set({ pendingSettingsFile: undefined })
  const gen = loadGen
  let text: string
  try {
    text = await file.text()
  } catch {
    if (gen === loadGen) refuse(set, [file.name], UNREADABLE)
    return
  }
  if (gen !== loadGen) return
  const result = parseWorldSettings(text, file.name)
  set((s) => ({
    // A refused file leaves settings already read alone, as the others do.
    worldSettings: result.ok ? result.settings : s.worldSettings,
    playerFiles: {
      ...s.playerFiles,
      [file.name]: {
        fileName: file.name,
        bytes: file.size,
        kind: 'settings' as const,
        status: result.ok ? ('loaded' as const) : ('rejected' as const),
        reason: result.ok ? undefined : result.reason,
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

/** Says that files were refused, and where the reason for each one is. */
function noteTurnedAway(n: number) {
  if (n === 0) return
  useUiStore
    .getState()
    .notify(
      `${n === 1 ? 'One file was' : `${n} files were`} not used. The diagnostics panel says why.`,
      { tone: 'warn' },
    )
}

export const useSaveStore = create<SaveState>((set, get) => ({
  status: 'idle',
  playerFiles: {},
  pendingPlayerFiles: [],

  reset: () => {
    // A new world invalidates everything — stale container ids from a previous
    // save would silently mis-attribute against the new one.
    worker?.postMessage({ t: 'dropRaw' } satisfies ToWorker)
    // And everything still on its way in was for the world being closed: a
    // player merge that lands after this would put it back, behind the landing
    // screen, for the next file to be merged into.
    loadGen++
    closeGen++
    set({
      status: 'idle',
      index: undefined,
      error: undefined,
      fileName: undefined,
      fileBytes: undefined,
      timings: undefined,
      levelMeta: undefined,
      localData: undefined,
      worldSettings: undefined,
      restoredFrom: undefined,
      isSample: false,
      playerFiles: {},
      pendingPlayerFiles: [],
      pendingLocalFile: undefined,
      pendingLevelMetaFile: undefined,
      pendingSettingsFile: undefined,
    })
  },

  cancelLoad: () => {
    loadGen++
    closeGen++
    // Terminated, not asked to stop: the read is one synchronous pass that
    // would not see a message until it was over. The next load starts a fresh
    // worker, which is cheap beside the parse it was about to do.
    worker?.terminate()
    worker = undefined
    adoptedFor = undefined
    const err = new Error('cancelled')
    for (const [, entry] of pending) entry.reject(err)
    pending.clear()
    get().reset()
    set({ phase: undefined, progressLabel: undefined, progress: undefined })
  },

  /**
   * `LocalData` is routed apart from everything else in the drop. It must never
   * reach the "largest unnamed `.sav` is the level" heuristic below, and it
   * merges onto whichever world ends up open — including one loaded by this
   * same call — so it is applied last, after the rest has settled.
   */
  async acceptFiles(files) {
    const parts = partition(files)
    // Every stage runs whatever became of the one before, and none of them is
    // allowed to reject: every caller fires this and walks away, so a failure
    // let out of here is a row left saying "parsing" for good and nothing said.
    const closes = closeGen
    const stage = async (run: () => Promise<void>) => {
      // Cancelled, or "Load another": the rest of this drop described a world
      // nobody is waiting for. Carried on with, its sidecar files would be
      // held and then attached to whichever world was opened next.
      if (closes !== closeGen) return
      try {
        await run()
      } catch (err) {
        console.warn('[psv] A file could not be added.', err)
        useUiStore
          .getState()
          .notify('Something that was added could not be read.', {
            tone: 'warn',
          })
      }
    }
    await stage(() => ingestWorld(parts, set, get))
    // After `ingestWorld`, not before: that replaces the ingestion ledger
    // wholesale, so an entry written earlier would be dropped on the floor.
    await stage(() => applyLevelMeta(parts.levelMeta, set, get))
    await stage(() => applySettings(parts.settings, set, get))
    await stage(() => applyLocal(parts.local, set, get))
  },
}))

/**
 * Everything in a drop except the client's own save.
 *
 * Lifted out of `acceptFiles` so `LocalData` can be applied after it, whatever
 * path this takes and whichever of its many exits it leaves by.
 */
async function ingestWorld(
  { rejected, storage, savs, local, levelMeta, settings }: Partitioned,
  set: Setter,
  get: () => SaveState,
) {
  // Dimensional storage files travel with the player saves from here on: read
  // onto an open world, held for one that has not arrived.
  if (savs.length > 0 || storage.length > 0) {
    const named = savs.filter((s) => s.filenameUid !== undefined)
    if (named.length !== savs.length) {
      await acceptSavs(savs, storage, set, get)
    } else if (get().index) {
      // Player saves dropped onto a world already open are an addition, not a
      // replacement. Without this they fell through to "treat the largest as
      // the level", which threw away the loaded save and reported the player
      // file as a malformed level.
      await parsePlayerSavs([...named, ...storage], set)
    } else {
      // With no world yet they are held, not rejected — the user very
      // reasonably may drop the folder first — and read when a level arrives.
      const held = [...named, ...storage]
      set((s) => ({
        pendingPlayerFiles: [...s.pendingPlayerFiles, ...held],
        playerFiles: { ...s.playerFiles, ...ledgerFrom(held, 'queued') },
      }))
    }
    // Anything refused alongside — typically old converter `.json` left in the
    // same folder — is listed rather than dropped without a word. After the
    // load, not before: a new world starts a new ledger.
    if (rejected.length > 0) {
      set((s) => ({
        playerFiles: { ...s.playerFiles, ...ledgerFrom(rejected, 'rejected') },
      }))
      if (get().index) noteTurnedAway(rejected.length)
    }
    return
  }

  // A `LocalData` or a `LevelMeta` on its own is a complete, sensible drop —
  // the caller reads both after this — so neither may be reported as nothing.
  // Without `levelMeta` here, adding world metadata to an open world planted
  // "Nothing here looks like a Palworld save" in the store while succeeding,
  // and dropping it *first* showed that message on the landing screen.
  if (local || levelMeta || settings) return

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
      },
    }))
    // The ledger is behind the diagnostics button, so on its own this was a
    // drop that visibly did nothing.
    noteTurnedAway(rejected.length)
    return
  }

  const unusable = rejected[0]
  set({
    status: unusable ? 'error' : get().status,
    error:
      unusable?.reason ??
      'Nothing here looks like a Palworld save. Drop the world’s Level.sav.',
  })
}

/**
 * Close this world to open a different one.
 *
 * More than `reset`: the view params described the world being closed, and
 * left in place the next save would open on this one's filters, selections and
 * breeding target, most of which name things it does not contain. Every "Load
 * another" goes through here so that none of them forgets.
 */
export function loadAnother(): void {
  useSaveStore.getState().reset()
  useUiStore.getState().clearViewParams()
  history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  )
}
