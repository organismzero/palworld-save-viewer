/**
 * What of the Map goes in a link, and how.
 *
 * The map was the one view with no codec, so it forgot its layers, its fog
 * setting, where it was looking and what was selected on every tab switch, and
 * could not be linked to at all.
 *
 * ## Why this codec is not bound to the save
 *
 * Every other view resolves the ids in its link against the index. The map
 * cannot: what a marker id means is only known once the controller has plotted
 * its entities, and some of those (fast-travel points) come from reference data
 * that has not arrived when `decode` runs. So a selection is carried as a layer
 * and an id, unresolved, and `MapView` resolves it after the controller mounts.
 *
 * ## What is deliberately absent
 *
 * The search box's text. It empties itself the moment a result is picked, and
 * what was picked is the selection, which is here.
 */

import {
  bool,
  encodeList,
  list,
  num,
  serialiseParams,
  type ParamCodec,
} from '../../app/viewParams.ts'
import type { LayerId } from './MapController.ts'

/** Every layer, in no particular order. The legend and the canvas own those. */
export const LAYER_IDS: readonly LayerId[] = [
  'players',
  'bases',
  'structuresBuilt',
  'markers',
  'pals',
  'chests',
  'structuresWorld',
  'dungeons',
  'landmarks',
]

/**
 * What is on by default.
 *
 * Tuned for the question the map is usually opened to answer — "where is my
 * stuff" — rather than for showing everything at once. The world's own
 * scenery, its loot boxes and 1,098 pal markers are all opt-in, because
 * together they bury the handful of things you actually placed. Pins are on:
 * they were placed deliberately, and there are only ever a handful.
 */
export const DEFAULT_LAYERS: readonly LayerId[] = [
  'players',
  'bases',
  'structuresBuilt',
  'markers',
]

/**
 * How dark unexplored ground gets, by default.
 *
 * Near-opaque, because the reason to load a fog mask at all is usually to
 * *avoid* seeing where you have not been. A default that leaks terrain spoils
 * the one thing the feature is for, and someone who wanted the whole map
 * visible would simply not have loaded the file.
 *
 * Not quite 1: the last couple of percent leave the coastline faintly legible,
 * which is enough to orient by without showing what is there. The slider covers
 * everything from that to fully transparent.
 */
export const DEFAULT_FOG_OPACITY = 0.98

/**
 * Where the map is looking: the map coordinate at the centre of the screen, and
 * a zoom in screen pixels per pixel of a 4096px map, so a link means the same
 * thing whatever size the map art was baked at.
 */
export interface MapViewport {
  mx: number
  my: number
  zoom: number
}

export interface MapSelection {
  layer: LayerId
  /** A whole id, or the first 8 characters of a GUID. Resolved by prefix. */
  id: string
}

export interface MapParams {
  layers: Set<LayerId>
  fog: boolean
  fogOpacity: number
  /** Colour bases and player-built structures by guild, not by layer. */
  byGuild: boolean
  /** Absent means "fitted to the window", which is where the map starts. */
  viewport?: MapViewport
  selected?: MapSelection
  /**
   * An item whose containers are marked, by asset id. Set from the Bases item
   * search; it is in the link so the marks survive leaving the map and coming
   * back, and it stays until the next search replaces it or it is cleared.
   */
  item?: string
}

export const MAP_DEFAULTS: MapParams = {
  layers: new Set(DEFAULT_LAYERS),
  fog: true,
  fogOpacity: DEFAULT_FOG_OPACITY,
  byGuild: false,
  viewport: undefined,
  selected: undefined,
  item: undefined,
}

/** `l=none`: an empty list cannot say it, because an empty param is omitted. */
const NO_LAYERS = 'none'

const GUID = /^[0-9a-f]{32}$/

/**
 * The id as a link carries it.
 *
 * A GUID is cut to its first 8 characters, as everywhere else. Pins and
 * fast-travel points have short ids of their own that are not GUIDs, and
 * cutting those would turn `pin-12` and `pin-13` into the same thing.
 */
