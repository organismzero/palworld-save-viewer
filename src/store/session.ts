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
} from '../domain/types.ts'
import { useSaveStore, type PlayerFileState } from './saveStore.ts'

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
export const SNAPSHOT_VERSION = 2

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
  try {
    const d = await database()
    await d.put(SESSION_STORE, snap, KEY)
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
      return
    }
    console.warn('[psv] Could not save the session.', err)
  }
}

export async function forgetSession(): Promise<void> {
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
 */
export async function restoreSession(): Promise<boolean> {
  const snap = await readSnapshot()
  if (!snap) {
    // The descriptor promised something that is no longer there — most likely
    // evicted. Clear it so the reopen button stops lying.
    writeDescriptor(undefined)
    return false
  }

  useSaveStore.setState({
    status: 'ready',
    index: buildSaveIndex(snap.payload),
    localData: snap.localData,
    levelMeta: snap.levelMeta,
    playerFiles: snap.playerFiles,
    fileName: snap.fileName,
    fileBytes: snap.fileBytes,
    restoredFrom: snap.savedAt,
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
  return {
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    fileName: s.fileName ?? 'save',
    fileBytes: s.fileBytes ?? 0,
    payload: toSlim(s.index),
    localData: s.localData,
    levelMeta: s.levelMeta,
    playerFiles: s.playerFiles,
  }
}

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

function run(): void {
  idle = undefined
  const snap = snapshotFromStore()
  if (!snap || rememberPref() !== 'on') return
  inFlight = inFlight.then(() => writeSnapshot(snap)).catch(() => {})
}

function scheduleWrite(): void {
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
  const snap = snapshotFromStore()
  if (!snap || rememberPref() !== 'on') return
  inFlight = inFlight.then(() => writeSnapshot(snap)).catch(() => {})
  await inFlight
}

/**
 * Subscribes to the two things that mean "the world changed".
 *
 * Deliberately not a blanket subscription: the store's `setState` fires on
 * every worker progress message, dozens per parse, and debouncing that is
 * fighting the wrong signal. `index` gets a fresh identity from
 * `buildSaveIndex` on the initial parse and on every player merge; `localData`
 * on each client-save merge; `levelMeta` when world metadata is added, which is
 * now usually a gesture of its own. That is the complete trigger list.
 *
 * `playerFiles` is deliberately excluded even though it is snapshotted: the
 * ledger flips to `'parsing'` *before* the payload changes, so keying on it
 * would write a stale payload and then immediately write again.
 */
export function installSessionPersistence(): () => void {
  let lastIndex = useSaveStore.getState().index
  let lastLocal = useSaveStore.getState().localData
  let lastMeta = useSaveStore.getState().levelMeta

  const unsubscribe = useSaveStore.subscribe((s) => {
    if (s.status !== 'ready') {
      // A reset or a new parse in flight: nothing half-written should land.
      if (s.status === 'idle' || s.status === 'loading') cancelPending()
      lastIndex = s.index
      lastLocal = s.localData
      lastMeta = s.levelMeta
      return
    }
    if (
      s.index === lastIndex &&
      s.localData === lastLocal &&
      s.levelMeta === lastMeta
    ) {
      return
    }
    lastIndex = s.index
    lastLocal = s.localData
    lastMeta = s.levelMeta
    // A restored world is already exactly what is in storage.
    if (s.restoredFrom !== undefined) return
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
