/**
 * World-space → map-space → pixel-space conversion.
 *
 * Ported from PalworldSaveTools `src/palworld_coord/__init__.py`.
 *
 * ## Which constants are correct
 *
 * PalworldSaveTools carries two sets ("old" at scale 459 and "new" at 725) and
 * is not self-consistent about them — its own map tab uses a third value (706)
 * behind a user-facing calibration slider. The `new` set below is the right one
 * for current saves, validated against the 174 landmarks in
 * `fast_travel_points.json`: those project into a symmetric cloud centred on
 * ±1000 (Free Pal Alliance Tower Entrance lands at ~(239, 152)), whereas the
 * `old` constants scatter them well off the map. `scripts/verify-coords.ts`
 * re-runs that validation if a future game patch moves the map.
 *
 * ## The axis swap
 *
 * Map X derives from world **Y**, and map Y from world **X**. This looks like a
 * bug every time someone reads it. It is not — `test/unit/coords.test.ts`
 * pins it against a known landmark precisely so it does not get "fixed".
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type MapKind = 'overworld' | 'tree'

export interface MapPos {
  mx: number
  my: number
  map: MapKind
}

/** Overworld (Palpagos + Sakurajima). */
const S = 725
const TX = 375247
const TY = -18

/** World Tree interior — its own coordinate space and its own map image. */
const TREE_S = 724
const TREE_TX = 358540
const TREE_TY = -382365

/** Half-extent of each map's coordinate space. */
export const OVERWORLD_RANGE = 1000
export const TREE_RANGE = 2500

/** Hardcoded pixel offsets the tree map image needs; see PST `treemap_to_pixel`. */
const TREE_PIXEL_OFFSET_X = 1760
const TREE_PIXEL_OFFSET_Y = 2571

export function savToMap(x: number, y: number): { mx: number; my: number } {
  return { mx: (y - TY) / S, my: (x + TX) / S }
}

export function mapToSav(mx: number, my: number): { x: number; y: number } {
  return { x: my * S - TX, y: mx * S + TY }
}

export function savToTree(x: number, y: number): { mx: number; my: number } {
  return { mx: (y - TREE_TY) / TREE_S, my: (x + TREE_TX) / TREE_S }
}

/**
 * Picks the map an entity belongs to, porting PST's `sav_to_map_by_z`.
 *
 * Despite the name, the decision is made by bounds-checking rather than by z —
 * PST defines a `MAP_Z_THRESHOLD` and then never uses it here. Kept faithful
 * to the original so results match.
 */
export function savToMapAuto(x: number, y: number): MapPos {
  const p = savToMap(x, y)
  if (Math.abs(p.mx) > OVERWORLD_RANGE || Math.abs(p.my) > OVERWORLD_RANGE) {
    const t = savToTree(x, y)
    if (Math.abs(t.mx) <= TREE_RANGE && Math.abs(t.my) <= TREE_RANGE) {
      return { ...t, map: 'tree' }
    }
  }
  return { ...p, map: 'overworld' }
}

/** Convenience wrapper for the `{x,y,z}` translations the save stores. */
export function posToMap(p: Vec3 | undefined): MapPos | undefined {
  return p ? savToMapAuto(p.x, p.y) : undefined
}

/** Map space → pixel space on a rendered map image of `w` × `h`. */
export function mapToPixel(
  mx: number,
  my: number,
  w: number,
  h: number,
  kind: MapKind = 'overworld',
): { px: number; py: number } {
  if (kind === 'tree') {
    const span = TREE_RANGE * 2
    return {
      px: ((mx + TREE_RANGE) * w) / span + TREE_PIXEL_OFFSET_X,
      py: ((TREE_RANGE - my) * h) / span + TREE_PIXEL_OFFSET_Y,
    }
  }
  const span = OVERWORLD_RANGE * 2
  return {
    px: ((mx + OVERWORLD_RANGE) * w) / span,
    py: ((OVERWORLD_RANGE - my) * h) / span,
  }
}

/** In-game map coordinates are shown as integers. */
export function formatMapPos(p: MapPos | undefined): string {
  return p ? `${Math.round(p.mx)}, ${Math.round(p.my)}` : '—'
}
