/**
 * The world map, driven imperatively.
 *
 * React owns the chrome; Pixi owns the canvas; this class is the only thing
 * that talks to both. Deliberately **not** `@pixi/react` — reconciling ~2,800
 * sprites through React on every filter change is exactly the jank the M0
 * spike was run to avoid. That spike measured 60 fps and 0.118 ms picking at
 * this sprite count on *software* rendering, so the budget is not tight.
 */

import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Texture,
} from 'pixi.js'

import {
  OVERWORLD_RANGE,
  mapToPixel,
  savToMapAuto,
} from '../../domain/coords.ts'
import { baseLabel } from '../../domain/bases.ts'
import { elementColor } from '../../lib/color.ts'
import type { SaveIndex, Vec3 } from '../../domain/types.ts'
import type { Refdata, TileSet } from '../../refdata/refdata.ts'
import { getTile } from '../../refdata/refdata.ts'

export type LayerId =
  | 'structuresBuilt'
  | 'structuresWorld'
  | 'chests'
  | 'pals'
  | 'players'
  | 'bases'
  | 'dungeons'
  | 'landmarks'

/**
 * The single source of truth for how a layer looks and reads.
 *
 * Colours used to be written twice — a CSS string in the legend and a hex int
 * here — which had already drifted (bases and fast travel shared a legend
 * swatch despite different sprite tints). One table, two representations of
 * the same value, so they cannot disagree again.
 *
 * `label` matters beyond the legend: `MapEntity.kind` *is* the layer id, and it
 * is rendered as user-visible text in the search results and the selection
 * card. Without this, those would read `structuresBuilt`.
 */
export interface LayerStyle {
  label: string
  hint: string
  /** Pixi tint. */
  color: number
  /** The same colour for CSS, since Pixi cannot take a CSS string. */
  css: string
}

export const LAYER_STYLES: Record<LayerId, LayerStyle> = {
  pals: {
    label: 'Pals',
    hint: 'Every pal in the world, coloured by element. Position is the pal’s last recorded jump point, not a live location.',
    color: 0x4ade80,
    css: 'oklch(0.78 0.16 150)',
  },
  players: {
    label: 'Players',
    hint: 'Where each player was. Exact when their player save is loaded, otherwise a last-jump estimate.',
    color: 0xffffff,
    css: '#ffffff',
  },
  bases: {
    label: 'Bases',
    hint: 'Base camps, drawn with their build radius to scale.',
    color: 0x22d3ee,
    css: 'oklch(0.82 0.12 205)',
  },
  structuresBuilt: {
    label: 'Built by players',
    hint: 'Everything a player placed, storage included — walls, beds, production, chests.',
    color: 0x94a3b8,
    css: 'oklch(0.72 0.03 250)',
  },
  structuresWorld: {
    label: 'World objects',
    hint: 'Scenery the world spawned: ore rocks, trees and other gatherables.',
    color: 0x475569,
    css: 'oklch(0.52 0.03 250)',
  },
  chests: {
    label: 'Loot chests',
    hint: 'Treasure boxes and drops out in the world. Chests you built appear under “Built by players”.',
    color: 0xfbbf24,
    css: 'oklch(0.80 0.15 85)',
  },
  dungeons: {
    label: 'Dungeons',
    hint: 'Dungeon entrances. Always empty: the save records dungeons but not where they are.',
    color: 0xa78bfa,
    css: 'oklch(0.74 0.13 300)',
  },
  landmarks: {
    label: 'Fast travel',
    hint: 'Fast-travel statues and towers, from reference data rather than your save.',
    color: 0x67e8f9,
    css: 'oklch(0.82 0.12 205)',
  },
}

/**
 * Draw order, back to front. Kept separate from the legend's order because the
 * two want different things: the legend groups by what a reader looks for, the
 * canvas needs the dense background layers underneath the sparse ones.
 */
export const LAYER_DRAW_ORDER: LayerId[] = [
  'bases',
  'structuresWorld',
  'structuresBuilt',
  'chests',
  'dungeons',
  'landmarks',
  'pals',
  'players',
]

