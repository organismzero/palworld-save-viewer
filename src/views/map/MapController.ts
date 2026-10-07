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
  CanvasSource,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type ICanvas,
} from 'pixi.js'

import {
  mapToPixel,
  pixelToMap,
  savToMapAuto,
  worldPerPixel,
} from '../../domain/coords.ts'
import { baseLabel } from '../../domain/bases.ts'
import { itemName } from '../../domain/names.ts'
import { elementColor } from '../../lib/color.ts'
import type {
  FogMask,
  Guid,
  LocalDataPayload,
  SaveIndex,
  Vec3,
} from '../../domain/types.ts'
import type { Refdata, TileSet } from '../../refdata/refdata.ts'
import { getTile } from '../../refdata/refdata.ts'
import { guildTints, type Tint } from './guildTint.ts'
import { DEFAULT_FOG_OPACITY, type MapViewport } from './params.ts'

export { DEFAULT_FOG_OPACITY }

export type LayerId =
  | 'structuresBuilt'
  | 'structuresWorld'
  | 'chests'
  | 'pals'
  | 'players'
  | 'bases'
  | 'dungeons'
  | 'landmarks'
  | 'markers'

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
  markers: {
    label: 'Map pins',
    hint: 'Markers a guild placed, which are in the save, and pins you placed by hand, which are in LocalData.sav. The icon is stored as a number and the game ships no names for it.',
    color: 0xf472b6,
    css: 'oklch(0.74 0.18 350)',
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
  'markers',
]

type Marker = Sprite & {
  entity?: MapEntity
  baseSize?: number
  /** The colour it was plotted in, to go back to when guild colours are off. */
  ownColor?: number
}

export interface MapEntity {
  kind: LayerId
  id: string
  label: string
  sub?: string
  world: Vec3
  mx: number
  my: number
  /** Who it belongs to: a pal's owner, a structure's builder, a base's guild. */
  owner?: string
  /** What a container holds, by display name. */
  holds?: string[]
  /** The guild it belongs to, for colouring by guild. */
  guildId?: Guid
}

/** The layers that colouring by guild repaints. */
const TINTED: ReadonlySet<LayerId> = new Set([
  'bases',
  'structuresBuilt',
  'markers',
])

/** One row of the guild colour key. */
export interface GuildKey {
  id: Guid
  name: string
  css: string
}

/** A search result, with the reason when it is not the marker's own name. */
export interface MapHit {
  entity: MapEntity
  /** "owned by Ada", "holds Paldium Fragment". Absent for a match on the name. */
  via?: string
}

interface Options {
  index: SaveIndex
  refdata?: Refdata
  tiles?: TileSet
  /** The client's own save, if one has been dropped. Supplies fog and pins. */
  local?: LocalDataPayload
  onHover: (e: MapEntity | undefined, screen: { x: number; y: number }) => void
  onSelect: (e: MapEntity | undefined) => void
  /** The user moved the map. Not fired for `fit`, `setView` or an export. */
  onView: (v: MapViewport) => void
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 14

/**
 * The map size a zoom figure is quoted against.
 *
 * Pixi's scale is screen pixels per pixel of the map image, so the same number
 * means something else over art baked at another size. Everything that leaves
 * this class (`onView`) or enters it (`setView`) is in terms of a 4096px map.
 */
const ZOOM_BASIS = 4096

/** Further than this between press and release and it was a drag, not a click. */
const CLICK_SLOP = 4

/** One press of an arrow key, in screen pixels. */
export const PAN_STEP = 80
/** One press of `+` or a zoom button. */
export const ZOOM_STEP = 1.5

/**
 * The canvas chrome, kept in step with the CSS tokens by hand.
 *
 * Pixi needs numbers, so these cannot read `var(--color-void)` — but they are
 * the same values, and the map sits inside a framed panel that would otherwise
 * visibly disagree with them. `--color-void`, `--color-line`-ish at full opacity
 * over that ground, and `--color-signal` for the selection ring.
 */
const GROUND = 0x04090e
const GRID = 0x14303d
const GRID_EDGE = 0x1f4a5c
const SELECTION = 0x61dcef

/** Matches the Pixi clear colour, so fog reads as absence rather than paint. */
const FOG_TINT = GROUND

/**
 * Largest island export, in pixels.
 *
 * `docs/spike-m0.md` records why 4096 rather than the 8192 the test machine
 * reported: older and mobile GPUs cap `MAX_TEXTURE_SIZE` there, and a
 * full-resolution island is 67 MB of RGBA. Same number the tile bake targets.
 */
const MAX_EXPORT_PX = 4096

/**
 * Pixi's extracted canvas → a PNG Blob.
 *
 * `extract.canvas()` rather than `extract.image()`: the latter hands back an
 * `ImageLike` wrapping a data URL, which would mean encoding the whole map to
 * base64 and parsing it back out again just to reach a Blob.
 */
function canvasToBlob(canvas: ICanvas): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const el = canvas as unknown as HTMLCanvasElement
    el.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas is empty'))),
      'image/png',
    )
  })
}

