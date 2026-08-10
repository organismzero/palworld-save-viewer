/**
 * The one connection to the `psv` IndexedDB database.
 *
 * ## Why this is a module of its own
 *
 * IndexedDB will not run a version upgrade while another connection is open at
 * the old version — it fires `versionchange` on the existing connections and
 * then *waits* for them to close. If nobody closes, the `openDB` promise for
 * the new version never settles. Not rejects: never settles.
 *
 * That is a real hazard here rather than a theoretical one, because the handle
 * is memoised for the lifetime of the page. Two modules each calling `openDB`
 * at different versions would deadlock every user who already has a warm cache,
 * and the symptom would be the app hanging on "Loading game data" with no error
 * anywhere. So there is exactly one owner, and `blocking` closes on demand so a
 * newer tab can upgrade instead of hanging behind this one.
 *
 * **Nothing else in the app may call `openDB` on {@link DB_NAME}.**
 *
 * ## The stores
 *
 * - `refdata`, `assets` — caches of Pocketpair's public names, icons and map
 *   art. Disposable; "Clear cached game data" empties them.
 * - `session` — the user's own parsed world, if they opted in. Deliberately
 *   *not* cleared by that button, which is why the two controls in the About
 *   dialog are worded so differently.
 */

import { openDB, type IDBPDatabase } from 'idb'

/**
 * Renamed from `pjv` when the project was. An old database is simply
 * abandoned rather than migrated: everything in it is a cache of public files
 * that re-fetch in seconds, so a migration would be more code than the data is
 * worth. The cost is one cold start for anyone who used the old name.
 */
export const DB_NAME = 'psv'
export const LEGACY_DB_NAME = 'pjv'

/** v1 refdata + assets; v2 adds session. */
export const DB_VERSION = 2

export const REFDATA_STORE = 'refdata'
export const ASSETS_STORE = 'assets'
export const SESSION_STORE = 'session'

let db: Promise<IDBPDatabase> | undefined

export function database(): Promise<IDBPDatabase> {
  db ??= openDB(DB_NAME, DB_VERSION, {
    /**
     * Written per version rather than as one block, so a user on v1 gets only
     * the v2 step and a brand-new user gets both in order. `oldVersion` is 0
     * for a database that does not exist yet.
     */
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore(REFDATA_STORE)
        d.createObjectStore(ASSETS_STORE)
      }
      if (oldVersion < 2) {
        d.createObjectStore(SESSION_STORE)
      }
    },
    /**
     * Another tab is still on the old version and is holding this upgrade up.
     * Nothing to do but say so — the other tab's `blocking` handler is what
     * actually resolves it, and it will once that tab is focused or closed.
     */
    blocked() {
      console.warn(
        `[psv] Another tab is holding the ${DB_NAME} database at an older version.`,
      )
    },
    /** A newer tab wants to upgrade. Get out of its way rather than deadlock. */
    blocking() {
      closeDatabase()
    },
    terminated() {
      closeDatabase()
    },
  })
  return db
}

/**
 * Drops the memoised handle so the next {@link database} call reopens.
 *
 * Closing is fire-and-forget: the point is to release the version lock, and
 * anything already awaiting the old handle can finish against it.
 */
export function closeDatabase(): void {
  const closing = db
  db = undefined
  void closing?.then((d) => d.close()).catch(() => {})
}
