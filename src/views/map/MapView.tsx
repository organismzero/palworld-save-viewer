import { useEffect, useRef, useState } from 'react'

import type { SaveIndex } from '../../domain/types.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import {
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
