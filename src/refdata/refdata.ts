/**
 * Game reference data and art, fetched at runtime and cached in IndexedDB.
 *
 * **None of this is in the repository.** Palworld's names, icons and map are
 * Pocketpair's, so they are pulled from the PalworldSaveTools mirror on demand
 * and cached locally. See SOURCES.md.
 *
 * Two rules shape the design:
 *
 * 1. **Slim before caching.** The raw files total ~20 MB; the working set the
 *    app actually needs is a few hundred KB. Projecting on the way in keeps
 *    IndexedDB small and start-up instant.
 * 2. **Cache-first, never block.** A returning user gets the full UI with no
 *    network at all. A cold user with no network gets `degraded`, which is a
 *    designed state — raw asset ids and a procedural map, not a broken screen.
 */

import { deleteDB, openDB, type IDBPDatabase } from 'idb'

/**
 * Pinned to a tag would be better; the repo publishes none, so `main` it is.
 * Bump `SLIM_VERSION` to invalidate every cached projection at once.
 */
const PST_REF = 'main'
/** Bumped when a projection changes; invalidates every cached entry. */
const SLIM_VERSION = 4

const CDN = `https://cdn.jsdelivr.net/gh/deafdudecomputers/PalworldSaveTools@${PST_REF}/resources`
/** raw.githubusercontent serves text/plain and rate-limits; strictly a fallback. */
const MIRROR = `https://raw.githubusercontent.com/deafdudecomputers/PalworldSaveTools/${PST_REF}/resources`

export const MAP_IMAGE_PATH = 'assets/maps/T_WorldMap.webp'

let db: Promise<IDBPDatabase> | undefined

/**
 * Renamed from `pjv` when the project was. An old database is simply
 * abandoned rather than migrated: everything in it is a cache of public files
 * that re-fetch in seconds, so a migration would be more code than the data is
 * worth. The cost is one cold start for anyone who used the old name.
 */
const DB_NAME = 'psv'
const LEGACY_DB_NAME = 'pjv'

function database() {
  db ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('refdata')
      d.createObjectStore('assets')
    },
  })
  return db
}

async function fetchFirst(path: string): Promise<Response> {
  for (const base of [CDN, MIRROR]) {
    try {
      const res = await fetch(`${base}/${path}`)
      if (res.ok) return res
    } catch {
      // Try the mirror before giving up.
    }
  }
  throw new Error(`could not fetch ${path}`)
}

/* -------------------------------------------------------------------------
   Projections
   ------------------------------------------------------------------------- */

export interface SpeciesInfo {
  name: string
  element1?: string
  element2?: string
  rarity?: number
  zukan?: number
  /** Repo-relative, e.g. `/icons/pals/T_Alpaca_icon_normal.webp`. */
  icon?: string
  /** Work suitability levels above zero, keyed by work id. */
  work?: Record<string, number>
  partnerSkill?: string
}

export interface PassiveInfo {
  name: string
  /** −3…9 in real data; negatives are detrimental traits. */
  rank: number
  description?: string
}

export interface WorkType {
  id: string
  display: string
  icon?: string
}

export interface Landmark {
  id: string
  name: string
  x: number
  y: number
  z: number
}

export interface ItemInfo {
  name: string
  icon?: string
  /**
   * 0–4 in the usual common→legendary ramp, plus a handful of 5s and three
   * sentinel 99s. Anything above 4 is clamped for display rather than dropped.
   */
  rarity: number
  /** e.g. `"Weapon"`. Empty for ~650 internal items; falls back to the enum. */
  typeA: string
  typeB: string
  weight: number
  maxStack: number
  description?: string
  /** Full durability for weapons and armour — the denominator for the bar. */
  durability?: number
  magazine?: number
}

export interface StructureInfo {
  name: string
  icon?: string
  typeA: string
  /** `EPalBuildObjectTypeForUIDisplay::…` tail — the in-game build category. */
  category?: string
  hp?: number
}

/**
 * Cumulative experience at each level, for players and for pals separately.
 *
 * 100 entries, ~8 KB. Small enough that leaving it out to save space would be
 * a false economy: without it an XP bar has no denominator, and the only
 * honest alternative is showing a raw seven-digit number.
 */
export interface ExpLevel {
  level: number
  /** Total player XP required to *be* this level. */
  total: number
  palTotal: number
}

export interface Refdata {
  /** Keyed by lowercased asset id, as PalworldSaveTools does throughout. */
  species: Record<string, SpeciesInfo>
  passives: Record<string, PassiveInfo>
  work: WorkType[]
  landmarks: Landmark[]
  items: Record<string, ItemInfo>
  structures: Record<string, StructureInfo>
  /** Ascending by level, so a binary search or a direct index both work. */
  expTable: ExpLevel[]
}

