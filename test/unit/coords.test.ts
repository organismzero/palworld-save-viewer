import { describe, expect, it } from 'vitest'

import {
  formatMapPos,
  mapToPixel,
  mapToSav,
  pixelToMap,
  savToMap,
  savToMapAuto,
  worldPerPixel,
} from '@/domain/coords.ts'

/**
 * The only real check on this transform: what the game itself displays.
 *
 * World coordinates come from PalworldSaveTools
 * `resources/game_data/fast_travel_points.json`; the map coordinates were read
 * off the in-game map by hand, by putting the cursor on each landmark, so they
 * carry a unit or two of slop. That slop is the entire reason they are worth
 * having — they are the one input to this file not derived from this file.
 *
 * An earlier version of this test recorded the transform's *own* output as the
 * expectation and called it ground truth. It passed happily against constants
 * that were off by a third of the island. Do not reintroduce that: if a value
 * here changes, it must be because someone re-read it in game.
 */
const IN_GAME = [
  { name: 'Sealed Realm of the Myriad Flames', x: -195236.17, y: 36718.49, mx: -264, my: -155 }, // prettier-ignore
  { name: 'Natural Bridge', x: -221399.27, y: 330684.53, mx: 377, my: -213 },
  { name: 'Frostbound Mountains Summit', x: -103434.984, y: 234761.17, mx: 168, my: 45 }, // prettier-ignore
  { name: 'Castaway Beach', x: -450320, y: 112630, mx: -99, my: -712 },
]

/** How far a hand-placed cursor reading can be trusted, in map units. */
const READING_TOLERANCE = 2

/**
 * Exact outputs, to catch drift finer than the readings above can see.
 *
 * These *are* derived from the implementation, which is why they are separated
 * from {@link IN_GAME} rather than mixed in with it. They pin the transform
 * against accidental change; they cannot tell you it is correct.
 */
const LANDMARKS = [
  {
    name: 'Free Pal Alliance Tower Entrance',
    x: -265220.0,
    y: 173530.0,
    mx: 33.8344,
    my: -307.9129,
  },
  {
    name: 'Sandstone Plateau Watchtower',
    x: 85482.984,
    y: 306597.12,
    mx: 323.741,
    my: 456.1459,
  },
]

describe('savToMap', () => {
  it.each(IN_GAME)('puts $name where the game puts it', ({ x, y, mx, my }) => {
    const p = savToMap(x, y)
    expect(Math.abs(p.mx - mx)).toBeLessThanOrEqual(READING_TOLERANCE)
    expect(Math.abs(p.my - my)).toBeLessThanOrEqual(READING_TOLERANCE)
  })

  it.each(LANDMARKS)('places $name exactly', ({ x, y, mx, my }) => {
    const p = savToMap(x, y)
    expect(p.mx).toBeCloseTo(mx, 3)
    expect(p.my).toBeCloseTo(my, 3)
  })

  it('derives map X from world Y and map Y from world X', () => {
    // Stated explicitly so nobody "corrects" the swap in src/domain/coords.ts.
    const origin = savToMap(0, 0)
    const movedY = savToMap(0, 100_000)
    const movedX = savToMap(100_000, 0)

    // Moving along world Y moves map X, and leaves map Y alone.
    expect(movedY.mx - origin.mx).toBeCloseTo(100_000 / 459, 6)
    expect(movedY.my).toBeCloseTo(origin.my, 6)

    // Moving along world X moves map Y, and leaves map X alone.
    expect(movedX.my - origin.my).toBeCloseTo(100_000 / 459, 6)
    expect(movedX.mx).toBeCloseTo(origin.mx, 6)
  })

  it('round-trips through mapToSav', () => {
    for (const { x, y } of [...LANDMARKS, ...IN_GAME]) {
      const { mx, my } = savToMap(x, y)
      const back = mapToSav(mx, my)
      expect(back.x).toBeCloseTo(x, 3)
      expect(back.y).toBeCloseTo(y, 3)
    }
  })
})