export function linkId(id: string): string {
  return GUID.test(id) ? id.slice(0, 8) : id
}

export const mapCodec: ParamCodec<MapParams> = {
  encode(v, d) {
    const out: Record<string, string> = {}
    if (!sameSet(v.layers, d.layers)) {
      out.l = v.layers.size ? encodeList(v.layers) : NO_LAYERS
    }
    if (v.fog !== d.fog) out.fog = v.fog ? '1' : '0'
    if (v.fogOpacity !== d.fogOpacity) {
      out.fo = String(Math.round(v.fogOpacity * 100))
    }
    if (v.byGuild) out.by = 'guild'
    // One param for the three numbers: a centre without a zoom, or the other
    // way round, is not a place.
    if (v.viewport) {
      const { mx, my, zoom } = v.viewport
      out.at = [Math.round(mx), Math.round(my), round2(zoom)].join(',')
    }
    if (v.selected) out.sel = `${v.selected.layer}:${linkId(v.selected.id)}`
    if (v.item) out.item = v.item
    return out
  },

  decode(raw, d) {
    return {
      layers: layers(raw, d),
      fog: bool(raw, 'fog', d.fog),
      fogOpacity: clamp(num(raw, 'fo', d.fogOpacity * 100) / 100, 0, 1),
      byGuild: raw.get('by') === 'guild' ? true : d.byGuild,
      viewport: viewport(raw),
      selected: selection(raw),
      item: raw.get('item') || undefined,
    }
  },
}

/**
 * The Map's link with an item's containers marked.
 *
 * Whatever layers, fog and colouring the map was left with are kept. Where it
 * was looking and what was selected are not: the marks can be anywhere, and
 * the fitted map is the one view sure to show all of them.
 */
export function withItem(qs: string, staticId: string): string {
  const was = mapCodec.decode(new URLSearchParams(qs), MAP_DEFAULTS)
  return serialiseParams(
    mapCodec.encode(
      { ...was, item: staticId, viewport: undefined, selected: undefined },
      MAP_DEFAULTS,
    ),
  )
}

function layers(raw: URLSearchParams, d: MapParams): Set<LayerId> {
  const v = raw.get('l')
  if (v === null || v === '') return new Set(d.layers)
  if (v === NO_LAYERS) return new Set()
  // Unknown ids are dropped rather than refused: a link from a build with a
  // layer this one lacks should still show the layers both have.
  return new Set(list(raw, 'l').filter(isLayer))
}

function viewport(raw: URLSearchParams): MapViewport | undefined {
  const parts = (raw.get('at') ?? '').split(',')
  if (parts.length !== 3 || parts.some((p) => p.trim() === '')) return undefined
  const [mx, my, zoom] = parts.map(Number) as [number, number, number]
  if (![mx, my, zoom].every(Number.isFinite) || zoom <= 0) return undefined
  return { mx, my, zoom }
}

function selection(raw: URLSearchParams): MapSelection | undefined {
  const v = raw.get('sel') ?? ''
  const cut = v.indexOf(':')
  if (cut === -1) return undefined
  const layer = v.slice(0, cut)
  const id = v.slice(cut + 1)
  return isLayer(layer) && id ? { layer, id } : undefined
}

function isLayer(id: string): id is LayerId {
  return (LAYER_IDS as readonly string[]).includes(id)
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}

export function sameViewport(
  a: MapViewport | undefined,
  b: MapViewport | undefined,
): boolean {
  if (!a || !b) return a === b
  return a.mx === b.mx && a.my === b.my && a.zoom === b.zoom
}

/** A viewport as a link would carry it, so two that encode alike compare alike. */
export function roundViewport(v: MapViewport): MapViewport {
  return { mx: Math.round(v.mx), my: Math.round(v.my), zoom: round2(v.zoom) }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