type Marker = Sprite & { entity?: MapEntity; baseSize?: number }

export interface MapEntity {
  kind: LayerId
  id: string
  label: string
  sub?: string
  world: Vec3
  mx: number
  my: number
}

interface Options {
  index: SaveIndex
  refdata?: Refdata
  tiles?: TileSet
  onHover: (e: MapEntity | undefined, screen: { x: number; y: number }) => void
  onSelect: (e: MapEntity | undefined) => void
  onView: (v: { zoom: number; mx: number; my: number }) => void
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 14

export class MapController {
  private app = new Application()
  private world = new Container()
  private tileLayer = new Container()
  private layers = new Map<LayerId, Container>()
  private dot = Texture.WHITE
  private entities: MapEntity[] = []
  private ring = new Graphics()
  private selectedMarker?: Marker
  private destroyed = false
  private loadedTiles = new Set<string>()
  /** Baked map edge length in px; the procedural fallback uses the same space. */
  private mapSize = 4096

  constructor(private opts: Options) {}

  async mount(host: HTMLElement) {
    await this.app.init({
      background: 0x0a0d12,
      antialias: true,
      resizeTo: host,
      preference: 'webgl',
    })
    if (this.destroyed) return
    host.appendChild(this.app.canvas)

    if (this.opts.tiles) this.mapSize = this.opts.tiles.size

    this.app.stage.addChild(this.world)
    this.world.addChild(this.tileLayer)

    if (!this.opts.tiles) this.drawProceduralBackdrop()

    for (const id of LAYER_DRAW_ORDER) {
      const c = new Container()
      this.layers.set(id, c)
      this.world.addChild(c)
    }
    this.world.addChild(this.ring)

    this.dot = this.app.renderer.generateTexture(
      new Graphics().circle(16, 16, 16).fill(0xffffff),
    )

    this.build()
    this.fit()
    this.bindInput()
    void this.refreshTiles()
  }

  /**
   * Keeps marker sprites a constant size on screen by inverting the world
   * scale. Base radius rings are deliberately excluded — those represent a
   * real 3,500-unit build radius and must scale with the map.
   */
  private rescaleMarkers() {
    const scale = this.world.scale.x
    for (const layer of this.layers.values()) {
      for (const child of layer.children) {
        const m = child as Marker
        if (m.baseSize === undefined) continue
        m.width = m.height = m.baseSize / scale
      }
    }
    if (this.selectedMarker) this.drawRing(this.selectedMarker)
  }

  /* --- geometry ------------------------------------------------------- */

  /** Map space (±1000) → the baked image's pixel space. */
  private toPixel(mx: number, my: number) {
    return mapToPixel(mx, my, this.mapSize, this.mapSize)
  }