describe('savToMapAuto', () => {
  it('keeps main-island landmarks on the overworld', () => {
    for (const { x, y } of [...LANDMARKS, ...IN_GAME]) {
      expect(savToMapAuto(x, y).map).toBe('overworld')
    }
  })

  it('mislabels Feybreak as the World Tree, which is a known limitation', () => {
    // Deserted Ash Plateau is on Feybreak. Feybreak has its own coordinate
    // space that this module does not model, so the point falls past the
    // overworld bounds and is caught by the tree's very permissive ±2500.
    //
    // Asserted rather than ignored so the day someone adds a Feybreak MapKind,
    // this test fails and points at the place to update. See the note on
    // savToMapAuto.
    expect(savToMapAuto(-591120.0, -484260.0).map).toBe('tree')
  })

  it('routes far-out coordinates to the tree map when they fit there', () => {
    // A point whose overworld projection blows past +/-1000 (map X would be
    // ~1379) but which lands inside the World Tree's own +/-2500 space.
    const p = savToMapAuto(-358540, 1_000_000)
    expect(savToMap(-358540, 1_000_000).mx).toBeGreaterThan(1000)
    expect(p.map).toBe('tree')
    expect(p.mx).toBeCloseTo(1_382_365 / 724, 6)
    expect(p.my).toBeCloseTo(0, 6)
  })

  it('falls back to the overworld when neither map fits', () => {
    const p = savToMapAuto(9e9, 9e9)
    expect(p.map).toBe('overworld')
  })
})

describe('mapToPixel', () => {
  /**
   * The load-bearing test of the coordinate fix.
   *
   * The old code used PST's `__*_new` constants as the world→map transform.
   * They are not that — they are the map image's world-space centre and scale —
   * so the render was right all along and only the numbers shown to the user
   * were wrong. This pins that: correcting the transform must not move a pixel.
   */
  it('places the art exactly where the old formulation did', () => {
    const oldSavToMap = (x: number, y: number) => ({
      mx: (y + 18) / 725,
      my: (x + 375247) / 725,
    })
    const oldPixel = (mx: number, my: number, w: number, h: number) => ({
      px: ((mx + 1000) * w) / 2000,
      py: ((1000 - my) * h) / 2000,
    })

    let worst = 0
    for (let i = 0; i < 500; i++) {
      // Deterministic sweep over the world box the island occupies.
      const x = -1_100_000 + (i / 500) * 1_450_000
      const y = -725_000 + (((i * 37) % 500) / 500) * 1_450_000
      const o = oldSavToMap(x, y)
      const before = oldPixel(o.mx, o.my, 4096, 4096)
      const n = savToMap(x, y)
      const after = mapToPixel(n.mx, n.my, 4096, 4096)
      worst = Math.max(
        worst,
        Math.abs(before.px - after.px),
        Math.abs(before.py - after.py),
      )
    }
    expect(worst).toBeLessThan(1e-6)
  })

  it('maps the image centre to the image centre', () => {
    // The art is centred on world (-375247, -18), which is *not* map (0, 0).
    const centre = savToMap(-375247, -18)
    const p = mapToPixel(centre.mx, centre.my, 4096, 4096)
    expect(p.px).toBeCloseTo(2048, 6)
    expect(p.py).toBeCloseTo(2048, 6)
  })

  /**
   * The art rect's four edges, in world coordinates: a 1,450,000-unit square
   * centred on (-375247, -18). Each corner must land on an image corner.
   */
  it('puts the corners of the art rect on the corners of the image', () => {
    const corner = (x: number, y: number) => {
      const m = savToMap(x, y)
      return mapToPixel(m.mx, m.my, 4096, 4096)
    }
    // World +Y is image right, world -X is image down (the axis swap again).
    expect(corner(349_753, -725_018).px).toBeCloseTo(0, 6)
    expect(corner(349_753, -725_018).py).toBeCloseTo(0, 6)
    expect(corner(-1_100_247, 724_982).px).toBeCloseTo(4096, 6)
    expect(corner(-1_100_247, 724_982).py).toBeCloseTo(4096, 6)
  })

  it('round-trips through pixelToMap', () => {
    for (const { x, y } of IN_GAME) {
      const m = savToMap(x, y)
      const p = mapToPixel(m.mx, m.my, 4096, 4096)
      const back = pixelToMap(p.px, p.py, 4096, 4096)
      expect(back.mx).toBeCloseTo(m.mx, 6)
      expect(back.my).toBeCloseTo(m.my, 6)
    }
  })

  it('converts a world radius to pixels at the image scale', () => {
    // A 3,500-unit base radius on a 4096px image of a 1,450,000-unit square.
    expect(3500 / worldPerPixel(4096)).toBeCloseTo((3500 * 4096) / 1_450_000, 9)
  })

  it('applies the tree map offsets', () => {
    const p = mapToPixel(0, 0, 4096, 4096, 'tree')
    expect(p.px).toBeCloseTo(2048 + 1760)
    expect(p.py).toBeCloseTo(2048 + 2571)
  })
})

describe('formatMapPos', () => {
  it('rounds to integers, matching the in-game readout', () => {
    expect(formatMapPos({ mx: 33.8344, my: -307.9129, map: 'overworld' })).toBe(
      '34, -308',
    )
  })

  it('handles an absent position', () => {
    expect(formatMapPos(undefined)).toBe('—')
  })
})
