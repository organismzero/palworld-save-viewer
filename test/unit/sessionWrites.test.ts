/**
 * When the kept save is written, and when it must not be.
 *
 * `session.test.ts` pins *what* is stored and deliberately leaves IndexedDB
 * alone. This pins *when*, which needs somewhere for the writes to land — so
 * the three-line database wrapper is replaced with a `Map`, and the handful of
 * browser globals the module touches are stood in for. Fake timers stand in
 * for the debounce.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stored = new Map<string, unknown>()

vi.mock('@/lib/db.ts', () => ({
  SESSION_STORE: 'session',
  database: async () => ({
    get: async (_s: string, k: string) => stored.get(k),
    put: async (_s: string, v: unknown, k: string) => void stored.set(k, v),
    delete: async (_s: string, k: string) => void stored.delete(k),
  }),
}))

const local = new Map<string, string>()
const listeners = new Map<string, () => void>()
const target = {
  addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
  removeEventListener: (type: string) => listeners.delete(type),
}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => local.get(k) ?? null,
  setItem: (k: string, v: string) => void local.set(k, v),
  removeItem: (k: string) => void local.delete(k),
})
vi.stubGlobal('window', target)
vi.stubGlobal('document', { ...target, visibilityState: 'hidden' })

const { buildIndexes } = await import('@/parse/worker/buildIndexes.ts')
const { buildSaveIndex } = await import('@/domain/index.ts')
const { useSaveStore } = await import('@/store/saveStore.ts')
const session = await import('@/store/session.ts')

const FIXTURE = resolve(process.cwd(), 'test/fixtures/level.mini.json')
const world = () =>
  buildSaveIndex(buildIndexes(JSON.parse(readFileSync(FIXTURE, 'utf8'))))

/** What the browser does when the tab is hidden, and waits for the write. */
async function hideTab() {
  listeners.get('pagehide')!()
  await session.flushSessionWrite()
}

function open() {
  useSaveStore.setState({
    status: 'ready',
    index: world(),
    fileName: 'Level.sav',
    fileBytes: 1,
    isSample: false,
    restoredFrom: undefined,
  })
}

describe('writing the kept save', () => {
  let uninstall: () => void

  beforeEach(async () => {
    vi.useFakeTimers()
    stored.clear()
    local.clear()
    useSaveStore.setState({ status: 'idle', index: undefined })
    await session.setRememberPref(true)
    uninstall = session.installSessionPersistence()
  })

  afterEach(() => {
    uninstall()
    vi.useRealTimers()
  })

  it('writes an opened world when the tab is hidden', async () => {
    open()
    await hideTab()
    expect(stored.has('current')).toBe(true)
    expect(session.sessionDescriptor()?.fileName).toBe('Level.sav')
  })

  it('writes a world that was open before anyone said to keep it', async () => {
    // The order it really happens in: the question is only asked once there
    // is a world on screen to ask it about.
    await session.setRememberPref(false)
    open()
    await hideTab()
    expect(stored.has('current')).toBe(false)

    await session.setRememberPref(true)
    await hideTab()
    expect(stored.has('current')).toBe(true)
  })

  it('does not write again when nothing has changed', async () => {
    open()
    await hideTab()
    const first = stored.get('current')
    vi.setSystemTime(Date.now() + 60_000)
    await hideTab()
    // The same object: no second put, and `savedAt` has not crept forward.
    expect(stored.get('current')).toBe(first)
  })

  it('does not put a forgotten save back when the tab is next hidden', async () => {
    open()
    await hideTab()
    await session.forgetSession()
    expect(stored.has('current')).toBe(false)

    // The world is still open and the preference is still on.
    await hideTab()
    expect(stored.has('current')).toBe(false)
    expect(session.sessionDescriptor()).toBeUndefined()
  })

  it('forgets a save whose first write has not happened yet', async () => {
    open()
    await session.forgetSession()
    await vi.advanceTimersByTimeAsync(5000)
    await hideTab()
    expect(stored.has('current')).toBe(false)
  })

  it('writes again after a forget once the world changes', async () => {
    open()
    await hideTab()
    await session.forgetSession()
    useSaveStore.setState({ index: world() })
    await hideTab()
    expect(stored.has('current')).toBe(true)
  })

  it('does not rewrite a world that has only just been restored', async () => {
    useSaveStore.setState({
      status: 'ready',
      index: world(),
      fileName: 'Level.sav',
      isSample: false,
      restoredFrom: 123,
    })
    await hideTab()
    expect(stored.has('current')).toBe(false)
  })

  it('writes a file merged into a restored world', async () => {
    useSaveStore.setState({
      status: 'ready',
      index: world(),
      fileName: 'Level.sav',
      isSample: false,
      restoredFrom: 123,
    })
    // A player save merged in: a new index, `restoredFrom` untouched.
    useSaveStore.setState({ index: world() })
    await hideTab()
    expect(stored.has('current')).toBe(true)
  })
})