function slimCharacters(raw: any): Record<string, SpeciesInfo> {
  const out: Record<string, SpeciesInfo> = {}
  for (const p of raw?.pals ?? []) {
    if (typeof p?.asset !== 'string') continue
    const work: Record<string, number> = {}
    for (const [id, level] of Object.entries<any>(p.work_suitabilities ?? {})) {
      if (typeof level === 'number' && level > 0) work[id] = level
    }
    out[p.asset.toLowerCase()] = {
      name: p.name ?? p.asset,
      element1: p.stats?.element_type1,
      element2: p.stats?.element_type2,
      rarity: p.stats?.rarity,
      zukan: p.stats?.zukan_index,
      icon: p.icon,
      work,
      partnerSkill: p.partner_skill,
    }
  }
  return out
}

/**
 * Only ~115 of the ~1,905 passives in `skills.json` are player-visible; the
 * rest are internal armour/weapon modifiers. Keeping the lot would be 2.8 MB
 * of noise, so this keeps every passive that a pal could actually carry.
 */
function slimPassives(raw: any): Record<string, PassiveInfo> {
  const out: Record<string, PassiveInfo> = {}
  for (const p of raw?.passives ?? []) {
    if (typeof p?.asset !== 'string') continue
    out[p.asset.toLowerCase()] = {
      name: p.name ?? p.asset,
      rank: typeof p.rank === 'number' ? p.rank : 0,
      description: p.description,
    }
  }
  return out
}

function slimWork(raw: any): WorkType[] {
  return (raw?.work_types ?? [])
    .filter((w: any) => typeof w?.id === 'string')
    .map((w: any) => ({
      id: w.id,
      display: w.display_name ?? w.id,
      icon: w.icon,
    }))
}

/** `EPalItemTypeA::Material` → `Material`; `""`/`None` → `undefined`. */
function enumTail(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '' || raw === 'None') return undefined
  const sep = raw.lastIndexOf('::')
  const tail = sep === -1 ? raw : raw.slice(sep + 2)
  return tail === 'None' || tail === '' ? undefined : tail
}

/**
 * The largest projection in the app: 2,466 items down from 3.9 MB to ~800 KB.
 *
 * Descriptions are the bulk of that and would be easy to drop — but they are
 * what makes the inventory tooltip worth hovering, and the whole thing is
 * fetched once and then read from IndexedDB forever.
 *
 * Unlike the map's icon atlas, this cannot be narrowed to the ids a particular
 * save uses: reference data is cached before any save is loaded and is shared
 * across every save the user opens.
 */
function slimItems(raw: any): Record<string, ItemInfo> {
  const out: Record<string, ItemInfo> = {}
  for (const i of raw?.items ?? []) {
    if (typeof i?.asset !== 'string') continue
    out[i.asset.toLowerCase()] = {
      name: i.name ?? i.asset,
      icon: i.icon,
      rarity: typeof i.rarity === 'number' ? i.rarity : 0,
      // `type_a_display` is empty for blueprints and internal items, where the
      // raw enum tail is still a useful label.
      typeA: i.type_a_display || (enumTail(i.type_a) ?? ''),
      typeB: i.type_b_display || (enumTail(i.type_b) ?? ''),
      weight: typeof i.weight === 'number' ? i.weight : 0,
      maxStack: typeof i.max_stack === 'number' ? i.max_stack : 1,
      description: i.description || undefined,
      durability: i.durability > 0 ? i.durability : undefined,
      magazine: i.magazine_size > 0 ? i.magazine_size : undefined,
    }
  }
  return out
}

/**
 * Structure names for the base explorer.
 *
 * Every one of the 76 distinct `MapObjectId`s in the reference save resolves
 * here, including the ore rocks and treasure boxes that are world scenery
 * rather than buildable objects — so this is the only naming pass needed.
 */
function slimStructures(raw: any): Record<string, StructureInfo> {
  const out: Record<string, StructureInfo> = {}
  for (const s of raw?.structures ?? []) {
    if (typeof s?.asset !== 'string') continue
    out[s.asset.toLowerCase()] = {
      name: s.name ?? s.asset,
      icon: s.icon,
      typeA: s.type_a_display ?? '',
      category: enumTail(s.type_ui_display),
      // `-1` marks indestructible; only a positive maximum can draw a bar.
      hp: typeof s.hp === 'number' && s.hp > 0 ? s.hp : undefined,
    }
  }
  return out
}