  private build() {
    const { index, refdata } = this.opts
    const add = (e: MapEntity, color: number, size: number, alpha = 1) => {
      const s = new Sprite(this.dot) as Marker
      const { px, py } = this.toPixel(e.mx, e.my)
      s.position.set(px, py)
      s.anchor.set(0.5)
      s.tint = color
      s.alpha = alpha
      s.eventMode = 'static'
      s.cursor = 'pointer'
      s.entity = e
      // Markers are sized in *screen* pixels, so they stay legible at every
      // zoom instead of ballooning. `rescaleMarkers` applies it.
      s.baseSize = size
      this.layers.get(e.kind)!.addChild(s)
      this.entities.push(e)
    }

    const place = (pos: Vec3 | undefined) => {
      if (!pos) return undefined
      const at = savToMapAuto(pos.x, pos.y)
      // The World Tree lives in its own coordinate space and its own image;
      // showing those entities on the overworld would scatter them.
      return at.map === 'overworld' ? at : undefined
    }

    for (const [i, base] of index.bases.entries()) {
      const at = place(base.pos)
      if (!at) continue
      // A base's build radius, drawn to scale.
      const { px, py } = this.toPixel(at.mx, at.my)
      const r = (base.areaRange / 725) * (this.mapSize / (OVERWORLD_RANGE * 2))
      this.layers.get('bases')!.addChild(
        new Graphics()
          .circle(px, py, r)
          .fill({ color: LAYER_STYLES.bases.color, alpha: 0.07 })
          .stroke({
            color: LAYER_STYLES.bases.color,
            width: 1.5,
            alpha: 0.5,
          }),
      )
      add(
        {
          kind: 'bases',
          id: base.baseId,
          // Shared with the base explorer so a base is called the same thing
          // wherever it appears.
          label: baseLabel(base, i + 1, refdata?.landmarks),
          sub: `${index.structuresByBase.get(base.baseId)?.length ?? 0} structures`,
          world: base.pos,
          ...at,
        },
        LAYER_STYLES.bases.color,
        18,
      )
    }

    for (const s of index.structures) {
      const at = place(s.pos)
      if (!at) continue

      // `buildPlayerUid` rather than `isBuilt`: the latter is
      // `baseCampId !== undefined`, which means "belongs to a base camp", not
      // "a player placed it". They disagree on 7 of 1,504 structures in the
      // reference save — 4 built outside any base, 3 base objects with no
      // builder — and only this field can name *who*.
      const builtByPlayer = s.buildPlayerUid !== undefined

      // A chest you built belongs with everything else you built, so the
      // `chests` layer is the loot you did not place. That keeps "hide the
      // world clutter" a single toggle instead of two, and it matters: of 966
      // containers only ~95 are player-built.
      const kind: LayerId = builtByPlayer
        ? 'structuresBuilt'
        : s.containerId
          ? 'chests'
          : 'structuresWorld'

      const stacks = s.containerId
        ? (index.containerById.get(s.containerId)?.usedSlots ?? 0)
        : undefined
      const builder = s.buildPlayerUid
        ? index.playerByUid.get(s.buildPlayerUid)?.name
        : undefined

      add(
        {
          kind,
          id: s.instanceId,
          label: s.mapObjectId,
          sub:
            [
              stacks !== undefined ? `${stacks} stacks` : undefined,
              builder ? `built by ${builder}` : undefined,
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
          world: s.pos,
          ...at,
        },
        LAYER_STYLES[kind].color,
        kind === 'structuresWorld' ? 5 : 7,
        kind === 'structuresWorld' ? 0.75 : 1,
      )
    }

    for (const pal of index.pals) {
      const at = place(pal.pos)
      if (!at) continue
      const info = refdata?.species[pal.characterId.toLowerCase()]
      add(
        {
          kind: 'pals',
          id: pal.instanceId,
          label: info?.name ?? pal.characterId,
          sub: `Lv ${pal.level}${pal.isBoss ? ' · alpha' : ''}`,
          world: pal.pos!,
          ...at,
        },
        colorOf(info?.element1),
        pal.isBoss ? 9 : 6,
        0.9,
      )
    }

    for (const p of index.players) {
      const detail = index.playerDetails.find(
        (d) => d.playerUid === p.playerUid,
      )
      const pos = detail?.pos ?? p.pos
      const at = place(pos)
      if (!at) continue
      add(
        {
          kind: 'players',
          id: p.playerUid,
          label: p.name,
          // Only a player save records a true position; Level.json's
          // LastJumpedLocation is a fallback and worth labelling as such.
          sub: detail ? `Lv ${p.level}` : `Lv ${p.level} · approx.`,
          world: pos!,
          ...at,
        },
        LAYER_STYLES.players.color,
        14,
      )
    }

    for (const d of index.dungeons) {
      if (!d.pos) continue
      const at = place(d.pos)
      if (!at) continue
      add(
        {
          kind: 'dungeons',
          id: d.instanceId,
          label: d.area ?? 'Dungeon',
          sub: d.bossState,
          world: d.pos,
          ...at,
        },
        LAYER_STYLES.dungeons.color,
        8,
      )
    }

    for (const l of refdata?.landmarks ?? []) {
      const at = place(l)
      if (!at) continue
      add(
        {
          kind: 'landmarks',
          id: l.id,
          label: l.name,
          sub: 'fast travel',
          world: l,
          ...at,
        },
        LAYER_STYLES.landmarks.color,
        6,
        0.8,
      )
    }
  }

  /** Used when the map art is unavailable — still genuinely readable. */
  private drawProceduralBackdrop() {
    const g = new Graphics()
    const step = this.mapSize / 20
    for (let i = 0; i <= 20; i++) {
      const p = i * step
      g.moveTo(p, 0).lineTo(p, this.mapSize)
      g.moveTo(0, p).lineTo(this.mapSize, p)
    }
    g.stroke({ color: 0x1e293b, width: 1 })
    g.rect(0, 0, this.mapSize, this.mapSize).stroke({
      color: 0x334155,
      width: 2,
    })
    this.tileLayer.addChild(g)
  }

  /* --- tiles ---------------------------------------------------------- */

  /** Loads only the tiles the viewport can actually see, at a fitting zoom. */
  private async refreshTiles() {
    const set = this.opts.tiles
    if (!set || this.destroyed) return

    const scale = this.world.scale.x
    // Pick the pyramid level whose pixels are closest to 1:1 on screen.
    const ideal = Math.max(
      0,
      Math.min(set.levels - 1, Math.round(Math.log2(1 / scale))),
    )
    const levelSize = set.size / 2 ** ideal
    const per = Math.max(1, levelSize / set.tile)
    const tileWorld = this.mapSize / per

    const view = this.app.screen
    const min = this.world.toLocal({ x: 0, y: 0 })
    const max = this.world.toLocal({ x: view.width, y: view.height })
    const x0 = Math.max(0, Math.floor(min.x / tileWorld) - 1)
    const x1 = Math.min(per - 1, Math.ceil(max.x / tileWorld) + 1)
    const y0 = Math.max(0, Math.floor(min.y / tileWorld) - 1)
    const y1 = Math.min(per - 1, Math.ceil(max.y / tileWorld) + 1)

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${ideal}/${x}/${y}`
        if (this.loadedTiles.has(key)) continue
        this.loadedTiles.add(key)

        const blob = await getTile(ideal, x, y)
        if (!blob || this.destroyed) continue
        const url = URL.createObjectURL(blob)
        try {
          const texture = await Assets.load<Texture>({
            src: url,
            parser: 'loadTextures',
          })
          if (this.destroyed) continue
          const sprite = new Sprite(texture)
          sprite.position.set(x * tileWorld, y * tileWorld)
          sprite.width = sprite.height = tileWorld
          // Coarser levels sit behind finer ones as they arrive.
          sprite.zIndex = ideal
          this.tileLayer.addChild(sprite)
          this.tileLayer.sortableChildren = true
        } finally {
          URL.revokeObjectURL(url)
        }
      }
    }
  }

  /* --- input ---------------------------------------------------------- */

  private bindInput() {
    const canvas = this.app.canvas
    let dragging = false
    let last = { x: 0, y: 0 }

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true
      last = { x: e.clientX, y: e.clientY }
    })
    window.addEventListener('pointerup', () => {
      dragging = false
      void this.refreshTiles()
    })
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) {
        this.world.x += e.clientX - last.x
        this.world.y += e.clientY - last.y
        last = { x: e.clientX, y: e.clientY }
        this.emitView()
        return
      }
      const rect = canvas.getBoundingClientRect()
      const hit = this.app.renderer.events.rootBoundary.hitTest(
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
      const entity = (hit as Marker)?.entity
      this.opts.onHover(entity, { x: e.clientX, y: e.clientY })
    })

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const rect = canvas.getBoundingClientRect()
        const p = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        const before = this.world.toLocal(p)
        const next = clamp(
          this.world.scale.x * Math.exp(-e.deltaY * 0.0015),
          MIN_ZOOM,
          MAX_ZOOM,
        )
        this.world.scale.set(next)
        const after = this.world.toLocal(p)
        this.world.x += (after.x - before.x) * next
        this.world.y += (after.y - before.y) * next
        this.rescaleMarkers()
        this.emitView()
        void this.refreshTiles()
      },
      { passive: false },
    )

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect()
      const hit = this.app.renderer.events.rootBoundary.hitTest(
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
      const sprite = hit as Marker
      this.select(sprite?.entity ? sprite : undefined)
      this.opts.onSelect(sprite?.entity)
    })
  }

  private emitView() {
    const c = this.world.toLocal({
      x: this.app.screen.width / 2,
      y: this.app.screen.height / 2,
    })
    const span = this.mapSize / (OVERWORLD_RANGE * 2)
    this.opts.onView({
      zoom: this.world.scale.x,
      mx: c.x / span - OVERWORLD_RANGE,
      my: OVERWORLD_RANGE - c.y / span,
    })
  }

  /** Screen point → in-game map coordinates, for the live readout. */
  screenToMap(x: number, y: number) {
    const rect = this.app.canvas.getBoundingClientRect()
    const p = this.world.toLocal({ x: x - rect.left, y: y - rect.top })
    const span = this.mapSize / (OVERWORLD_RANGE * 2)
    return {
      mx: p.x / span - OVERWORLD_RANGE,
      my: OVERWORLD_RANGE - p.y / span,
    }
  }

  private select(sprite: Sprite | undefined) {
    this.selectedMarker = sprite as Marker | undefined
    this.drawRing(this.selectedMarker)
  }

  private drawRing(marker: Marker | undefined) {
    this.ring.clear()
    if (!marker) return
    const scale = this.world.scale.x
    this.ring
      .circle(marker.x, marker.y, (marker.baseSize ?? 8) * 1.8) // world units
      .stroke({ color: 0x22d3ee, width: 2 / scale, alpha: 0.9 })
  }

  /* --- public API ----------------------------------------------------- */

  setLayerVisible(id: LayerId, visible: boolean) {
    const layer = this.layers.get(id)
    if (layer) layer.visible = visible
  }

  focus(entity: MapEntity, zoom = 4) {
    const { px, py } = this.toPixel(entity.mx, entity.my)
    this.world.scale.set(zoom)
    this.world.x = this.app.screen.width / 2 - px * zoom
    this.world.y = this.app.screen.height / 2 - py * zoom
    this.rescaleMarkers()
    this.emitView()
    void this.refreshTiles()
  }

  fit() {
    const pad = 40
    const scale = Math.min(
      (this.app.screen.width - pad) / this.mapSize,
      (this.app.screen.height - pad) / this.mapSize,
    )
    this.world.scale.set(scale)
    this.world.x = (this.app.screen.width - this.mapSize * scale) / 2
    this.world.y = (this.app.screen.height - this.mapSize * scale) / 2
    this.rescaleMarkers()
    this.emitView()
    void this.refreshTiles()
  }

  search(query: string, limit = 8): MapEntity[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return this.entities
      .filter((e) => e.label.toLowerCase().includes(q))
      .slice(0, limit)
  }

  get counts(): Record<LayerId, number> {
    const out = {} as Record<LayerId, number>
    for (const [id, layer] of this.layers) {
      out[id] = layer.children.filter((c) => c instanceof Sprite).length
    }
    return out
  }

  destroy() {
    this.destroyed = true
    try {
      this.app.destroy(true, { children: true })
    } catch {
      // Already gone (StrictMode double-invoke in development).
    }
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function colorOf(element: string | undefined): number {
  const css = elementColor(element)
  // Pixi wants a number; approximate the OKLCH tokens with fixed hexes rather
  // than shipping a colour-space converter for nine known values.
  const table: Record<string, number> = {
    Normal: 0x9ca3af,
    Fire: 0xef4444,
    Water: 0x3b82f6,
    Electricity: 0xfbbf24,
    Leaf: 0x4ade80,
    Dark: 0x9333ea,
    Dragon: 0x818cf8,
    Earth: 0xa78bfa,
    Ice: 0x67e8f9,
  }
  return table[element ?? ''] ?? (css ? 0x94a3b8 : 0x94a3b8)
}
