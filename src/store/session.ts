/**
 * Keeping a parsed world in this browser, if — and only if — you say so.
 *
 * ## The promise this changes
 *
 * The README and the drop zone both say your save never leaves your machine
 * and that closing the tab discards everything. The first half stays true and
 * always will; this module only affects the second. So it is **off by default**
 * and every part of it is reversible: turning the preference off deletes what
 * was stored, immediately, rather than merely stopping future writes.
 *
 * ## Why a snapshot rather than the file
 *
 * The level file's `ArrayBuffer` is *transferred* to the parse worker, so it is
 * detached the moment parsing begins and cannot be read again. What can be kept
 * is the output: `SlimPayload` is already plain arrays with GUID cross-links
 * and no `Map`s — the shape it has precisely so it can cross `postMessage` —
 * which makes it directly storable, and `buildSaveIndex` rebuilds the lookups
 * on the way back in. No serialisation code, on either side.
 *
 * ## Two stores, deliberately
 *
 * The snapshot lives in IndexedDB; the *fact that a snapshot exists* is
 * mirrored into `localStorage`. That is not redundancy. The drop zone has to
 * decide whether to offer a reopen before its first paint, and an IndexedDB
 * read is asynchronous — without the mirror the button would pop in a frame
 * late, on the app's landing screen, which is the worst place for a layout
 * shift. The real read happens when it is clicked.
 */

import { SESSION_STORE, database } from '../lib/db.ts'
import { buildSaveIndex, toSlim } from '../domain/index.ts'
import type {
  LevelMetaPayload,
  LocalDataPayload,
  SlimPayload,
  WorldSettings,
} from '../domain/types.ts'
import { useSaveStore, type PlayerFileState } from './saveStore.ts'
import { useUiStore } from './uiStore.ts'

/**
 * Bump on **any** change to `SlimPayload`'s shape.
 *
 * There is no compiler behind this. A reader change that adds or renames a
 * field leaves old snapshots parseable but *wrong* — a restored world quietly
 * missing data, which is far worse than one that refuses to load. Treat "did
 * you bump it?" as a review question on anything under `parse/worker/readers/`.
 */
// 2: carries `levelMeta`. A restored session used to lose it, so the save's own
// clock reading and its in-game day vanished on reopen — which matters more now
// that metadata is usually added in a gesture of its own.
// 3: `meta.source` is gone with the `.json` path, and a player record carries
// `mutations` and `arenaSoloClears`. An old snapshot would restore without them.
// 4: a character that never jumped has no `pos`, where it used to have the
// world origin. An old snapshot would restore with the pile of pals at one spot.
// 5: a `Boss_` prefix is stripped in either casing. An old snapshot would
// restore with those alphas as ordinary pals of a species named `Boss_…`.
export const SNAPSHOT_VERSION = 5

const KEY = 'current'
const PREF_KEY = 'psv.remember'
const DESCRIPTOR_KEY = 'psv.session'

export interface SessionSnapshot {
  version: number
  savedAt: number
  fileName: string
  fileBytes: number
  payload: SlimPayload
  localData?: LocalDataPayload
  levelMeta?: LevelMetaPayload
  /** The server settings, already stripped of secrets by the parser. */
  worldSettings?: WorldSettings
  playerFiles: Record<string, PlayerFileState>
}

/** The part the drop zone can know synchronously. */
export interface SessionDescriptor {
  fileName: string
  savedAt: number
  fileBytes: number
}

/* -------------------------------------------------------------------------
   Consent
   ------------------------------------------------------------------------- */

export type RememberPref = 'unset' | 'on' | 'off'

/**
 * Synchronous by design — the drop zone reads this during render.
 *
 * `localStorage` throws rather than returning null in a few real situations
 * (Safari private browsing historically, and any embedding that blocks storage
 * access), and the honest answer in all of them is "we are not remembering
 * anything", not a crash on first paint.
 */
export function rememberPref(): RememberPref {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    return raw === '1' ? 'on' : raw === '0' ? 'off' : 'unset'
  } catch {
    return 'off'
  }
}

