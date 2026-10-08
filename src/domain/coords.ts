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
 * The 52 landmarks outside ±1000 under the correct constants are Feybreak, the
 * Sky Islands and the World Tree. The first two are on the same map as the main
 * island — the transform gives Feybreak Tower Entrance −1288, −1665 and the
 * game reads −1294, −1669 — and only the World Tree is somewhere else. See
 * {@link savToMapAuto}.
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

/** Overworld (Palpagos, Sakurajima, Feybreak, Sky Islands). PST's `__*_old` constants. */
const S = 459
const TX = 123888
const TY = 158000

/** World Tree interior — its own coordinate space and its own map image. */
const TREE_S = 724
const TREE_TX = 358540
const TREE_TY = -382365

/** Half-extent of the main island's coordinates, and of the tree's space. */
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
 * Whether a world position is inside the square the overworld image shows.
 *
 * This, not ±{@link OVERWORLD_RANGE}, is what "on the overworld" means. The
 * ±1000 box is only the main island; Feybreak and the Sky Islands lie south and
 * west of it, in the same coordinate space and on the same picture.
 */
function onOverworldArt(x: number, y: number): boolean {
  return (
    Math.abs(x - ART_CENTRE_X) <= ART_HALF &&
    Math.abs(y - ART_CENTRE_Y) <= ART_HALF
  )
}

/**
 * Picks the map an entity belongs to.
 *
 * Began as a port of PST's `sav_to_map_by_z`, which bounds-checks against
 * ±1000 and sends everything past it to the World Tree. That is wrong for
 * Feybreak and the Sky Islands, and it mattered: a base built on Feybreak was
 * listed everywhere except on the map, which drops tree entities.
 *
 * Measured on `fast_travel_points.json`, the 52 landmarks outside ±1000 fall
 * into two groups that the image's own extent separates cleanly:
 *
 * - 35 on Feybreak and the Sky Islands, at mx −1659…−214, my −1874…−660 — all
 *   inside the image, which runs to my −2127.
 * - 17 in the World Tree, at mx −1995…−1457, my 1154…1640 — all north of the
 *   image's edge at my 1032.
 *
 * So anything the picture covers is on the overworld, and only what lies
 * outside it is tried against the tree's space. z does not help: the World
 * Tree sits at ~17–43k and Sky Islands landmarks reach 60k.
 */
export function savToMapAuto(x: number, y: number): MapPos {
  const p = savToMap(x, y)
  const inIsland =
    Math.abs(p.mx) <= OVERWORLD_RANGE && Math.abs(p.my) <= OVERWORLD_RANGE
  if (!inIsland && !onOverworldArt(x, y)) {
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
