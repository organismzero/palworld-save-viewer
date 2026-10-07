/**
 * The Map's link codec.
 *
 * Synthetic ids throughout.
 */

import { describe, expect, it } from 'vitest'

import { serialiseParams } from '@/app/viewParams.ts'
import {
  DEFAULT_LAYERS,
  MAP_DEFAULTS,
  linkId,
  mapCodec,
  roundViewport,
  sameViewport,
  type MapParams,
} from '@/views/map/params.ts'

const PAL = 'abcdef01'.padEnd(32, '0')

const qs = (over: Partial<MapParams>) =>
  serialiseParams(mapCodec.encode({ ...MAP_DEFAULTS, ...over }, MAP_DEFAULTS))
const decode = (s: string) =>
  mapCodec.decode(new URLSearchParams(s), MAP_DEFAULTS)
const roundTrip = (over: Partial<MapParams>) => decode(qs(over))

describe('mapCodec', () => {
  it('writes nothing for a map nobody has touched', () => {
    expect(qs({})).toBe('')
    expect(decode('')).toEqual(MAP_DEFAULTS)
  })

  it('round-trips everything a link carries', () => {
    const value: MapParams = {
      layers: new Set(['pals', 'bases']),
      fog: false,
      fogOpacity: 0.4,
      viewport: { mx: 120, my: -340, zoom: 4.25 },
      selected: { layer: 'pals', id: 'abcdef01' },
    }
    expect(roundTrip(value)).toEqual(value)
  })

  it('lists layers by id, in a stable order', () => {
    expect(qs({ layers: new Set(['players', 'bases']) })).toBe(
      'l=bases,players',
    )
  })

  it('can say no layers at all, which an empty list could not', () => {
    expect(qs({ layers: new Set() })).toBe('l=none')
    expect(decode('l=none').layers.size).toBe(0)
    // Absent is the default set, not the empty one.
    expect([...decode('').layers].sort()).toEqual([...DEFAULT_LAYERS].sort())
  })

  it('drops layer ids it does not know and keeps the rest', () => {
    expect([...decode('l=bases,volcanoes,pals').layers].sort()).toEqual([
      'bases',
      'pals',
    ])
  })

  it('carries the viewport as one param, rounded', () => {
    expect(qs({ viewport: { mx: 12.4, my: -7.6, zoom: 2.3456 } })).toBe(
      'at=12,-8,2.35',
    )
  })

  it('ignores a viewport that is not three finite numbers', () => {
    for (const bad of ['at=1,2', 'at=1,2,x', 'at=1,,3', 'at=1,2,0', 'at=']) {
      expect(decode(bad).viewport).toBeUndefined()
    }
  })

  it('keeps fog opacity within range', () => {
    expect(decode('fo=250').fogOpacity).toBe(1)
    expect(decode('fo=-5').fogOpacity).toBe(0)
    expect(decode('fo=nope').fogOpacity).toBe(MAP_DEFAULTS.fogOpacity)
  })

  it('shortens a GUID in the selection and leaves other ids whole', () => {
    expect(qs({ selected: { layer: 'pals', id: PAL } })).toBe(
      'sel=pals:abcdef01',
    )
    expect(qs({ selected: { layer: 'markers', id: 'pin-12' } })).toBe(
      'sel=markers:pin-12',
    )
    expect(linkId('pin-12')).toBe('pin-12')
  })

  it('reads a selection on an unknown layer, or with no id, as none', () => {
    expect(decode('sel=volcanoes:abc').selected).toBeUndefined()
    expect(decode('sel=pals:').selected).toBeUndefined()
    expect(decode('sel=pals').selected).toBeUndefined()
  })
})

describe('viewport helpers', () => {
  it('compares a viewport with its own link encoding as equal', () => {
    const v = roundViewport({ mx: 12.4, my: -7.6, zoom: 2.3456 })
    expect(sameViewport(v, decode(qs({ viewport: v })).viewport)).toBe(true)
  })

  it('treats fitted as equal only to fitted', () => {
    expect(sameViewport(undefined, undefined)).toBe(true)
    expect(sameViewport(undefined, { mx: 0, my: 0, zoom: 1 })).toBe(false)
  })
})
