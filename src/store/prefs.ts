/**
 * The few things about the app a person can set and expect to stay set.
 *
 * Preferences, not state: nothing here describes a save, and nothing here is
 * in a link. A link has to mean the same thing to whoever opens it, so a
 * preference only ever decides where a view *starts* when no link says
 * otherwise. It never changes what a link's absence of a parameter means.
 *
 * One small JSON value in `localStorage`. Reading is forgiving, because the
 * value outlives the code that wrote it: anything it does not recognise is
 * dropped, field by field, and the rest is kept.
 */

import type { ViewId } from './uiStore.ts'

export const PREFS_KEY = 'psv.prefs'

export const VIEW_IDS: readonly ViewId[] = [
  'map',
  'pals',
  'bases',
  'guild',
  'summary',
  'breed',
  'builds',
]

/** The map's layers, as its link spells them. Kept here to avoid importing Pixi. */
export const MAP_LAYER_IDS = [
  'players',
  'bases',
  'structuresBuilt',
  'markers',
  'pals',
  'chests',
  'structuresWorld',
  'landmarks',
] as const

export interface Prefs {
  /** The tab the app opens on when the address names none. */
  defaultView?: ViewId
  /** The layers the map starts with when its link names none. */
  mapLayers?: string[]
}

export function parsePrefs(raw: string | null | undefined): Prefs {
  if (!raw) return {}
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!v || typeof v !== 'object') return {}
  const { defaultView, mapLayers } = v as Record<string, unknown>
  const out: Prefs = {}
  if (VIEW_IDS.includes(defaultView as ViewId)) {
    out.defaultView = defaultView as ViewId
  }
  if (Array.isArray(mapLayers)) {
    // An empty list is a real choice: a map that opens with nothing on it.
    out.mapLayers = MAP_LAYER_IDS.filter((id) => mapLayers.includes(id))
  }
  return out
}

export function readPrefs(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return {}
  }
}

/** Merge `next` into what is stored. `undefined` clears a field. */
export function writePrefs(next: Partial<Prefs>): Prefs {
  const merged = { ...readPrefs(), ...next }
  for (const k of Object.keys(merged) as (keyof Prefs)[]) {
    if (merged[k] === undefined) delete merged[k]
  }
  try {
    if (Object.keys(merged).length === 0) localStorage.removeItem(PREFS_KEY)
    else localStorage.setItem(PREFS_KEY, JSON.stringify(merged))
  } catch {
    // Not being able to remember a preference is not worth an error.
  }
  return merged
}