function slimExpTable(raw: any): ExpLevel[] {
  const out: ExpLevel[] = []
  for (const [key, v] of Object.entries<any>(raw ?? {})) {
    const level = Number(key)
    if (!Number.isInteger(level)) continue
    out.push({
      level,
      total: typeof v?.TotalEXP === 'number' ? v.TotalEXP : 0,
      palTotal: typeof v?.PalTotalEXP === 'number' ? v.PalTotalEXP : 0,
    })
  }
  return out.sort((a, b) => a.level - b.level)
}

/** Absolute URL for an icon path as it appears in the reference data. */
export function iconUrl(path: string | undefined): string | undefined {
  if (!path) return undefined
  return `${CDN}/game_data${path.startsWith('/') ? '' : '/'}${path}`
}

function slimLandmarks(raw: any): Landmark[] {
  const out: Landmark[] = []
  for (const [id, v] of Object.entries<any>(raw ?? {})) {
    if (typeof v?.x !== 'number') continue
    out.push({
      id: v.id ?? id,
      name: v.localized_name ?? v.id ?? id,
      x: v.x,
      y: v.y,
      z: v.z ?? 0,
    })
  }
  return out
}

/* -------------------------------------------------------------------------
   Load
   ------------------------------------------------------------------------- */

const KEY = `refdata@${PST_REF}@${SLIM_VERSION}`

export async function loadRefdata(): Promise<{
  data: Refdata
  fromCache: boolean
}> {
  const d = await database()

  const cached = (await d.get('refdata', KEY)) as Refdata | undefined
  if (cached) {
    // Returning users see the full UI immediately; freshness can wait.
    void revalidate(d)
    return { data: cached, fromCache: true }
  }

  const data = await fetchAndSlim()
  await d.put('refdata', data, KEY)
  void navigator.storage?.persist?.()
  return { data, fromCache: false }
}

async function fetchAndSlim(): Promise<Refdata> {
  const [characters, travel, skills, work, items, world, exp] =
    await Promise.all([
      fetchFirst('game_data/characters.json').then((r) => r.json()),
      fetchFirst('game_data/fast_travel_points.json').then((r) => r.json()),
      fetchFirst('game_data/skills.json').then((r) => r.json()),
      fetchFirst('game_data/work_suitability.json').then((r) => r.json()),
      fetchFirst('game_data/items.json').then((r) => r.json()),
      fetchFirst('game_data/world.json').then((r) => r.json()),
      fetchFirst('game_data/pal_exp_table.json').then((r) => r.json()),
    ])
  return {
    species: slimCharacters(characters),
    passives: slimPassives(skills),
    work: slimWork(work),
    landmarks: slimLandmarks(travel),
    items: slimItems(items),
    structures: slimStructures(world),
    expTable: slimExpTable(exp),
  }
}

async function revalidate(d: IDBPDatabase) {
  try {
    const data = await fetchAndSlim()
    await d.put('refdata', data, KEY)
  } catch {
    // Offline is fine — the cached copy stands.
  }
}

/* -------------------------------------------------------------------------
   Map tiles
   ------------------------------------------------------------------------- */

export interface TileSet {
  /** Edge length of the baked image, in pixels. */
  size: number
  tile: number
  levels: number
}

const TILESET_KEY = `tiles@${PST_REF}@${SLIM_VERSION}`

export async function getTileSet(): Promise<TileSet | undefined> {
  const d = await database()
  return (await d.get('assets', TILESET_KEY)) as TileSet | undefined
}

export async function putTileSet(set: TileSet) {
  const d = await database()
  await d.put('assets', set, TILESET_KEY)
}

export function tileKey(level: number, x: number, y: number) {
  return `map/overworld/z${level}/${x}_${y}.webp`
}

export async function getTile(
  level: number,
  x: number,
  y: number,
): Promise<Blob | undefined> {
  const d = await database()
  return (await d.get('assets', tileKey(level, x, y))) as Blob | undefined
}

export async function putTiles(entries: [string, Blob][]) {
  const d = await database()
  const tx = d.transaction('assets', 'readwrite')
  await Promise.all(entries.map(([k, v]) => tx.store.put(v, k)))
  await tx.done
}

export async function fetchMapImage(): Promise<Blob> {
  return (await fetchFirst(MAP_IMAGE_PATH)).blob()
}

/** Wipes everything cached, for the settings panel. */
export async function clearCache(): Promise<number> {
  const d = await database()
  const before = (await navigator.storage?.estimate?.())?.usage ?? 0
  await d.clear('refdata')
  await d.clear('assets')
  // Also drop the pre-rename database, which this button would otherwise
  // report as freed space while leaving it on disk.
  await deleteDB(LEGACY_DB_NAME).catch(() => {})
  const after = (await navigator.storage?.estimate?.())?.usage ?? 0
  return Math.max(0, before - after)
}
