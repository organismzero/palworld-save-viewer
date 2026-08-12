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
import {
  KeyHint,
  Panel,
  Pill,
  PromptBar,
} from '../../components/primitives.tsx'
import {
  Button,
  Checkbox,
  IconButton,
  RangeControl,
} from '../../components/controls.tsx'
import { cn } from '../../lib/utils.ts'
import { count } from '../../lib/format.ts'
import { downloadBlob, exportName } from '../../lib/export.ts'

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
  const [filterOpen, setFilterOpen] = useState(true)
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

  /**
   * PNG export. Held as the in-flight scope rather than a boolean so the
   * button that was pressed is the one that shows it is working.
   */
  const [saving, setSaving] = useState<'viewport' | 'island'>()
  const fileName = useSaveStore((s) => s.fileName)
  const savePng = async (scope: 'viewport' | 'island') => {
    const controller = controllerRef.current
    if (!controller) return
    setSaving(scope)
    try {
      const blob = await controller.exportImage(scope)
      downloadBlob(exportName(fileName, `map-${scope}`, 1, 'png'), blob)
    } finally {
      setSaving(undefined)
    }
  }

  const overworldFog = localData?.fog.find((f) => f.map === 'overworld')
  const hasFog = overworldFog !== undefined
  const explored = overworldFog
    ? Math.round(overworldFog.exploredFraction * 100)
    : undefined

  /**
   * The two keys this screen prints, and the only two it claims.
   *
   * `F` opens and closes the filter panel — which is what the layer list has
   * always been, so the key needed wiring rather than a feature. `R` re-centres
   * whatever is selected, which is whatever the card in the corner is describing:
   * a base, a player, a chest, a pal. It only appears in the prompt row when
   * there is a selection to snap to, on the same rule the shell's `Esc` follows.
   *
   * The guard on `isTyping` is the one the global shortcuts use, or typing "for"
   * in the map's search box would close the panel and throw the world across the
   * island.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target?.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '') ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return
      }

      const key = e.key.toLowerCase()
      if (key === 'f') {
        e.preventDefault()
        setFilterOpen((open) => !open)
        return
      }
      if (key !== 'r' || !selected) return
      e.preventDefault()
      controllerRef.current?.focus(selected)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  // Computed in the change handler rather than during render: the entity list
  // lives on the controller behind a ref, and reading a ref while rendering
  // can leave the UI stale.
  const [results, setResults] = useState<MapEntity[]>([])
  const runSearch = (q: string) => {
    setQuery(q)
    setResults(controllerRef.current?.search(q) ?? [])
  }

  return (
    /* The map is a framed screen, as the game frames it: a hairline and four
       corner ticks around the world, with everything else floating over it. */
    <div className="corner-ticks relative isolate m-2 h-[calc(100%-1rem)] overflow-hidden border border-[var(--color-line)]">
      <div
        ref={hostRef}
        className="absolute inset-0"
        onPointerMove={(e) =>
          setCursor(controllerRef.current?.screenToMap(e.clientX, e.clientY))
        }
      />

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Panel padded>
            <div className="label">{bakeLabel ?? 'Preparing map'}</div>
          </Panel>
        </div>
      )}

      {status === 'degraded' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2">
          <Panel padded className="flex items-center gap-3 py-2">
            <Pill tone="warn">no game art</Pill>
            <span className="text-sm text-[var(--color-muted)]">
              Showing a coordinate grid and raw ids. Positions are exact.
            </span>
            <Button size="sm" onClick={() => void ensure(true)}>
              Retry
            </Button>
          </Panel>
        </div>
      )}

      {/* Search */}
      <div className="absolute top-3 left-3 w-64">
        <Panel className="overflow-hidden">
          <input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            aria-label="Find a pal, base or chest on the map"
            placeholder="Find a pal, base, chest…"
            className="w-full bg-[rgb(3_9_13/0.55)] px-3 py-2 text-sm shadow-[var(--edge-sunken)] outline-none placeholder:text-[var(--color-faint)]"
          />
          {results.length > 0 && (
            <ul className="max-h-64 overflow-y-auto border-t border-[var(--color-line)]">
              {results.map((r) => (
                <li key={r.kind + r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      controllerRef.current?.focus(r)
                      setSelected(r)
                      runSearch('')
                    }}
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--color-signal)]/[0.08]"
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

      {/* The game's Filter panel: this *is* the layer list, so it gets the
          game's name for it and the F key that opens it. */}
      {filterOpen && (
        <div className="absolute top-3 right-3 w-[248px]">
          <Panel title="Filter" padded>
            <ul className="space-y-0.5">
              {LEGEND_ORDER.map((id) => {
                const style = LAYER_STYLES[id]
                return (
                  <li key={id}>
                    <Checkbox
                      checked={visible[id]}
                      onChange={(on) => setVisible((v) => ({ ...v, [id]: on }))}
                      className={cn('w-full', !visible[id] && 'opacity-60')}
                      label={
                        <span
                          title={`${style.label} — ${style.hint}`}
                          className="flex flex-1 items-center gap-2 text-xs"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: style.css }}
                          />
                          <span className="flex-1">{style.label}</span>
                          <span className="num text-[var(--color-muted)]">
                            {counts ? count(counts[id] ?? 0) : '—'}
                          </span>
                        </span>
                      }
                    />
                  </li>
                )
              })}
            </ul>

            {/* Fog of war. Not in the list above: it is a raster covering the
                whole map, not a countable set of markers. */}
            <div className="mt-2 border-t border-[var(--color-line-faint)] pt-2">
              {hasFog ? (
                <>
                  <Checkbox
                    checked={fogOn}
                    onChange={setFogOn}
                    className={cn('w-full', !fogOn && 'opacity-60')}
                    label={
                      <span
                        title="Dim the ground this client has never explored, using the mask from LocalData.sav"
                        className="flex flex-1 items-center gap-2 text-xs"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full border border-[var(--color-muted)]" />
                        <span className="flex-1">Fog of war</span>
                        <span className="num text-[var(--color-muted)]">
                          {explored === undefined ? '—' : `${explored}%`}
                        </span>
                      </span>
                    }
                  />
                  <RangeControl
                    label="opacity"
                    value={Math.round(fogOpacity * 100)}
                    onChange={(v) => setFogOpacity(v / 100)}
                    className={cn('mt-1.5', !fogOn && 'opacity-40')}
                  />
                </>
              ) : (
                <LocalDataPrompt />
              )}
            </div>

            <Button
              size="sm"
              onClick={() => controllerRef.current?.fit()}
              title="Zoom out until the whole island is in view"
              className="mt-3 w-full"
            >
              Fit
            </Button>

            {/* Two scopes, one row, so nothing here widens the panel. */}
            <div className="mt-2 flex items-center gap-1">
              <span className="label flex-1">png</span>
              {(['viewport', 'island'] as const).map((scope) => (
                <Button
                  key={scope}
                  size="sm"
                  disabled={saving !== undefined}
                  onClick={() => void savePng(scope)}
                  title={
                    scope === 'viewport'
                      ? 'Save exactly what is on screen now, at this zoom'
                      : 'Save the whole island at 4096px, whatever the current zoom'
                  }
                >
                  {saving === scope
                    ? '…'
                    : scope === 'viewport'
                      ? 'view'
                      : 'all'}
                </Button>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* The coordinate readout and this screen's own key prompts, on the
          frame's bottom edge. The global row (⌘K, 1–6, ?) is in the shell's
          footer directly below; these are the two keys only the map has. */}
      {/* One dark bar rather than bare text: this sits directly on map art,
          which is warm, bright and completely unpredictable. */}
      <div className="absolute bottom-2 left-3 flex items-center gap-4 rounded-control border border-[var(--color-line)] bg-[rgb(4_10_15/0.85)] px-2 py-1">
        <span className="num text-[11px] text-[var(--color-muted)]">
          {cursor
            ? `${Math.round(cursor.mx)}, ${Math.round(cursor.my)}`
            : '—, —'}
        </span>
        <PromptBar className="gap-x-4 p-0 text-[11px] text-[var(--color-muted)]">
          <span className="flex items-center gap-1.5">
            <KeyHint>F</KeyHint>Filter
          </span>
          {selected && (
            <span className="flex items-center gap-1.5">
              <KeyHint>R</KeyHint>Snap to selection
            </span>
          )}
        </PromptBar>
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
        <div className="absolute right-3 bottom-9 w-72">
          <Panel padded>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-lg leading-tight">
                  {selected.label}
                </div>
                <div className="label mt-1.5">
                  {LAYER_STYLES[selected.kind].label}
                </div>
              </div>
              <IconButton
                label="Close"
                tone="ghost"
                size={24}
                onClick={() => setSelected(undefined)}
              >
                ×
              </IconButton>
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
        className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-xs opacity-35 transition-colors transition-opacity hover:bg-[var(--color-signal)]/[0.08] hover:opacity-100"
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