export class MapController {
  private app = new Application()
  private world = new Container()
  private tileLayer = new Container()
  private layers = new Map<LayerId, Container>()
  private dot = Texture.WHITE
  private entities: MapEntity[] = []
  private markerOf = new Map<MapEntity, Marker>()
  private unbind: (() => void)[] = []
  private tints = new Map<Guid, Tint>()
  private byGuild = false
  /** The pals the Pals tab's filter lets through, or nothing for all. */
  private palFilter?: ReadonlySet<string>
  /** Base build-radius rings, which are drawn shapes rather than markers. */
  private rings: { shape: Graphics; guildId?: Guid }[] = []
  private ring = new Graphics()
  /**
   * Holds the fog sprite, and exists so the fog's z-order is decided once in
   * `mount` rather than recomputed every time a new mask arrives.
   */
  private fogLayer = new Container()
  private fogOpacity = DEFAULT_FOG_OPACITY
  private selectedMarker?: Marker
  private destroyed = false
  /**
   * `mount` is async, and `MapView` hands over the client save from an effect
   * that can run first. Everything that touches the scene graph checks this.
   */
  private mounted = false
  private loadedTiles = new Set<string>()
  /** Baked map edge length in px; the procedural fallback uses the same space. */
  private mapSize = 4096

  constructor(private opts: Options) {}

  async mount(host: HTMLElement) {
    await this.app.init({
      background: GROUND,
      antialias: true,
      resizeTo: host,
      preference: 'webgl',
    })
    if (this.destroyed) return
    host.appendChild(this.app.canvas)

    if (this.opts.tiles) this.mapSize = this.opts.tiles.size

    this.app.stage.addChild(this.world)
    this.world.addChild(this.tileLayer)
    // Above the map art, below every marker: fog is there to dim terrain, not
    // to hide the things you opened the map to find.
    this.fogLayer.alpha = this.fogOpacity
    this.world.addChild(this.fogLayer)

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

    this.mounted = true
    this.build()
    this.applyFog()
    this.fit()
    this.bindInput()
    void this.refreshTiles()
  }

  /* --- the client's own save ------------------------------------------- */

  /**
   * Swaps in a `LocalData` that arrived after the map was already up, which is
   * the normal case: it is a separate file from a separate folder, so it is
   * almost always a second drop.
   */
  setLocalData(local: LocalDataPayload | undefined) {
    this.opts.local = local
    // Before `mount` there is no scene graph to put any of this into, and
    // nothing is lost: `mount` reads `opts.local` and applies it itself.
    if (!this.mounted) return
    this.buildMarkers()
    this.applyTints()
    this.applyFog()
    this.rescaleMarkers()
  }

  setFogOpacity(alpha: number) {
    this.fogOpacity = clamp(alpha, 0, 1)
    this.fogLayer.alpha = this.fogOpacity
  }

  setFogVisible(visible: boolean) {
    this.fogLayer.visible = visible
  }

  private overworldMask(): FogMask | undefined {
    // The World Tree mask is read and counted but never drawn: there is no tree
    // map view to draw it over, and `place()` below discards tree entities for
    // the same reason.
    return this.opts.local?.fog.find((f) => f.map === 'overworld')
  }

