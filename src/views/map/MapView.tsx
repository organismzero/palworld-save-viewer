import { useEffect, useRef, useState } from 'react'

import type { SaveIndex } from '../../domain/types.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useSaveStore } from '../../store/saveStore.ts'
import {
  DEFAULT_FOG_OPACITY,
  LAYER_STYLES,
  MapController,
  type LayerId,
  type MapEntity,
} from './MapController.ts'
import { Panel, Pill } from '../../components/primitives.tsx'
import { count } from '../../lib/format.ts'

/**
 * Legend order — what a reader looks for, densest-signal first. Distinct from
 * the canvas draw order in `MapController`, which is about occlusion.
 */
const LEGEND_ORDER: LayerId[] = [
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
 * together they bury the handful of things you actually placed.
 */
const DEFAULT_VISIBLE: Record<LayerId, boolean> = {
  players: true,
  bases: true,
  structuresBuilt: true,
  pals: false,
  chests: false,
  structuresWorld: false,
  dungeons: false,
  landmarks: false,
  // On: you placed these deliberately, and there are only ever a handful.
  markers: true,
}

export function MapView({ index }: { index: SaveIndex }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<MapController>(null)
  const { data, tiles, status, bakeLabel, ensure } = useRefdataStore()

  const [hover, setHover] = useState<
    { e: MapEntity; x: number; y: number } | undefined
  >()
  const [selected, setSelected] = useState<MapEntity | undefined>()
  const [cursor, setCursor] = useState<{ mx: number; my: number }>()
  const [visible, setVisible] =
    useState<Record<LayerId, boolean>>(DEFAULT_VISIBLE)
  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState<Record<LayerId, number>>()
  const localData = useSaveStore((s) => s.localData)
  const [fogOn, setFogOn] = useState(true)
  const [fogOpacity, setFogOpacity] = useState(DEFAULT_FOG_OPACITY)
  /**
   * Bumped each time a controller finishes mounting.
   *
   * Layer visibility lives in React state but is applied to Pixi imperatively,
   * so it has to be re-applied against each new controller. This is what tells
   * the effect below that there is a new one to apply it to.
   */
  const [mounted, setMounted] = useState(0)

  useEffect(() => {
    void ensure()
  }, [ensure])

  // Rebuild when the art arrives, so a cold start shows the procedural map
  // first and upgrades in place rather than blocking on the network.
  useEffect(() => {
    const host = hostRef.current
    if (!host || status === 'loading') return

    const controller = new MapController({
      index,
      refdata: data,
      tiles,
      onHover: (e, at) => setHover(e ? { e, x: at.x, y: at.y } : undefined),
      onSelect: setSelected,
      onView: () => {},
    })
    controllerRef.current = controller
    void controller.mount(host).then(() => {
      setCounts(controller.counts)
      setMounted((n) => n + 1)
    })

    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [index, data, tiles, status])

  /**
   * Push layer visibility into Pixi.
   *
   * A fresh controller starts with every layer visible, and the effect above
   * re-runs whenever reference data or the baked tiles arrive. Without this,
   * layers the user turned off — or that default to off — silently came back
   * the moment the map art finished loading, while their toggle still read
   * "off". Keying on `mounted` as well as `visible` covers both cases with one
   * code path.
   */
  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    for (const [id, on] of Object.entries(visible)) {
      controller.setLayerVisible(id as LayerId, on)
    }
  }, [visible, mounted])

  /**
   * Push the client's own save into Pixi.
   *
   * Same shape as the visibility effect above, and for the same reason — but
   * here it also spares a rebuild. `LocalData.sav` almost always arrives as a
   * second drop, long after the map is up, and folding it into the controller's
   * dependency list would tear down and re-create several thousand sprites to
   * add a fog texture and one pin.
   */
  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    controller.setLocalData(localData)
    setCounts(controller.counts)
  }, [localData, mounted])

  // Separate from the rebuild above so dragging the opacity slider sets one
  // number per frame instead of re-rasterising a megapixel of mask. Depends on
  // `localData` all the same: a rebuild makes a fresh sprite that has not been
  // told whether the toggle is off.
  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    controller.setFogVisible(fogOn)
    controller.setFogOpacity(fogOpacity)
  }, [fogOn, fogOpacity, localData, mounted])

  const overworldFog = localData?.fog.find((f) => f.map === 'overworld')
  const hasFog = overworldFog !== undefined
  const explored = overworldFog
    ? Math.round(overworldFog.exploredFraction * 100)
    : undefined

  // Computed in the change handler rather than during render: the entity list
  // lives on the controller behind a ref, and reading a ref while rendering
  // can leave the UI stale.
  const [results, setResults] = useState<MapEntity[]>([])
  const runSearch = (q: string) => {
    setQuery(q)
    setResults(controllerRef.current?.search(q) ?? [])
  }

  return (
    <div className="relative h-[calc(100dvh-3.25rem)] w-full overflow-hidden">
      <div
        ref={hostRef}
        className="absolute inset-0"
        onPointerMove={(e) =>
          setCursor(controllerRef.current?.screenToMap(e.clientX, e.clientY))
        }
      />

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Panel className="px-5 py-3">
            <div className="label">{bakeLabel ?? 'Preparing map'}</div>
          </Panel>
        </div>
      )}

      {status === 'degraded' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
          <Panel className="flex items-center gap-3 px-4 py-2">
            <Pill tone="warn">no game art</Pill>
            <span className="text-sm text-[var(--color-muted)]">
              Showing a coordinate grid and raw ids. Positions are exact.
            </span>
            <button
              type="button"
              onClick={() => void ensure(true)}
              className="rounded-[6px] border border-[var(--color-line)] px-2 py-1 text-xs hover:border-[var(--color-signal)]"
            >
              Retry
            </button>
          </Panel>
        </div>
      )}

      {/* Search */}
      <div className="absolute top-4 left-4 w-64">
        <Panel className="overflow-hidden">
          <input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            aria-label="Find a pal, base or chest on the map"
            placeholder="Find a pal, base, chest…"
            className="w-full bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)]"
          />
          {results.length > 0 && (
            <ul className="max-h-64 overflow-y-auto border-t border-[var(--color-line)]/50">
              {results.map((r) => (
                <li key={r.kind + r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      controllerRef.current?.focus(r)
                      setSelected(r)
                      runSearch('')
                    }}
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--color-raised)]"
                  >
                    <span className="truncate">{r.label}</span>
                    <span className="label shrink-0">
                      {LAYER_STYLES[r.kind].label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Layers */}
      <div className="absolute top-4 right-4">
        <Panel className="p-2">
          <ul className="space-y-0.5">
            {LEGEND_ORDER.map((id) => {
              const style = LAYER_STYLES[id]
              return (
                <li key={id}>
                  <button
                    type="button"
                    // Visibility is carried by opacity alone, which is invisible
                    // to a screen reader.
                    aria-pressed={visible[id]}
                    title={`${style.label} — ${style.hint}`}
                    // State only — the effect above is what talks to Pixi, so
                    // toggling and rebuilding cannot disagree.
                    onClick={() => setVisible((v) => ({ ...v, [id]: !v[id] }))}
                    className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-xs transition-colors hover:bg-[var(--color-raised)] ${
                      visible[id] ? '' : 'opacity-35'
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: style.css }}
                    />
                    <span className="flex-1">{style.label}</span>
                    <span className="num text-[var(--color-muted)]">
                      {counts ? count(counts[id] ?? 0) : '—'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* Fog of war. Not in the list above: it is a raster covering the
              whole map, not a countable set of markers. */}
          <div className="mt-2 border-t border-[var(--color-line)] pt-2">
            {hasFog ? (
              <>
                <button
                  type="button"
                  aria-pressed={fogOn}
                  title="Dim the ground this client has never explored, using the mask from LocalData.sav"
                  onClick={() => setFogOn((on) => !on)}
                  className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-xs transition-colors hover:bg-[var(--color-raised)] ${
                    fogOn ? '' : 'opacity-35'
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full border border-[var(--color-muted)]" />
                  <span className="flex-1">Fog of war</span>
                  <span className="num text-[var(--color-muted)]">
                    {explored === undefined ? '—' : `${explored}%`}
                  </span>
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(fogOpacity * 100)}
                  disabled={!fogOn}
                  aria-label="Fog opacity"
                  onChange={(e) => setFogOpacity(Number(e.target.value) / 100)}
                  className="mt-1 w-full accent-[var(--color-signal)] disabled:opacity-35"
                />
              </>
            ) : (
              <LocalDataPrompt />
            )}
          </div>

          <button
            type="button"
            onClick={() => controllerRef.current?.fit()}
            title="Zoom out until the whole island is in view"
            className="mt-2 w-full rounded-[4px] border border-[var(--color-line)] px-2 py-1 text-xs hover:border-[var(--color-signal)]"
          >
            Fit
          </button>
        </Panel>
      </div>

      {/* Live coordinate readout — small, unboxed, mono. */}
      <div className="pointer-events-none absolute bottom-4 left-4 text-[11px]">
        <div className="num text-[var(--color-muted)]">
          {cursor
            ? `${Math.round(cursor.mx)}, ${Math.round(cursor.my)}`
            : '—, —'}
        </div>
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+12px)]"
          style={{ left: hover.x, top: hover.y }}
        >
          <Panel className="px-2.5 py-1.5">
            <div className="text-xs whitespace-nowrap">{hover.e.label}</div>
            {hover.e.sub && (
              <div className="label whitespace-nowrap">{hover.e.sub}</div>
            )}
          </Panel>
        </div>
      )}

      {/* Selection detail */}
      {selected && (
        <div className="absolute right-4 bottom-4 w-72">
          <Panel className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-lg leading-tight">
                  {selected.label}
                </div>
                <div className="label mt-1">
                  {LAYER_STYLES[selected.kind].label}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(undefined)}
                className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {selected.sub && <p className="mt-2 text-sm">{selected.sub}</p>}
            <dl className="mt-3 space-y-1 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="label">map</dt>
                <dd className="num">
                  {Math.round(selected.mx)}, {Math.round(selected.my)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="label">world</dt>
                <dd className="num text-[var(--color-muted)]">
                  {selected.world.x.toFixed(0)}, {selected.world.y.toFixed(0)}
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}
    </div>
  )
}

