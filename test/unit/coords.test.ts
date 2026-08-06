import { describe, expect, it } from 'vitest'

import {
  formatMapPos,
  mapToPixel,
  mapToSav,
  savToMap,
  savToMapAuto,
} from '@/domain/coords.ts'

/**
 * Ground truth from PalworldSaveTools `resources/game_data/fast_travel_points.json`
 * — real landmarks with known world coordinates. These are the regression
 * guard for the transform, and specifically for the axis swap, which reads
 * like a bug and must not get "fixed".
 */
const LANDMARKS = [
  {
    name: 'Free Pal Alliance Tower Entrance',
    x: -265220.0,
    y: 173530.0,
    mx: 239.3766,
    my: 151.7614,
  },
  {
    name: 'Deserted Ash Plateau',
    x: -591120.0,
    y: -484260.0,
    mx: -667.92,
    my: -297.7559,
  },
  {
    name: 'Emberstone Plateau',
    x: -671901.25,
    y: -172407.56,
    mx: -237.7787,
    my: -409.1783,
  },
  {
    name: 'Sandstone Plateau Watchtower',
    x: 85482.984,
    y: 306597.12,
    mx: 422.9174,
    my: 635.4896,
  },
  {
    name: 'Scorched Plateau Watchtower',
    x: -629186.6,
    y: -425621.62,
    mx: -587.0395,
    my: -350.2615,
  },
]

describe('savToMap', () => {
  it.each(LANDMARKS)('places $name correctly', ({ x, y, mx, my }) => {
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
    expect(movedY.mx - origin.mx).toBeCloseTo(100_000 / 725, 6)
    expect(movedY.my).toBeCloseTo(origin.my, 6)

    // Moving along world X moves map Y, and leaves map X alone.
    expect(movedX.my - origin.my).toBeCloseTo(100_000 / 725, 6)
    expect(movedX.mx).toBeCloseTo(origin.mx, 6)
  })

  it('round-trips through mapToSav', () => {
    for (const { x, y } of LANDMARKS) {
      const { mx, my } = savToMap(x, y)
      const back = mapToSav(mx, my)
      expect(back.x).toBeCloseTo(x, 3)
      expect(back.y).toBeCloseTo(y, 3)
    }
  })
})

describe('savToMapAuto', () => {
  it('keeps overworld landmarks on the overworld', () => {
    for (const { x, y } of LANDMARKS) {
      expect(savToMapAuto(x, y).map).toBe('overworld')
    }
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
  it('maps the overworld origin to the image centre', () => {
    expect(mapToPixel(0, 0, 4096, 4096)).toEqual({ px: 2048, py: 2048 })
  })

  it('flips the Y axis, because image Y grows downward', () => {
    const north = mapToPixel(0, 1000, 4096, 4096)
    const south = mapToPixel(0, -1000, 4096, 4096)
    expect(north.py).toBe(0)
    expect(south.py).toBe(4096)
  })

  it('spans the full image width across the coordinate range', () => {
    expect(mapToPixel(-1000, 0, 4096, 4096).px).toBe(0)
    expect(mapToPixel(1000, 0, 4096, 4096).px).toBe(4096)
  })

  it('applies the tree map offsets', () => {
    const p = mapToPixel(0, 0, 4096, 4096, 'tree')
    expect(p.px).toBeCloseTo(2048 + 1760)
    expect(p.py).toBeCloseTo(2048 + 2571)
  })
})

describe('formatMapPos', () => {
  it('rounds to integers, matching the in-game readout', () => {
    expect(formatMapPos({ mx: 239.3766, my: 151.7614, map: 'overworld' })).toBe(
      '239, 152',
    )
  })

  it('handles an absent position', () => {
    expect(formatMapPos(undefined)).toBe('—')
  })
})