/**
 * Records the answer, and **deletes the snapshot when turning off**.
 *
 * Not deferred to a separate "Forget" click. "Stop remembering my saves" that
 * leaves three megabytes of parsed world on disk is exactly the failure the
 * privacy copy exists to prevent.
 */
export async function setRememberPref(on: boolean): Promise<void> {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0')
  } catch {
    // Storage is blocked; nothing will be written either way.
  }
  if (!on) await forgetSession()
  // Saying yes is itself a reason to write: the world on screen was opened
  // before anyone had agreed to keep it, so nothing has been stored yet.
  else dirty = true
}

export function sessionDescriptor(): SessionDescriptor | undefined {
  try {
    const raw = localStorage.getItem(DESCRIPTOR_KEY)
    if (!raw) return undefined
    const d = JSON.parse(raw) as SessionDescriptor
    return typeof d?.fileName === 'string' && typeof d?.savedAt === 'number'
      ? d
      : undefined
  } catch {
    return undefined
  }
}

function writeDescriptor(d: SessionDescriptor | undefined): void {
  try {
    if (d) localStorage.setItem(DESCRIPTOR_KEY, JSON.stringify(d))
    else localStorage.removeItem(DESCRIPTOR_KEY)
  } catch {
    // Best effort; the snapshot itself is the source of truth.
  }
}

/* -------------------------------------------------------------------------
   The snapshot
   ------------------------------------------------------------------------- */

/**
 * Reads the snapshot, discarding one written by an incompatible build.
 *
 * Deleting rather than keeping is the point: a stale snapshot that cannot be
 * trusted is worse than none, because the alternative is showing a world with
 * quietly missing fields.
 */
export async function readSnapshot(): Promise<SessionSnapshot | undefined> {
  try {
    const d = await database()
    const snap = (await d.get(SESSION_STORE, KEY)) as
      SessionSnapshot | undefined
    if (!snap) return undefined
    if (snap.version !== SNAPSHOT_VERSION) {
      await forgetSession()
      return undefined
    }
    return snap
  } catch {
    return undefined
  }
}

export async function writeSnapshot(snap: SessionSnapshot): Promise<void> {
  const asked = forgotten
  try {
    const d = await database()
    await d.put(SESSION_STORE, snap, KEY)
    // Forgotten while this was on its way to disk. The delete may have run
    // before the put landed, so take it out again, and leave no descriptor
    // saying there is something to reopen.
    if (asked !== forgotten) {
      await d.delete(SESSION_STORE, KEY)
      return
    }
    writeDescriptor({
      fileName: snap.fileName,
      savedAt: snap.savedAt,
      fileBytes: snap.fileBytes,
    })
    void persistOrigin()
  } catch (err) {
    // Quota is the expected failure, and silently retrying forever would just
    // burn main-thread time on every merge. Stop remembering and say so.
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      await setRememberPref(false)
      console.warn('[psv] Storage is full; stopped remembering this save.')
      // This reverses something the user asked for, so it has to be said
      // where they will see it rather than only in the console.
      useUiStore
        .getState()
        .notify(
          'This browser is out of storage, so the save is no longer being kept.',
          { tone: 'warn', ttl: 12000 },
        )
      return
    }
    console.warn('[psv] Could not save the session.', err)
  }
}

/**
 * Deletes the kept save — and makes sure nothing puts it back.
 *
 * The world it came from is usually still open, and the tab-hidden flush would
 * otherwise write it straight back the next time the user looked at another
 * tab. So forgetting also drops any write that is pending or owed; a later
 * change to the open world (another file merged in) is a new reason to write,
 * and does.
 */
export async function forgetSession(): Promise<void> {
  forgotten++
  dirty = false
  cancelPending()
  writeDescriptor(undefined)
  try {
    const d = await database()
    await d.delete(SESSION_STORE, KEY)
  } catch {
    // Nothing to delete, or storage is gone. Either way it is not there now.
  }
}