/**
 * The affordance for a file that is always a second drop.
 *
 * `LocalData.sav` lives with the game client rather than the server save, so it
 * is never in the folder the world came from — and the drop zone is gone by the
 * time anyone is looking at the map. A picker rather than a drop target, for
 * the same reason the missing-inventory prompt in the Guild view is one:
 * somebody who got this far wants one specific file.
 *
 * Shaped as a legend row, dimmed like a layer that is switched off, with the
 * explanation in the tooltip. It said all that in prose to begin with, which
 * set the width of the whole panel — the legend is a narrow column of short
 * labels and one paragraph is enough to stretch it. Nothing in here may be
 * wider than "Built by players".
 */
function LocalDataPrompt() {
  const acceptFiles = useSaveStore((s) => s.acceptFiles)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label="Add LocalData.sav to show fog of war"
        title="Fog of war comes from LocalData.sav, which the game keeps with the client rather than in the server save. Click to add it."
        className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-xs opacity-35 transition-colors transition-opacity hover:bg-[var(--color-raised)] hover:opacity-100"
      >
        <span className="h-2 w-2 shrink-0 rounded-full border border-[var(--color-muted)]" />
        <span className="flex-1">Fog of war</span>
        {/* Sits in the same column as the layer counts, so the rows line up. */}
        <span className="num text-[var(--color-muted)]" aria-hidden="true">
          +
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".sav,.json,application/json"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          if (files) void acceptFiles(Array.from(files))
        }}
      />
    </>
  )
}