  /**
   * Builds the fog sprite, or removes it.
   *
   * The mask is a 1024² alpha channel and the map is 4096² pixels, so this is a
   * 4× magnification of a texture the game already stored with a soft edge —
   * Pixi's default linear filtering is exactly right and the seam stays
   * invisible. The sprite covers the identical rect as the tile layer, which is
   * what makes the mapping a plain stretch with no offset: the mask is in map
   * space, and so is `mapToPixel`.
   */
  private applyFog() {
    const mask = this.overworldMask()

    this.fogLayer
      .removeChildren()
      .forEach((c) => c.destroy({ texture: true, textureSource: true }))
    if (!mask) return

    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = mask.size
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const image = ctx.createImageData(mask.size, mask.size)
    for (let i = 0; i < mask.alpha.length; i++) {
      // White, so `tint` has something to multiply — the file's own RGB is
      // zero throughout, which would swallow any colour we asked for.
      image.data[i * 4] = 255
      image.data[i * 4 + 1] = 255
      image.data[i * 4 + 2] = 255
      image.data[i * 4 + 3] = mask.alpha[i]!
    }
    ctx.putImageData(image, 0, 0)

    // Built directly rather than through `Texture.from`, which would put the
    // canvas in Pixi's global texture cache — wrong for a texture this class
    // creates and destroys every time a new client save is dropped.
    const sprite = new Sprite(
      new Texture({ source: new CanvasSource({ resource: canvas }) }),
    )
    sprite.position.set(0, 0)
    sprite.width = sprite.height = this.mapSize
    sprite.tint = FOG_TINT
    this.fogLayer.addChild(sprite)
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

  /**
   * Adds one marker sprite and registers its entity for search and picking.
   *
   * Shared by `build` and `buildMarkers` rather than closed over inside
   * `build`, because the pins layer has to be rebuildable on its own — the
   * file it comes from usually arrives after everything else is on screen.
   */
  private addMarker(
    e: MapEntity,
    color: number,
    size: number,
    alpha = 1,
  ): void {
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
    s.ownColor = color
    this.layers.get(e.kind)!.addChild(s)
    this.entities.push(e)
    this.markerOf.set(e, s)
  }

  private place(pos: Vec3 | undefined) {
    if (!pos) return undefined
    const at = savToMapAuto(pos.x, pos.y)
    // The World Tree lives in its own coordinate space and its own image;
    // showing those entities on the overworld would scatter them.
    return at.map === 'overworld' ? at : undefined
  }

  /**
   * The pins, rebuilt from scratch. Cheap: there are a handful.
   *
   * Two sources share the layer. A guild's markers are in the level save and
   * every member sees them; the hand-placed pins are one client's own, from
   * `LocalData.sav`, and usually arrive after the map is up — which is why this
   * can be re-run on its own.
   */
  private buildMarkers() {
    const layer = this.layers.get('markers')
    if (!layer) return
    layer.removeChildren().forEach((c) => c.destroy())
    for (const e of this.entities) {
      if (e.kind === 'markers') this.markerOf.delete(e)
    }
    this.entities = this.entities.filter((e) => e.kind !== 'markers')

    for (const guild of this.opts.index.guilds) {
      for (const m of guild.markers) {
        const at = this.place(m.pos)
        if (!at) continue
        const owner = m.ownerPlayerUid
          ? this.opts.index.playerByUid.get(m.ownerPlayerUid)?.name
          : undefined
        this.addMarker(
          {
            kind: 'markers',
            id: m.markerId,
            label: `${guild.name} marker`,
            // The icon is a bare number with no names anywhere in the game's
            // data, so it is shown as one rather than guessed at.
            sub: [`icon ${m.icon}`, owner ? `placed by ${owner}` : undefined]
              .filter(Boolean)
              .join(' · '),
            owner,
            guildId: guild.groupId,
            world: m.pos,
            ...at,
          },
          LAYER_STYLES.markers.color,
          12,
        )
      }
    }

    for (const [i, m] of (this.opts.local?.markers ?? []).entries()) {
      if (m.at.map !== 'overworld') continue
      this.addMarker(
        {
          kind: 'markers',
          id: `pin-${i}`,
          label: `Pin ${m.iconType}`,
          sub: 'placed by hand',
          world: m.pos,
          mx: m.at.mx,
          my: m.at.my,
        },
        LAYER_STYLES.markers.color,
        14,
      )
    }
  }

  private build() {
    const { index, refdata } = this.opts
    const add = (e: MapEntity, color: number, size: number, alpha = 1) =>
      this.addMarker(e, color, size, alpha)

    const place = (pos: Vec3 | undefined) => this.place(pos)
    this.tints = guildTints(index.guilds)

    for (const [i, base] of index.bases.entries()) {
      const at = place(base.pos)
      if (!at) continue
      // A base's build radius, drawn to scale.
      const { px, py } = this.toPixel(at.mx, at.my)
      // `areaRange` is a real world-space radius, so it converts through the
      // image's world scale — not through map coordinates.
      const r = base.areaRange / worldPerPixel(this.mapSize)
      // Drawn white and tinted, so colouring by guild is one assignment
      // rather than a redraw.
      const shape = new Graphics()
        .circle(px, py, r)
        .fill({ color: 0xffffff, alpha: 0.07 })
        .stroke({ color: 0xffffff, width: 1.5, alpha: 0.5 })
      shape.tint = LAYER_STYLES.bases.color
      this.layers.get('bases')!.addChild(shape)
      this.rings.push({ shape, guildId: base.groupId })
      add(
        {
          kind: 'bases',
          id: base.baseId,
          // Shared with the base explorer so a base is called the same thing
          // wherever it appears.
          label: baseLabel(base, i + 1, refdata?.landmarks),
          sub: `${index.structuresByBase.get(base.baseId)?.length ?? 0} structures`,
          owner: base.groupId
            ? index.guildById.get(base.groupId)?.name
            : undefined,
          guildId: base.groupId,
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
          // The asset id only when there is no reference data to name it.
          label:
            refdata?.structures[s.mapObjectId.toLowerCase()]?.name ??
            s.mapObjectId,
          sub:
            [
              stacks !== undefined ? `${stacks} stacks` : undefined,
              builder ? `built by ${builder}` : undefined,
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
          owner: builder,
          guildId: builtByPlayer ? s.groupId : undefined,
          holds: s.containerId
            ? index.containerById
                .get(s.containerId)
                ?.slots.map((slot) => itemName(refdata, slot.staticId))
            : undefined,
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
          owner: pal.ownerPlayerUid
            ? index.playerByUid.get(pal.ownerPlayerUid)?.name
            : undefined,
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
          // Only a player save records a true position; Level.sav's
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

    this.buildMarkers()
    this.applyTints()
    this.applyPalFilter()
  }

  /**
   * Colours bases and player-built structures by the guild that owns them, or
   * puts them back.
   *
   * Only the layers that read as "whose is this", a guild's own markers among
   * them. Pals keep their element colours, and a pin placed by hand belongs to
   * no guild and stays as it was.
   */
  setTintByGuild(on: boolean) {
    this.byGuild = on
    if (this.mounted) this.applyTints()
  }

  private applyTints() {
    const pick = (guildId: Guid | undefined, own: number) =>
      (this.byGuild && guildId ? this.tints.get(guildId)?.color : undefined) ??
      own
    for (const [entity, marker] of this.markerOf) {
      if (!TINTED.has(entity.kind)) continue
      marker.tint = pick(entity.guildId, marker.ownColor ?? 0xffffff)
    }
    for (const { shape, guildId } of this.rings) {
      shape.tint = pick(guildId, LAYER_STYLES.bases.color)
    }
  }

  /**
   * Narrows the Pals layer to the pals another view is showing.
   *
   * Hidden rather than removed: the filter changes far more often than the
   * save does, and a hidden sprite costs nothing to draw or to hit-test.
   */
  setPalFilter(ids: ReadonlySet<string> | undefined) {
    this.palFilter = ids
    if (this.mounted) this.applyPalFilter()
  }

  private applyPalFilter() {
    for (const [entity, marker] of this.markerOf) {
      if (entity.kind !== 'pals') continue
      marker.visible = !this.palFilter || this.palFilter.has(entity.id)
    }
  }

  /** How many pals the filter leaves on the map, or nothing with no filter. */
  get palsShown(): number | undefined {
    if (!this.palFilter) return undefined
    let n = 0
    for (const e of this.entities) {
      if (e.kind === 'pals' && this.palFilter.has(e.id)) n++
    }
    return n
  }

  private filteredOut(e: MapEntity): boolean {
    return (
      e.kind === 'pals' &&
      this.palFilter !== undefined &&
      !this.palFilter.has(e.id)
    )
  }

  /** The guilds that have anything on the map to be told apart by colour. */
  get guildKey(): GuildKey[] {
    const seen = new Set<Guid>()
    for (const e of this.entities) if (e.guildId) seen.add(e.guildId)
    return this.opts.index.guilds
      .filter((g) => seen.has(g.groupId) && this.tints.has(g.groupId))
      .map((g) => ({
        id: g.groupId,
        name: g.name,
        css: this.tints.get(g.groupId)!.css,
      }))
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
    g.stroke({ color: GRID, width: 1 })
    g.rect(0, 0, this.mapSize, this.mapSize).stroke({
      color: GRID_EDGE,
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
          // Coarser levels sit behind finer ones as they arrive. Level 0 is
          // the sharpest, so the order is the level negated: the other way
          // round, the fitted view's coarse tiles stayed on top for good and
          // zooming in never got any sharper.
          sprite.zIndex = -ideal
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
    let down = { x: 0, y: 0 }

    const hit = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return this.app.renderer.events.rootBoundary.hitTest(
        e.clientX - rect.left,
        e.clientY - rect.top,
      ) as Marker | undefined
    }

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true
      last = down = { x: e.clientX, y: e.clientY }
    })
    // On the window, so a drag that ends outside the canvas still ends.
    const onUp = () => {
      dragging = false
      void this.refreshTiles()
    }
    window.addEventListener('pointerup', onUp)
    this.unbind.push(() => window.removeEventListener('pointerup', onUp))

    canvas.addEventListener('pointermove', (e) => {
      if (dragging) {
        this.world.x += e.clientX - last.x
        this.world.y += e.clientY - last.y
        last = { x: e.clientX, y: e.clientY }
        this.emitView()
        return
      }
      this.opts.onHover(hit(e)?.entity, { x: e.clientX, y: e.clientY })
    })

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const rect = canvas.getBoundingClientRect()
        this.zoomAbout(
          { x: e.clientX - rect.left, y: e.clientY - rect.top },
          Math.exp(-e.deltaY * 0.0015),
        )
      },
      { passive: false },
    )

    // `pointerup`, not `click`: a click fires at the end of every drag too, so
    // panning the map with the pointer over a marker selected it, and panning
    // from open ground threw the selection away.
    canvas.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP)
        return
      const entity = hit(e)?.entity
      this.setSelection(entity)
      this.opts.onSelect(entity)
    })
  }

  /** Zooms by `factor`, keeping the screen point `p` over the same ground. */
  private zoomAbout(p: { x: number; y: number }, factor: number) {
    const before = this.world.toLocal(p)
    const next = clamp(this.world.scale.x * factor, MIN_ZOOM, MAX_ZOOM)
    this.world.scale.set(next)
    const after = this.world.toLocal(p)
    this.world.x += (after.x - before.x) * next
    this.world.y += (after.y - before.y) * next
    this.rescaleMarkers()
    this.emitView()
    void this.refreshTiles()
  }

  private get centre() {
    return { x: this.app.screen.width / 2, y: this.app.screen.height / 2 }
  }

  private emitView() {
    const c = this.world.toLocal(this.centre)
    this.opts.onView({
      zoom: (this.world.scale.x * this.mapSize) / ZOOM_BASIS,
      ...pixelToMap(c.x, c.y, this.mapSize, this.mapSize),
    })
  }

  /** Screen point → in-game map coordinates, for the live readout. */
  screenToMap(x: number, y: number) {
    const rect = this.app.canvas.getBoundingClientRect()
    const p = this.world.toLocal({ x: x - rect.left, y: y - rect.top })
    return pixelToMap(p.x, p.y, this.mapSize, this.mapSize)
  }

  /**
   * Rings a marker, or nothing.
   *
   * Public because a selection is as often made from outside the canvas (the
   * search box, a link, a jump from another view) as by clicking on it, and
   * those used to select without the ring ever being drawn.
   */
  setSelection(entity: MapEntity | undefined) {
    this.selectedMarker = entity ? this.markerOf.get(entity) : undefined
    this.drawRing(this.selectedMarker)
  }

  private drawRing(marker: Marker | undefined) {
    this.ring.clear()
    if (!marker) return
    const scale = this.world.scale.x
    this.ring
      // In screen pixels, like the marker it surrounds: a fixed margin outside
      // the dot at every zoom. Sized in map pixels it was a speck when fitted
      // and swallowed the neighbourhood when zoomed in.
      .circle(marker.x, marker.y, ((marker.baseSize ?? 8) / 2 + 6) / scale)
      .stroke({ color: SELECTION, width: 2 / scale, alpha: 0.9 })
  }

  /* --- public API ----------------------------------------------------- */

  /** Whether `mount` has finished, so there are entities to ask about. */
  get ready(): boolean {
    return this.mounted && !this.destroyed
  }

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

  /** Looks at a place a link or an earlier visit named. */
  setView(v: MapViewport) {
    const scale = clamp(
      (v.zoom * ZOOM_BASIS) / this.mapSize,
      MIN_ZOOM,
      MAX_ZOOM,
    )
    const { px, py } = this.toPixel(v.mx, v.my)
    this.world.scale.set(scale)
    this.world.x = this.centre.x - px * scale
    this.world.y = this.centre.y - py * scale
    this.rescaleMarkers()
    void this.refreshTiles()
  }

  /** A zoom button or key: about the middle of the screen. */
  zoomBy(factor: number) {
    this.zoomAbout(this.centre, factor)
  }

  /** An arrow key. Positive `dx` looks further east, so the map slides west. */
  panBy(dx: number, dy: number) {
    this.world.x -= dx
    this.world.y -= dy
    this.emitView()
    void this.refreshTiles()
  }

  /**
   * Zooms out until the whole island is in view.
   *
   * Does not report itself through `onView`: fitted is where the map starts,
   * and a view that has never been moved should not put a position in its link.
   */
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
    void this.refreshTiles()
  }

  /**
   * The map as a PNG — either what is on screen, or the whole island.
   *
   * Layer visibility comes for free: the legend toggles set `Container.visible`
   * and `extract` walks the live scene graph, so the file is exactly what you
   * were looking at, fog included — the fog layer lives inside `world`.
   *
   * `island` deliberately does **not** call `fit()`. That would also fire
   * `emitView()` and an async `refreshTiles()`, pushing a spurious viewport
   * change into React in the middle of an export. It sets the transform
   * directly and restores it before returning, so nothing outside this method
   * ever observes the change.
   *
   * Capped at {@link MAX_EXPORT_PX}: a full-resolution island is 67 MB of RGBA
   * and older and mobile GPUs cap `MAX_TEXTURE_SIZE` at 4096, which is the same
   * reasoning that fixed the tile bake at that size.
   */
  async exportImage(scope: 'viewport' | 'island'): Promise<Blob> {
    if (scope === 'viewport') {
      return canvasToBlob(this.app.renderer.extract.canvas(this.app.stage))
    }

    const { x, y } = this.world.position
    const scale = this.world.scale.x
    try {
      const target = Math.min(1, MAX_EXPORT_PX / this.mapSize)
      const side = this.mapSize * target
      this.world.position.set(0, 0)
      this.world.scale.set(target)
      // Markers are sized in *screen* pixels, so they need rescaling against
      // the export transform or they come out the wrong size on the page.
      this.rescaleMarkers()
      return canvasToBlob(
        this.app.renderer.extract.canvas({
          target: this.world,
          frame: new Rectangle(0, 0, side, side),
        }),
      )
    } finally {
      this.world.position.set(x, y)
      this.world.scale.set(scale)
      this.rescaleMarkers()
    }
  }

  /** Whatever was plotted with this id, on any layer. */
  find(id: string): MapEntity | undefined {
    return this.entities.find((e) => e.id === id)
  }

  /**
   * The marker a link named: a layer and an id, or the start of one.
   *
   * An ambiguous prefix resolves to nothing rather than to the first match, on
   * the rule `resolveShortId` follows everywhere else.
   */
  resolve(layer: LayerId, id: string): MapEntity | undefined {
    let found: MapEntity | undefined
    for (const e of this.entities) {
      if (e.kind !== layer) continue
      if (e.id === id) return e
      if (!e.id.startsWith(id)) continue
      if (found) return undefined
      found = e
    }
    return found
  }

  /**
   * Everything matching, best first, with no limit: the caller decides how many
   * to show and can say how many it left out.
   *
   * A marker matches on its own name, on who it belongs to, or on what it
   * holds. Name matches come first, since a name is what is usually typed; the
   * other two say why they are in the list, or "Paldium" returning forty rows
   * all reading "Wooden Chest" would look like a bug.
   */
  search(query: string): MapHit[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const byName: MapHit[] = []
    const byOwner: MapHit[] = []
    const byContents: MapHit[] = []
    for (const entity of this.entities) {
      // A pal the filter has hidden is not on the map to be found.
      if (this.filteredOut(entity)) continue
      if (entity.label.toLowerCase().includes(q)) {
        byName.push({ entity })
      } else if (entity.owner?.toLowerCase().includes(q)) {
        byOwner.push({ entity, via: entity.owner })
      } else {
        const item = entity.holds?.find((h) => h.toLowerCase().includes(q))
        if (item) byContents.push({ entity, via: `holds ${item}` })
      }
    }
    return [...byName, ...byOwner, ...byContents]
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
    for (const off of this.unbind) off()
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
