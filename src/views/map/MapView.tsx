import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

import type { SaveIndex } from '../../domain/types.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useSaveStore } from '../../store/saveStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import {
  LAYER_STYLES,
  MapController,
  PAN_STEP,
  ZOOM_STEP,
  type LayerId,
  type MapEntity,
} from './MapController.ts'
import {
  LAYER_IDS,
  MAP_DEFAULTS,
  mapCodec,
  roundViewport,
  sameViewport,
  type MapViewport,
} from './params.ts'
import { useViewParams } from '../../app/viewParams.ts'
import { KeyHint, Panel, PromptBar } from '../../components/primitives.tsx'
import {
  Button,
  Checkbox,
  IconButton,
  RangeControl,
} from '../../components/controls.tsx'
import { cn } from '../../lib/utils.ts'
import { useEscape } from '../../components/drawer.ts'
import { Jump } from '../../components/Jump.tsx'
import { count } from '../../lib/format.ts'
import { downloadBlob, exportName } from '../../lib/export.ts'
import { useFilePicker } from '../../app/filePicker.tsx'
import {
  hideCardAt,
  showCardAt,
  type CardDescriptor,
} from '../../components/cards/hoverCard.ts'

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

export function MapView({ index }: { index: SaveIndex }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<MapController>(null)
  const { data, tiles, status, bakeLabel, ensure } = useRefdataStore()

  const [params, setParams] = useViewParams('map', MAP_DEFAULTS, mapCodec)
  const { layers, fog: fogOn, fogOpacity, viewport, selected: wanted } = params

  /**
   * The marker the link's selection resolves to on the current controller.
   *
   * Derived from `params.selected` by the effect below rather than set directly:
   * a rebuild makes new entity objects, and the one held from before would name
   * a marker the new controller has never heard of.
   */
  const [resolved, setSelected] = useState<MapEntity | undefined>()
  // Nothing wanted is nothing selected, whatever was resolved last.
  const selected = wanted ? resolved : undefined
  const [cursor, setCursor] = useState<{ mx: number; my: number }>()
  const [filterOpen, setFilterOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState<Record<LayerId, number>>()
  const localData = useSaveStore((s) => s.localData)

  const setLayers = (next: (prev: Set<LayerId>) => Iterable<LayerId>) =>
    setParams((p) => ({ ...p, layers: new Set(next(p.layers)) }))
  const pick = (e: MapEntity | undefined) =>
    setParams((p) => ({
      ...p,
      selected: e ? { layer: e.kind, id: e.id } : undefined,
    }))
  // The controller is built in an effect that must not re-run when these
  // change, so it reaches them through refs kept current below.
  const pickRef = useRef(pick)
  const viewportRef = useRef(viewport)
  useEffect(() => {
    pickRef.current = pick
    viewportRef.current = viewport
  })
  /** What the controller is looking at, and which controller that was. */
  const shown = useRef<MapViewport | undefined>(undefined)
  const shownOn = useRef(0)
  const viewTimer = useRef<number | undefined>(undefined)
  /** Whether a link's selection has been centred on once already. */
  const restored = useRef(false)

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

  /**
   * A jump from another view: "show me this on the map".
   *
   * Held in a ref, not applied at once, because there is nothing to apply it to
   * until a controller has mounted and plotted its entities. Cleared from the
   * store straight away all the same, on the rule every view follows — a focus
   * that lingered would re-apply on each return to the tab.
   */
  const focus = useUiStore((s) => s.focus)
  const clearFocus = useUiStore((s) => s.clearFocus)
  const notify = useUiStore((s) => s.notify)
  const pending = useRef(focus?.kind === 'map' ? focus.id : undefined)
  useEffect(clearFocus, [clearFocus])

  useEffect(() => {
    const controller = controllerRef.current
    const id = pending.current
    if (!controller?.ready || !id) return
    pending.current = undefined
    const entity = controller.find(id)
    if (!entity) {
      // No position in the save, or one in the World Tree's own space, which
      // this map does not draw.
      notify('That has no position on this map.', { tone: 'warn' })
      return
    }
    // Its layer may be one that is off by default — most pals are.
    setParams((p) => ({
      ...p,
      layers: new Set([...p.layers, entity.kind]),
      selected: { layer: entity.kind, id: entity.id },
    }))
    controller.focus(entity)
  }, [mounted, notify, setParams])

  // Rebuild when the art arrives, so a cold start shows the procedural map
  // first and upgrades in place rather than blocking on the network.
  useEffect(() => {
    const host = hostRef.current
    if (!host || status === 'loading') return

    const controller = new MapController({
      index,
      refdata: data,
      tiles,
      // Straight to the hover-card layer, not through React state: this fires
      // on every pointermove over the canvas.
      onHover: (e, at) => {
        if (e) showCardAt(at.x, at.y, cardFor(e, index), `${e.kind}:${e.id}`)
        else hideCardAt()
      },
      onSelect: (e) => pickRef.current(e),
      onView: (v) => {
        // Held back, not published per frame: a drag fires this on every
        // pointermove, and each publish is a render of the whole view.
        const next = roundViewport(v)
        shown.current = next
        window.clearTimeout(viewTimer.current)
        viewTimer.current = window.setTimeout(() => {
          setParams((p) =>
            sameViewport(p.viewport, next) ? p : { ...p, viewport: next },
          )
        }, 250)
      },
    })
    controllerRef.current = controller
    void controller.mount(host).then(() => {
      // A controller torn down while it was still mounting has nothing plotted,
      // and announcing it would send every effect below to ask it questions.
      if (controllerRef.current !== controller || !controller.ready) return
      setCounts(controller.counts)
      setMounted((n) => n + 1)
    })

    return () => {
      window.clearTimeout(viewTimer.current)
      controller.destroy()
      controllerRef.current = null
    }
  }, [index, data, tiles, status, setParams])

  /**
   * Put the map where the link says it was.
   *
   * A fresh controller starts fitted to the window, and one is built whenever
   * the art, the reference data or a player save arrives — so without this the
   * map would jump back out to the whole island each time. `shown` is what the
   * controller is looking at as far as this component knows, which is what
   * tells a viewport the user just dragged to (already there) from one a Back
   * button brought in (not yet).
   */
  useEffect(() => {
    const controller = controllerRef.current
    if (!controller?.ready) return
    if (shownOn.current !== mounted) {
      shownOn.current = mounted
      shown.current = undefined
    }
    if (sameViewport(viewport, shown.current)) return
    shown.current = viewport
    if (viewport) controller.setView(viewport)
    else controller.fit()
  }, [viewport, mounted])

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
    for (const id of LAYER_IDS) controller.setLayerVisible(id, layers.has(id))
  }, [layers, mounted])

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
   * Resolve the link's selection against whatever is plotted now.
   *
   * After the client-data effect above, so a pin named in a link is on the map
   * by the time it is looked for.
   */
  const wantedLayer = wanted?.layer
  const wantedId = wanted?.id
  useEffect(() => {
    const controller = controllerRef.current
    if (!controller?.ready) return
    if (!wantedLayer || !wantedId) {
      controller.setSelection(undefined)
      return
    }
    const entity = controller.resolve(wantedLayer, wantedId)
    if (!entity) {
      notify('This link names a marker that is not on this map.', {
        tone: 'warn',
      })
      setParams((p) => ({ ...p, selected: undefined }))
      return
    }
    setSelected(entity)
    controller.setSelection(entity)
    // A link with a selection and no position means "show me this".
    if (!restored.current && !viewportRef.current) controller.focus(entity)
    restored.current = true
  }, [wantedLayer, wantedId, mounted, notify, setParams])

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

  // Escape only, not focus: a selection is as often made from the search box
  // as from the map, and pulling focus out of the box after each pick would
  // end the search the user was in the middle of.
  useEscape(selected !== undefined, () => pick(undefined))

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

  const onMapKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const controller = controllerRef.current
    if (!controller || e.metaKey || e.ctrlKey || e.altKey) return
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [-PAN_STEP, 0],
      ArrowRight: [PAN_STEP, 0],
      ArrowUp: [0, -PAN_STEP],
      ArrowDown: [0, PAN_STEP],
    }
    const by = pan[e.key]
    if (by) controller.panBy(...by)
    else if (e.key === '+' || e.key === '=') controller.zoomBy(ZOOM_STEP)
    else if (e.key === '-' || e.key === '_') controller.zoomBy(1 / ZOOM_STEP)
    else return
    e.preventDefault()
    hideCardAt()
  }

  /** Back out to the whole island, which is also what a bare link shows. */
  const fit = () => {
    window.clearTimeout(viewTimer.current)
    shown.current = undefined
    setParams((p) => (p.viewport ? { ...p, viewport: undefined } : p))
    controllerRef.current?.fit()
  }

  // The save records dungeons but not where they are, so that layer is empty by
  // design. A row that can never count above zero is left out rather than
  // shown permanently switched to nothing.
  const legend = LEGEND_ORDER.filter(
    (id) => id !== 'dungeons' || (counts?.dungeons ?? 0) > 0,
  )

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
        // A tab stop, so the map can be moved without a pointer. The arrow and
        // zoom keys are bound here rather than on the window: they mean
        // something else everywhere else on the page.
        tabIndex={0}
        role="application"
        aria-label="World map. Arrow keys pan, plus and minus zoom."
        onKeyDown={onMapKey}
        className="absolute inset-0 outline-none after:pointer-events-none after:absolute after:inset-0 focus-visible:after:border-2 focus-visible:after:border-[var(--color-signal)]"
        onPointerMove={(e) =>
          setCursor(controllerRef.current?.screenToMap(e.clientX, e.clientY))
        }
        // The map moves under a still pointer on zoom, and a card left behind
        // would be describing whatever used to be there.
        onWheel={hideCardAt}
        onPointerLeave={hideCardAt}
      />

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Panel padded>
            <div className="label">{bakeLabel ?? 'Preparing map'}</div>
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
                      pick(r)
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
            <div className="mb-1.5 flex items-center gap-1">
              <span className="label flex-1">layers</span>
              <Button size="sm" onClick={() => setLayers(() => legend)}>
                all
              </Button>
              <Button size="sm" onClick={() => setLayers(() => [])}>
                none
              </Button>
              <Button
                size="sm"
                title="Show what is hidden and hide what is shown"
                onClick={() =>
                  setLayers((v) => legend.filter((id) => !v.has(id)))
                }
              >
                invert
              </Button>
            </div>
            <ul className="space-y-0.5">
              {legend.map((id) => {
                const style = LAYER_STYLES[id]
                return (
                  <li key={id}>
                    <Checkbox
                      checked={layers.has(id)}
                      onChange={(on) =>
                        setLayers((v) =>
                          on ? [...v, id] : [...v].filter((l) => l !== id),
                        )
                      }
                      className={cn('w-full', !layers.has(id) && 'opacity-60')}
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
                    onChange={(fog) => setParams((p) => ({ ...p, fog }))}
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
                    onChange={(v) =>
                      setParams((p) => ({ ...p, fogOpacity: v / 100 }))
                    }
                    className={cn('mt-1.5', !fogOn && 'opacity-40')}
                  />
                </>
              ) : (
                <LocalDataPrompt />
              )}
            </div>

            <div className="mt-3 flex items-center gap-1">
              <IconButton
                label="Zoom out"
                onClick={() => controllerRef.current?.zoomBy(1 / ZOOM_STEP)}
              >
                −
              </IconButton>
              <Button
                size="sm"
                onClick={fit}
                title="Zoom out until the whole island is in view"
                className="flex-1"
              >
                Fit
              </Button>
              <IconButton
                label="Zoom in"
                onClick={() => controllerRef.current?.zoomBy(ZOOM_STEP)}
              >
                +
              </IconButton>
            </div>

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
          frame's bottom edge. The global row (⌘K, 1–7, ?) is in the shell's
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

      {/* Selection detail */}
      {selected && (
        <div
          role="region"
          aria-label="Map selection"
          className="absolute right-3 bottom-9 w-72"
        >
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
                onClick={() => pick(undefined)}
              >
                ×
              </IconButton>
            </div>
            {selected.sub && <p className="mt-2 text-sm">{selected.sub}</p>}
            <SelectionLink entity={selected} />
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
  const picker = useFilePicker({ multiple: false })

  return (
    <>
      <button
        type="button"
        onClick={picker.open}
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
      {picker.input}
    </>
  )
}

/**
 * The hover card for a map marker.
 *
 * Pals, players, bases and structures resolve to their own cards through the
 * index; pins, landmarks and dungeons have no index entry and keep the label
 * the marker already carries.
 */
function cardFor(e: MapEntity, index: SaveIndex): CardDescriptor {
  switch (e.kind) {
    case 'pals': {
      const pal = index.palById.get(e.id)
      if (pal) return { kind: 'pal', pal }
      break
    }
    case 'players':
      return { kind: 'player', uid: e.id }
    case 'bases':
      return { kind: 'base', id: e.id }
    case 'structuresBuilt':
    case 'structuresWorld':
    case 'chests':
      return { kind: 'structure', id: e.id }
  }
  return { kind: 'text', title: e.label, sub: e.sub }
}

/**
 * Where a selected marker lives in the rest of the app.
 *
 * Landmarks, dungeons and hand-placed pins get nothing: the map is the only
 * place they exist.
 */
function SelectionLink({ entity }: { entity: MapEntity }) {
  const link = (() => {
    switch (entity.kind) {
      case 'pals':
        return {
          view: 'pals' as const,
          focus: { kind: 'pal' as const, id: entity.id, label: entity.label },
          text: 'Open in Pals',
        }
      case 'players':
        return {
          view: 'guild' as const,
          focus: { kind: 'player' as const, id: entity.id },
          text: 'Open in Guild',
        }
      case 'bases':
        return {
          view: 'bases' as const,
          focus: { kind: 'base' as const, id: entity.id },
          text: 'Open in Bases',
        }
      case 'structuresBuilt':
      case 'structuresWorld':
      case 'chests':
        return {
          view: 'bases' as const,
          focus: { kind: 'structure' as const, id: entity.id },
          text: 'Open in Bases',
        }
      default:
        return undefined
    }
  })()
  if (!link) return null
  return (
    <div className="mt-2 text-sm">
      <Jump view={link.view} focus={link.focus}>
        {link.text}
      </Jump>
    </div>
  )
}