/** Asks the browser not to evict us. A 3 MB snapshot is prime eviction bait. */
let askedToPersist = false
async function persistOrigin(): Promise<void> {
  if (askedToPersist) return
  askedToPersist = true
  try {
    await navigator.storage?.persist?.()
  } catch {
    // Advisory only.
  }
}

/* -------------------------------------------------------------------------
   Restoring
   ------------------------------------------------------------------------- */

/**
 * Puts a stored world back on screen.
 *
 * Sets `restoredFrom` so the readers of `timings` can say the session was
 * restored rather than dropping their content and looking broken.
 *
 * `stillWanted` is asked once the read comes back, and a no leaves the store
 * alone: an automatic restore can be abandoned for a different file while the
 * read is still out, and must not then land on top of it.
 */
export async function restoreSession(
  stillWanted: () => boolean = () => true,
): Promise<boolean> {
  const snap = await readSnapshot()
  if (!snap) {
    // The descriptor promised something that is no longer there — most likely
    // evicted. Clear it so the reopen button stops lying.
    writeDescriptor(undefined)
    return false
  }
  if (!stillWanted()) return false

  useSaveStore.setState({
    status: 'ready',
    index: buildSaveIndex(snap.payload),
    localData: snap.localData,
    levelMeta: snap.levelMeta,
    worldSettings: snap.worldSettings,
    playerFiles: snap.playerFiles,
    fileName: snap.fileName,
    fileBytes: snap.fileBytes,
    restoredFrom: snap.savedAt,
    isSample: false,
    timings: undefined,
    error: undefined,
    phase: 'done',
    progressLabel: undefined,
  })
  return true
}

/* -------------------------------------------------------------------------
   Writing, on the right triggers
   ------------------------------------------------------------------------- */

function snapshotFromStore(): SessionSnapshot | undefined {
  const s = useSaveStore.getState()
  if (s.status !== 'ready' || !s.index) return undefined
  // The sample is not the user's, and keeping it would put "Reopen Sample
  // world" on the landing screen in place of their own save.
  if (s.isSample) return undefined
  return {
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    fileName: s.fileName ?? 'save',
    fileBytes: s.fileBytes ?? 0,
    payload: toSlim(s.index),
    localData: s.localData,
    levelMeta: s.levelMeta,
    worldSettings: s.worldSettings,
    playerFiles: s.playerFiles,
  }
}

/**
 * Whether the open world differs from what is in storage.
 *
 * Set by a change worth writing, cleared by the write. Without it the flush on
 * `pagehide` re-wrote the whole snapshot every time the tab was hidden — moving
 * `savedAt` to "when you last looked away" and, worse, restoring a save the
 * user had just asked to forget.
 */
let dirty = false
/** Counts calls to {@link forgetSession}, so a write in flight can tell. */
let forgotten = 0

let debounce: ReturnType<typeof setTimeout> | undefined
let idle: number | undefined
let inFlight: Promise<void> = Promise.resolve()

function cancelPending(): void {
  if (debounce !== undefined) clearTimeout(debounce)
  debounce = undefined
  if (idle !== undefined) cancelIdle(idle)
  idle = undefined
}

/** `requestIdleCallback` only reached Safari in 16.4; the README supports it. */
function whenIdle(run: () => void): number {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(run, { timeout: 3000 })
  }
  return setTimeout(run, 1) as unknown as number
}

function cancelIdle(handle: number): void {
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
  else clearTimeout(handle)
}

function writeNow(): void {
  if (!dirty) return
  const snap = snapshotFromStore()
  if (!snap || rememberPref() !== 'on') return
  dirty = false
  inFlight = inFlight.then(() => writeSnapshot(snap)).catch(() => {})
}

function run(): void {
  idle = undefined
  writeNow()
}

function scheduleWrite(): void {
  // Owed whether or not it is wanted yet. The preference is asked again when
  // the write is about to happen.
  dirty = true
  if (rememberPref() !== 'on') return
  cancelPending()
  // One second, so a Players folder of eight files coalesces into one write
  // rather than eight clones of a 1.85 MB payload.
  debounce = setTimeout(() => {
    debounce = undefined
    idle = whenIdle(run)
  }, 1000)
}

