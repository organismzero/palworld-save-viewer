/**
 * World-space → map-space → pixel-space conversion.
 *
 * Ported from PalworldSaveTools `src/palworld_coord/__init__.py`.
 *
 * ## Which constants are correct
 *
 * PalworldSaveTools carries two sets — "old" at scale 459 and "new" at 725 —
 * and the **old** one is right, despite the name. It reproduces four
 * independently-read in-game map positions to under one map unit:
 *
 * | Landmark                          | In game    | This transform |
 * | --------------------------------- | ---------- | -------------- |
 * | Sealed Realm of the Myriad Flames | −264, −155 | −264, −155     |
 * | Natural Bridge                    | 377, −213  | 376, −212      |
 * | Frostbound Mountains Summit       | 168, 45    | 167, 45        |
 * | Castaway Beach                    | −99, −712  | −99, −711      |
 *
 * The `new` set was used here until it was checked against the game rather
 * than against itself, and it is wrong by 360–660 map units — a third of the
 * island. It survived because the check that chose it asked whether the
 * landmarks in `fast_travel_points.json` land inside ±1000, and **that
 * question rewards a scale that is too large**: 725/459 shrinks everything
 * toward the origin, so 157 of 159 fitted rather than 122. Fitting inside the
 * bounds is not evidence of being in the right place. The test now compares
 * against real readings, which is the only thing that could have caught this.
 *
 * The 37 landmarks outside ±1000 under the correct constants are Feybreak, the
 * Sky Islands and the World Tree watchtowers — separate map screens with their
 * own coordinate spaces. See {@link savToMapAuto}.
 *
 * ## The axis swap
 *
 * Map X derives from world **Y**, and map Y from world **X**. This looks like a
 * bug every time someone reads it. It is not — `test/unit/coords.test.ts`
 * pins it against known landmarks precisely so it does not get "fixed".
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

/** Overworld (Palpagos + Sakurajima). PST's `__*_old` constants. */
const S = 459
const TX = 123888
const TY = 158000

/** World Tree interior — its own coordinate space and its own map image. */
const TREE_S = 724
const TREE_TX = 358540
const TREE_TY = -382365

/** Half-extent of each map's coordinate space. */
export const OVERWORLD_RANGE = 1000
export const TREE_RANGE = 2500

/**
 * Where the map image sits in the world — **not** a coordinate transform.
 *
 * This is what PST's `__*_new` constants actually are, and mistaking them for
 * the world→map transform is what put the coordinate readout out by a third of
 * the island. `T_WorldMap.webp` covers a square of world space 1,450,000 units
 * on a side, centred at (−375247, −18); `725` is that half-extent divided by
 * 1000, which is why it looks like a scale and sits next to two numbers that
 * look like translations.
 *
 * Keeping the art placed in world space rather than map space is also the more
 * honest description: the image is a picture of the world, and the coordinate
 * grid the game draws on top of it is a separate thing that can be got wrong
 * independently — as it was.
 *
 * In map coordinates this rect runs mx −1924…1235, my −2127…1032, which is
 * asymmetric because the image includes Feybreak and the Sky Islands off to the
 * south-west of Palpagos.
 */
const ART_CENTRE_X = -375247
const ART_CENTRE_Y = -18
const ART_HALF = 725_000

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
 *
 * ## Known limitation: this returns `tree` for things that are not the tree
 *
 * There are more than two coordinate spaces. Feybreak, the Sky Islands and the
 * Sakurajima watchtowers each have their own, and none of them is modelled
 * here — so anything out there falls past the overworld bounds, lands inside
 * the World Tree's very permissive ±2500, and comes back labelled `tree`.
 * Measured on `fast_travel_points.json`, that is 37 of 174 landmarks.
 *
 * This was invisible while the overworld constants were too large, because
 * everything was compressed inside ±1000 and nothing ever reached the second
 * branch. It is wrong either way: those places were being drawn in the wrong
 * spot on the island, and are now labelled as somewhere they are not.
 *
 * z does not separate them — the World Tree interior sits at ~21–28k and
 * Frostbound Mountains Summit, firmly on the main island, is at 19k. Fixing it
 * properly means a `MapKind` per region with its own constants and its own map
 * image, which is a bigger change than the transform itself. On the reference
 * save nothing is affected: all bases, players and structures and all but 6
 * pals are on the overworld.
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

/**
 * Map space → pixel space on a rendered map image of `w` × `h`.
 *
 * Goes back through world space rather than scaling map coordinates directly,
 * because {@link ART_CENTRE_X} is where the picture actually is. Correcting the
 * world→map transform therefore does not move a single pixel of the render —
 * `test/unit/coords.test.ts` pins that this agrees with the old formulation to
 * within a rounding error.
 */
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
  const { x, y } = mapToSav(mx, my)
  const span = ART_HALF * 2
  return {
    px: ((y - (ART_CENTRE_Y - ART_HALF)) * w) / span,
    py: ((ART_CENTRE_X + ART_HALF - x) * h) / span,
  }
}

/** The inverse of {@link mapToPixel}, for turning a cursor into coordinates. */
export function pixelToMap(
  px: number,
  py: number,
  w: number,
  h: number,
): { mx: number; my: number } {
  const span = ART_HALF * 2
  const y = (px * span) / w + (ART_CENTRE_Y - ART_HALF)
  const x = ART_CENTRE_X + ART_HALF - (py * span) / h
  return savToMap(x, y)
}

/** World units per image pixel, for drawing real distances to scale. */
export function worldPerPixel(w: number): number {
  return (ART_HALF * 2) / w
}

/**
 * A world-space distance expressed in map units.
 *
 * Base build radii are stored in world units and drawn against map-unit
 * positions, so something has to divide by the scale. Doing it here means one
 * place knows the number: a copy of it in `BasePlan.tsx` stayed at the old 725
 * through the transform fix and drew every base radius a third too small.
 */
export function worldToMap(distance: number): number {
  return distance / S
}

/** In-game map coordinates are shown as integers. */
export function formatMapPos(p: MapPos | undefined): string {
  return p ? `${Math.round(p.mx)}, ${Math.round(p.my)}` : '—'
}