/**
 * Writes immediately, skipping both stages.
 *
 * Closing the tab inside the debounce window is precisely when people close
 * tabs, and losing the session there would defeat the feature.
 */
export async function flushSessionWrite(): Promise<void> {
  cancelPending()
  writeNow()
  await inFlight
}

/**
 * Bring the remembered save back without being asked, once, at page load.
 *
 * "Keep this save" has always been described as the save coming back after a
 * reload, and until this it came back only as a button to press. That one
 * press was also the whole cost of a second tab: a duplicated tab, or a link
 * opened in a new one, carried the view and its params in the hash and then
 * stopped at the landing screen.
 *
 * The status is set before the first render rather than in an effect, so the
 * landing screen is never drawn only to be replaced. If the snapshot turns out
 * to be gone — evicted, most likely — the app falls back to the landing screen,
 * which is where it would have been.
 *
 * Only ever at load. "Load another" goes to the landing screen and stays
 * there, with its Reopen button, because that was a request for a different
 * save.
 */
export function autoRestore(): void {
  if (rememberPref() !== 'on') return
  const descriptor = sessionDescriptor()
  if (!descriptor) return

  const restoring = () => useSaveStore.getState().status === 'restoring'
  useSaveStore.setState({
    status: 'restoring',
    fileName: descriptor.fileName,
    fileBytes: descriptor.fileBytes,
  })
  const giveUp = () => {
    if (!restoring()) return
    useSaveStore.setState({
      status: 'idle',
      fileName: undefined,
      fileBytes: undefined,
    })
  }
  restoreSession(restoring).then((ok) => {
    if (!ok) giveUp()
  }, giveUp)
}

/**
 * Subscribes to the two things that mean "the world changed".
 *
 * Deliberately not a blanket subscription: the store's `setState` fires on
 * every worker progress message, dozens per parse, and debouncing that is
 * fighting the wrong signal. `index` gets a fresh identity from
 * `buildSaveIndex` on the initial parse and on every player merge; `localData`
 * on each client-save merge; `levelMeta` when world metadata is added, which is
 * now usually a gesture of its own; `worldSettings` when the server's settings
 * are. That is the complete trigger list.
 *
 * `playerFiles` is deliberately excluded even though it is snapshotted: the
 * ledger flips to `'parsing'` *before* the payload changes, so keying on it
 * would write a stale payload and then immediately write again.
 */
export function installSessionPersistence(): () => void {
  let lastIndex = useSaveStore.getState().index
  let lastLocal = useSaveStore.getState().localData
  let lastMeta = useSaveStore.getState().levelMeta
  let lastSettings = useSaveStore.getState().worldSettings
  let seenRestore = useSaveStore.getState().restoredFrom

  const unsubscribe = useSaveStore.subscribe((s) => {
    if (s.status !== 'ready') {
      // A reset or a new parse in flight: nothing half-written should land.
      if (s.status === 'idle' || s.status === 'loading') cancelPending()
      lastIndex = s.index
      lastLocal = s.localData
      lastMeta = s.levelMeta
      lastSettings = s.worldSettings
      return
    }
    if (
      s.index === lastIndex &&
      s.localData === lastLocal &&
      s.levelMeta === lastMeta &&
      s.worldSettings === lastSettings
    ) {
      return
    }
    lastIndex = s.index
    lastLocal = s.localData
    lastMeta = s.levelMeta
    lastSettings = s.worldSettings
    // A world as it has just come back is exactly what is in storage. Only
    // that first arrival, though: `restoredFrom` stays set for the life of the
    // world, and a file merged into it afterwards is a change like any other.
    if (s.restoredFrom !== seenRestore) {
      seenRestore = s.restoredFrom
      if (s.restoredFrom !== undefined) {
        dirty = false
        return
      }
    }
    scheduleWrite()
  })

  const flush = () => void flushSessionWrite()
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onHidden)

  return () => {
    unsubscribe()
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onHidden)
    cancelPending()
  }
}
