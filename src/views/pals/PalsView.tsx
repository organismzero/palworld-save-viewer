import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { ivTotal } from '../../domain/index.ts'
import type { Pal, SaveIndex } from '../../domain/types.ts'
import {
  ELEMENTS,
  WORK_TYPES,
  element,
  type ElementDef,
} from '../../lib/color.ts'
import { count, relativeTime, ticksToDate } from '../../lib/format.ts'
import { formatMapPos, posToMap } from '../../domain/coords.ts'
import { CONDENSER_RANK_HELP, palName } from '../../domain/palText.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useSaveStore } from '../../store/saveStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import {
  LOW_SANITY,
  conditions,
  placeText,
  placer,
  spaced,
  workLevel,
} from '../../domain/palState.ts'
import { levelProgress } from '../../domain/guild.ts'
import { baseNames } from '../../domain/names.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
import { Jump } from '../../components/Jump.tsx'
import { breedHref } from '../builds/buildsText.ts'
import { useHoverCard } from '../../components/cards/hoverCard.ts'
import { useDrawerFocus, useEscape } from '../../components/drawer.ts'
import { ExportMenu } from '../../components/ExportMenu.tsx'
import { useViewParams } from '../../app/viewParams.ts'
import {
  OWNER_BASE,
  OWNER_NONE,
  PALS_DEFAULTS,
  palsCodec,
  type GenderFilter,
  type PalsParams,
  type SortKey,
} from './params.ts'
import { filterPals, isFiltered, presetChoices } from './filter.ts'
import { palColumns } from '../../domain/exportRows.ts'
import {
  ElementBadge,
  Field,
  IVBar,
  Meter,
  Panel,
  PassiveChip,
  Pill,
  RawId,
} from '../../components/primitives.tsx'
import {
  Button,
  Checkbox,
  IconButton,
  RangeControl,
  SelectControl,
  TextInput,
} from '../../components/controls.tsx'
import { cn } from '../../lib/utils.ts'

/**
 * Both re-measured against the card the redesign actually renders, rather than
 * carried over: the content needs 96–131px depending on whether a pal has a
 * nickname and how many passives it shows, so a 136px box (the 12px grid gutter
 * comes out of `CARD_HEIGHT`) fits the tallest with a little slack and fits
 * roughly a seventh more cards on a screen than the old 168.
 *
 * The minimum width is set by the one row that cannot compress: 72px of IV bars,
 * the IV total, and up to two element pips.
 */
const CARD_HEIGHT = 148
const CARD_MIN_WIDTH = 230

export function PalsView({ index }: { index: SaveIndex }) {
  const { data, status, ensure } = useRefdataStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Names, icons and passive descriptions all come from reference data, so
  // this view must request it even if the map was never opened.
  useEffect(() => {
    void ensure()
  }, [ensure])

  // A jump from the command palette is read during the first render, so the
  // drawer is open and the grid already narrowed on first paint rather than a
  // frame later, and cleared afterwards. See the note in BasesView.
  const focus = useUiStore((s) => s.focus)
  const clearFocus = useUiStore((s) => s.clearFocus)
  useEffect(clearFocus, [clearFocus])

  /**
   * A ⌘K jump beats whatever the hash says.
   *
   * The hash is history; a jump is an intent expressed now. Once the view has
   * taken it, its resulting state is published back — which is what makes the
   * jump itself a shareable link.
   */
  const codec = useMemo(() => palsCodec(index), [index])
  const [params, setParams] = useViewParams('pals', PALS_DEFAULTS, codec, () =>
    focus?.kind === 'pal'
      ? { query: focus.label, selectedId: focus.id }
      : focus?.kind === 'species'
        ? { query: focus.label, owner: focus.owner ?? '' }
        : undefined,
  )

  const { query, elements, minLevel, minIv, owner, flags, sort } = params
  const { maxLevel, gender, work, workMin, attention, preset, reversed } =
    params
  const patch = (p: Partial<PalsParams>) =>
    setParams((prev) => ({ ...prev, ...p }))

  // Shims so the markup below reads exactly as it did with `useState`,
  // including the updater form the two multi-value toggles rely on.
  const setQuery = (query: string) => patch({ query })
  const setMinLevel = (minLevel: number) => patch({ minLevel })
  const setMinIv = (minIv: number) => patch({ minIv })
  const setOwner = (owner: string) => patch({ owner })
  const setSort = (sort: SortKey) => patch({ sort })
  const setElements = (next: (prev: Set<string>) => Set<string>) =>
    setParams((prev) => ({ ...prev, elements: next(prev.elements) }))
  const setFlags = (next: (prev: PalsParams['flags']) => PalsParams['flags']) =>
    setParams((prev) => ({ ...prev, flags: next(prev.flags) }))

  const selected = params.selectedId
    ? index.palById.get(params.selectedId)
    : undefined
  const setSelected = (pal: Pal | undefined) =>
    patch({ selectedId: pal?.instanceId })

  const [columns, setColumns] = useState(4)

  /**
   * How many cards fit, recomputed with a `ResizeObserver`.
   *
   * This used to be recalculated in the grid's `onScroll`, which meant opening
   * the detail drawer — 340px off this container's width, with no scroll event
   * anywhere — left the grid on its old column count and squeezed every card
   * until you happened to scroll. A window resize had the same problem.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setColumns(
        Math.max(1, Math.floor((el.clientWidth - 32) / CARD_MIN_WIDTH)),
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const place = useMemo(() => placer(index), [index])
  const localData = useSaveStore((s) => s.localData)
  const presets = useMemo(
    () => presetChoices(localData?.presets ?? []),
    [localData],
  )
  const presetIds = useMemo(() => {
    const found = params.preset
      ? presets.find((p) => p.key === params.preset)
      : undefined
    return found ? new Set(found.palIds) : undefined
  }, [presets, params.preset])

  const filtered = useMemo(
    () =>
      filterPals(index.pals, params, {
        index,
        data,
        place,
        preset: presetIds,
      }),
    [index, params, data, place, presetIds],
  )

  // The sliders' top end is whatever this world has reached, so a save from a
  // version with a higher cap is not clipped at the number written here.
  const topLevel = useMemo(
    () => index.pals.reduce((m, p) => Math.max(m, p.level), 60),
    [index],
  )

  const rows = Math.ceil(filtered.length / columns)
  // The React Compiler lint cannot verify TanStack Virtual's returned
  // functions are memo-safe. They are used only inside render for layout, and
  // the library manages its own subscription.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 3,
  })

  const clearAll = () =>
    setParams((prev) => ({
      ...PALS_DEFAULTS,
      // Sort and selection are not filters; "clear all filters" should not
      // silently re-sort the grid or close the detail drawer.
      sort: prev.sort,
      reversed: prev.reversed,
      selectedId: prev.selectedId,
    }))
  const dirty = isFiltered(params)

  return (
    <div className="flex h-full">
      {/* Filter rail */}
      <aside className="w-[var(--rail-width)] shrink-0 space-y-5 overflow-y-auto border-r border-[var(--color-line)] p-4">
        <TextInput
          value={query}
          onChange={setQuery}
          aria-label="Filter pals by name, species or passive"
          placeholder="Name, species, passive…"
        />

        <div>
          <div className="label mb-2">element</div>
          <div className="flex flex-wrap gap-1.5">
            {ELEMENTS.map((el) => (
              <ElementToggle
                key={el.name}
                el={el}
                on={elements.has(el.name)}
                onToggle={() =>
                  setElements((s) => {
                    const next = new Set(s)
                    if (next.has(el.name)) next.delete(el.name)
                    else next.add(el.name)
                    return next
                  })
                }
              />
            ))}
          </div>
        </div>

        <RangeControl
          label="minimum level"
          value={minLevel}
          min={1}
          max={topLevel}
          onChange={setMinLevel}
        />
        {/* Stored as 0 for "no ceiling" and shown at the top of its range, so
            an untouched slider and a cleared one are the same thing. */}
        <RangeControl
          label="maximum level"
          value={maxLevel > 0 ? Math.min(maxLevel, topLevel) : topLevel}
          min={1}
          max={topLevel}
          onChange={(v) => patch({ maxLevel: v >= topLevel ? 0 : v })}
        />
        <RangeControl
          label="minimum IV total"
          value={minIv}
          min={0}
          max={300}
          step={10}
          onChange={setMinIv}
        />

        <SelectControl
          label="owner"
          value={owner}
          onChange={setOwner}
          options={[
            { value: '', label: 'Anyone' },
            ...index.players.map((p) => ({
              value: p.playerUid,
              label: p.name,
            })),
            { value: OWNER_BASE, label: 'Base workers' },
            { value: OWNER_NONE, label: 'No owner' },
          ]}
        />

        <SelectControl
          label="gender"
          value={gender}
          onChange={(v) => patch({ gender: v as GenderFilter })}
          options={[
            { value: '', label: 'Either' },
            { value: 'Female', label: 'Female' },
            { value: 'Male', label: 'Male' },
          ]}
        />

        <div className="space-y-2">
          <SelectControl
            label="can do"
            value={work}
            onChange={(v) => patch({ work: v })}
            options={[
              { value: '', label: 'Any job' },
              ...WORK_TYPES.map((t) => ({
                value: t.id,
                label:
                  data?.work.find((w) => w.id === t.id)?.display ?? t.display,
              })),
            ]}
          />
          {work && (
            <RangeControl
              label="at level"
              value={workMin}
              min={1}
              max={5}
              onChange={(v) => patch({ workMin: v })}
            />
          )}
        </div>

        {/* Only with the client's own save: presets live in LocalData.sav and
            nowhere else. A preset named in a link stays listed without it, so
            the filter that is narrowing the grid can be seen and cleared. */}
        {(presets.length > 0 || preset) && (
          <SelectControl
            label="party preset"
            value={preset}
            onChange={(v) => patch({ preset: v })}
            options={[
              { value: '', label: 'Any' },
              ...presets.map((p) => ({ value: p.key, label: p.label })),
              ...(preset && !presets.some((p) => p.key === preset)
                ? [{ value: preset, label: `${preset} (not loaded)` }]
                : []),
            ]}
          />
        )}

        <div className="space-y-1.5">
          <Checkbox
            checked={attention}
            onChange={(on) => patch({ attention: on })}
            label="Needs attention"
            className="w-full"
          />
          {(
            [
              ['boss', 'Alphas only'],
              ['rare', 'Rare only'],
              ['named', 'Nicknamed only'],
            ] as const
          ).map(([key, label]) => (
            <Checkbox
              key={key}
              checked={flags[key]}
              onChange={(on) => setFlags((f) => ({ ...f, [key]: on }))}
              label={label}
              className="w-full"
            />
          ))}
        </div>

        {dirty && (
          <Button size="sm" onClick={clearAll} className="w-full">
            Clear all filters
          </Button>
        )}

        {/*
          Exports `filtered`, not `index.pals`. Sitting at the foot of the
          filter rail is the argument: whatever the rail is showing is what
          comes out. An export that ignored the filters would make the rail
          pointless for the one job people want a spreadsheet for.
        */}
        <div className="mt-auto border-t border-[var(--color-line)] pt-3">
          <ExportMenu
            rows={filtered}
            columns={palColumns(index, data)}
            kind="pals"
            title={
              dirty
                ? `Export the ${filtered.length} pals matching these filters`
                : 'Export all pals'
            }
          />
        </div>
      </aside>

      {/* Grid */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-2.5">
          <span className="label">
            {count(filtered.length)} of {count(index.pals.length)} pals
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="label" aria-hidden>
              sort
            </span>
            <SelectControl
              aria-label="Sort pals"
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              className="w-44"
              options={[
                { value: 'iv', label: 'IV total' },
                { value: 'level', label: 'Level' },
                { value: 'hp', label: 'HP' },
                { value: 'rarity', label: 'Rarity' },
                { value: 'caught', label: 'Recently caught' },
                { value: 'name', label: 'Name' },
                { value: 'species', label: 'Species' },
                { value: 'owner', label: 'Owner' },
              ]}
            />
            <IconButton
              label={reversed ? 'Sorted in reverse' : 'Reverse the order'}
              size={28}
              aria-pressed={reversed}
              onClick={() => patch({ reversed: !reversed })}
            >
              {reversed ? '↑' : '↓'}
            </IconButton>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-[var(--color-muted)]">
                No pals match these filters.
              </p>
              {elements.size > 0 && status === 'degraded' && (
                <p className="max-w-sm text-center text-xs text-[var(--color-muted)]">
                  Elements come from game data, so the element filter is not
                  being applied.
                </p>
              )}
              {dirty && <Button onClick={clearAll}>Clear filters</Button>}
            </div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((row) => (
                <div
                  key={row.key}
                  className="absolute top-0 left-0 grid w-full gap-3"
                  style={{
                    transform: `translateY(${row.start}px)`,
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  }}
                >
                  {filtered
                    .slice(row.index * columns, row.index * columns + columns)
                    .map((pal) => (
                      <PalCard
                        key={pal.instanceId}
                        pal={pal}
                        index={index}
                        selected={pal.instanceId === params.selectedId}
                        onSelect={setSelected}
                      />
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Always present, even with nothing picked. It used to mount on
          selection, which took 340px off the grid and re-flowed every card at
          the moment of clicking one — so the card you clicked moved. */}
      <PalDetail
        pal={selected}
        index={index}
        onClose={() => setSelected(undefined)}
      />
    </div>
  )
}

function PalCard({
  pal,
  index,
  selected,
  onSelect,
}: {
  pal: Pal
  index: SaveIndex
  selected: boolean
  onSelect: (p: Pal) => void
}) {
  const { data } = useRefdataStore()
  const info = data?.species[pal.characterId.toLowerCase()]
  const el = element(info?.element1)
  const owner = pal.ownerPlayerUid
    ? index.playerByUid.get(pal.ownerPlayerUid)?.name
    : undefined
  const state = conditions(pal)[0]

  const name = palName(pal, info)
  const species = info?.name ?? pal.characterId
  const hover = useHoverCard({ kind: 'pal', pal })

  return (
    <button
      type="button"
      onClick={() => onSelect(pal)}
      {...hover}
      style={{
        height: CARD_HEIGHT - 12,
        // A faint element wash from the corner is what makes a wall of a
        // thousand cards read as a collection rather than a table. Translucent
        // but deliberately not blurred: the design system's own card is a
        // tinted button, and a backdrop-filter per card would cost the
        // virtualised grid a composited layer for every row on screen.
        background: el
          ? `radial-gradient(120% 100% at 0% 100%, color-mix(in oklch, ${el.oklch} 18%, transparent), transparent 70%), rgb(10 24 33 / 0.7)`
          : 'rgb(10 24 33 / 0.7)',
      }}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'raised-edge group relative flex gap-3 overflow-hidden rounded-panel border p-3 text-left transition-colors',
        selected
          ? 'corner-ticks border-[var(--color-signal)] shadow-[var(--glow-signal)] [--tick-color:var(--color-signal)] [--tick-size:12px]'
          : 'border-[var(--color-line)] hover:border-[var(--color-signal)]/60',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-1.5">
          {/* Stamina orange, as the game prints a level. */}
          <span className="num shrink-0 text-[11px] text-[var(--color-stamina)]">
            Lv.{pal.level}
          </span>
          <span className="truncate text-sm">{name}</span>
        </div>
        {/* The species is said once — for a pal with no nickname it *is* the
            name — and the owner shares the line, because a badge row with
            three pills on it has no room left to truncate a name into. */}
        {(species !== name || owner) && (
          <div className="num flex items-baseline gap-2 text-[11px] text-[var(--color-muted)]">
            {species !== name && <span className="truncate">{species}</span>}
            {owner && <span className="ml-auto truncate">{owner}</span>}
          </div>
        )}

        <div className="flex items-center gap-2">
          <IVBar
            hp={pal.ivHp}
            attack={pal.ivAttack}
            defense={pal.ivDefense}
            width={72}
          />
          <span className="num text-[11px] text-[var(--color-muted)]">
            {ivTotal(pal)}
          </span>
          <span className="ml-auto flex items-center gap-1">
            {/* No cards of their own: the pal card they sit on names both. */}
            <ElementBadge name={info?.element1} size={10} card={false} />
            <ElementBadge name={info?.element2} size={10} card={false} />
          </span>
        </div>

        <div className="flex flex-wrap gap-1 overflow-hidden">
          {pal.passives.slice(0, 2).map((asset) => (
            <PassiveChip
              key={asset}
              id={asset}
              name={data?.passives[asset.toLowerCase()]?.name ?? asset}
              rank={data?.passives[asset.toLowerCase()]?.rank}
            />
          ))}
          {pal.passives.length > 2 && (
            <span className="num text-[11px] text-[var(--color-muted)]">
              +{pal.passives.length - 2}
            </span>
          )}
        </div>
      </div>

      {/*
        The right rail is what this pal *is*: its art, and the properties that
        are true of it. The left column is what it has — name, rolls, skills.
        Keeping the two apart is what stops the passive chips and the alpha/rare
        badges reading as one list, which matters more now that gold means "rare"
        as well as "legendary passive".
      */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        {/* Renders as a monogram for the 50 pals with no icon. */}
        <GameIcon
          path={info?.icon}
          name={pal.characterId}
          elementName={info?.element1}
          size={48}
        />
        {/* First, and only the worst: of everything a card can say, "this one
            is dying" is the thing that should not lose a fight for space. */}
        {state && (
          <Pill tone={state.tone} title={state.detail}>
            {state.label}
          </Pill>
        )}
        {pal.isBoss && <Pill tone="danger">alpha</Pill>}
        {pal.isRare && <Pill tone="warn">rare</Pill>}
        {pal.rank > 0 && <Pill title={CONDENSER_RANK_HELP}>★{pal.rank}</Pill>}
      </div>
    </button>
  )
}

/**
 * The detail drawer, which is on screen whether or not a pal is picked.
 *
 * Holding the width open is the point: mounting it on selection took 340px off
 * the grid, re-flowed every card, and moved the card that had just been clicked
 * out from under the cursor.
 */
function PalDetail({
  pal,
  index,
  onClose,
}: {
  pal: Pal | undefined
  index: SaveIndex
  onClose: () => void
}) {
  const { data } = useRefdataStore()
  const ref = useRef<HTMLElement>(null)
  useEscape(pal !== undefined, onClose)
  useDrawerFocus(ref, pal !== undefined)
  const info = pal ? data?.species[pal.characterId.toLowerCase()] : undefined
  const owner = pal?.ownerPlayerUid
    ? index.playerByUid.get(pal.ownerPlayerUid)
    : undefined

  // Species base plus the pal's own bonus, in the game's work order, by the
  // same rule Builds ranks workers with.
  const work =
    pal && data
      ? WORK_TYPES.flatMap((t) => {
          const level = workLevel(data, pal, t.id)
          if (level <= 0) return []
          const ref = data.work.find((w) => w.id === t.id)
          return [
            {
              id: t.id,
              display: ref?.display ?? t.display,
              icon: ref?.icon,
              level,
              bonus: pal.workSuitabilityBonus[t.id] ?? 0,
            },
          ]
        })
      : []

  const place = useMemo(() => placer(index), [index])
  const bases = useMemo(() => baseNames(index, data), [index, data])
  const at = pal ? place(pal) : undefined
  // "Base 3", without the landmark: the row is 300px wide, and the full label
  // is on the link's own card.
  const where = at
    ? placeText(at, (id) => bases.get(id)?.split(' · ')[0])
    : undefined
  const guild = pal?.groupId ? index.guildById.get(pal.groupId) : undefined
  const state = pal ? conditions(pal) : []
  const toNext = pal
    ? levelProgress(
        pal.level,
        pal.exp,
        data?.expTable.map((r) => ({ level: r.level, total: r.palTotal })),
      )
    : undefined
  const souls = pal
    ? (
        [
          ['HP', pal.rankHp],
          ['attack', pal.rankAttack],
          ['defence', pal.rankDefence],
          ['work speed', pal.rankCraftSpeed],
        ] as const
      ).filter(([, n]) => n > 0)
    : []

  // "Top 3% of your Kitsunebi" is far more useful than a bare number.
  const cohort = pal ? (index.palsByCharacterId.get(pal.characterId) ?? []) : []
  const better = pal
    ? cohort.filter((p) => ivTotal(p) > ivTotal(pal)).length
    : 0
  const percentile = cohort.length > 1 ? better / cohort.length : 0

  const elements = [info?.element1, info?.element2].filter(
    (e): e is string => element(e) !== undefined,
  )

  if (!pal) {
    return (
      <aside className="flex w-[var(--detail-width)] shrink-0 items-center justify-center border-l border-[var(--color-line)] p-6">
        <p className="max-w-[220px] text-center text-sm text-[var(--color-muted)]">
          Pick a pal to see its IVs, passives, work suitability and where it is.
        </p>
      </aside>
    )
  }

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label="Pal details"
      className="w-[var(--detail-width)] shrink-0 overflow-y-auto border-l border-[var(--color-line)] p-4 outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <GameIcon
            path={info?.icon}
            name={pal.characterId}
            elementName={info?.element1}
            size={56}
          />
          <div className="min-w-0">
            <div className="truncate text-xl leading-tight">
              {palName(pal, info)}
            </div>
            <div className="label mt-1 truncate">
              {info?.name ?? pal.characterId}
            </div>
            {/* Only with game data: both destinations are worked out from it,
                and would open on an empty pane without. */}
            {info && (
              <div className="mt-1.5 flex gap-3 text-xs">
                <a
                  href={breedHref(
                    index,
                    pal.ownerPlayerUid,
                    pal.characterId.toLowerCase(),
                    [],
                  )}
                  title={`Plan how to breed ${info.name}`}
                  className="hover:underline"
                >
                  breed →
                </a>
                <Jump
                  view="builds"
                  focus={{
                    kind: 'fight',
                    species: pal.characterId.toLowerCase(),
                  }}
                  title={`What beats ${info.name}`}
                >
                  fight
                </Jump>
              </div>
            )}
          </div>
        </div>
        <IconButton label="Close" tone="ghost" size={24} onClick={onClose}>
          ×
        </IconButton>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {pal.isBoss && <Pill tone="danger">alpha</Pill>}
        {pal.isRare && <Pill tone="warn">rare</Pill>}
        {pal.gender && <Pill>{pal.gender}</Pill>}
        {state.map((c) => (
          <Pill key={c.id} tone={c.tone}>
            {c.detail ? `${c.label} · ${c.detail}` : c.label}
          </Pill>
        ))}
      </div>

      <div className="mt-4">
        {elements.length > 0 && (
          <Field
            label={elements.length > 1 ? 'types' : 'type'}
            value={
              <span className="flex items-center justify-end gap-3">
                {elements.map((e) => (
                  <ElementBadge key={e} name={e} size={12} showLabel />
                ))}
              </span>
            }
          />
        )}
        <Field
          label="level"
          value={
            toNext === undefined ? (
              String(pal.level)
            ) : (
              <span className="flex items-center justify-end gap-2">
                {pal.level}
                <Meter
                  value={Math.round(toNext * 100)}
                  tone="xp"
                  height={6}
                  showValue={false}
                  className="w-20"
                />
                <span className="text-[var(--color-muted)]">
                  {Math.round(toNext * 100)}%
                </span>
              </span>
            )
          }
          title={
            toNext === undefined
              ? undefined
              : `${Math.round(toNext * 100)}% of the way to level ${pal.level + 1}`
          }
        />
        <Field label="hp" value={pal.hp ? pal.hp.toFixed(0) : '—'} />
        <Field
          label="IV total"
          value={`${ivTotal(pal)} / 300${
            cohort.length > 1
              ? ` · top ${Math.max(1, Math.round(percentile * 100))}%`
              : ''
          }`}
        />
        <Field
          label="IVs"
          value={`${pal.ivHp ?? '–'} / ${pal.ivAttack ?? '–'} / ${pal.ivDefense ?? '–'}`}
        />
        {pal.rank > 0 && (
          <Field
            label="condensed"
            value={`★${pal.rank}`}
            title={CONDENSER_RANK_HELP}
          />
        )}
        {souls.length > 0 && (
          <Field
            label="souls"
            value={souls.map(([stat, n]) => `${stat} +${n}`).join(' · ')}
            title="Soul enhancements from the Statue of Power, by stat"
          />
        )}
        <Field
          label="owner"
          value={
            owner ? (
              <Jump
                view="guild"
                focus={{ kind: 'player', id: owner.playerUid }}
                card={{ kind: 'player', uid: owner.playerUid }}
                title="Open this player in Guild"
              >
                {owner.name}
              </Jump>
            ) : (
              'unowned'
            )
          }
        />
        <Field
          label="caught"
          value={relativeTime(ticksToDate(pal.ownedTime))}
        />
        <Field
          label="position"
          value={
            pal.pos ? (
              <Jump
                view="map"
                focus={{ kind: 'map', id: pal.instanceId }}
                title="Show on the map"
              >
                {formatMapPos(posToMap(pal.pos))}
              </Jump>
            ) : (
              '—'
            )
          }
        />
        {where && at && (
          <Field
            label="kept in"
            value={
              at.where === 'base' && at.baseId ? (
                <Jump
                  view="bases"
                  focus={{ kind: 'base', id: at.baseId }}
                  card={{ kind: 'base', id: at.baseId }}
                  title="Open this base in Bases"
                >
                  {where}
                </Jump>
              ) : (
                where
              )
            }
          />
        )}
        {guild && <Field label="guild" value={guild.name} />}
      </div>

      <Condition pal={pal} />

      {pal.passives.length > 0 && (
        <>
          <div className="label mt-5 mb-2">passives</div>
          <ul className="space-y-2">
            {pal.passives.map((asset) => {
              const p = data?.passives[asset.toLowerCase()]
              return (
                <li key={asset}>
                  <PassiveChip
                    id={asset}
                    name={p?.name ?? asset}
                    rank={p?.rank}
                    focusable
                  />
                  {p?.description && (
                    <p className="mt-1 text-xs text-[var(--color-muted)]">
                      {p.description}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {work.length > 0 && (
        <>
          <div className="label mt-5 mb-2">work suitability</div>
          <Panel className="divide-y divide-[var(--color-line-faint)]">
            {work.map((w) => (
              <CardTrigger
                key={w.id}
                as="div"
                card={{ kind: 'work', id: w.id }}
                focusable
                className="flex items-center gap-2 px-3 py-1.5 text-xs"
              >
                {w.icon && (
                  <GameIcon path={w.icon} name={w.display} size={18} />
                )}
                <span className="min-w-0 flex-1 truncate">{w.display}</span>
                {/* The pal's own bonus is folded in and marked, so a boosted
                    level is not mistaken for the species'. */}
                <span className="num">
                  {w.level}
                  {w.bonus > 0 && (
                    <span className="text-[var(--color-gold)]">+</span>
                  )}
                </span>
              </CardTrigger>
            ))}
          </Panel>
        </>
      )}

      <MoveList title="equipped moves" ids={pal.equipWaza} />
      {/* Learned but not equipped. Never shown until now, and it is the list
          that says what a pal could be switched to. */}
      <MoveList
        title="also knows"
        ids={pal.masteredWaza.filter((w) => !pal.equipWaza.includes(w))}
      />
    </aside>
  )
}

/**
 * How the pal is doing: what it is working at, how fed, how sane, how attached.
 *
 * Absent altogether when the save records none of it, which is the usual case
 * for a pal in a palbox. Sanity is the only one drawn as a bar, because it is
 * the only one with a scale: the save holds it as a number out of 100 and
 * leaves it out at full. Hunger has no maximum anywhere in the data, and
 * friendship is a running total of points, so both are printed as they are.
 */
function Condition({ pal }: { pal: Pal }) {
  const { data } = useRefdataStore()
  const job = pal.currentWork
    ? (data?.work.find((w) => w.id === pal.currentWork)?.display ??
      WORK_TYPES.find((w) => w.id === pal.currentWork)?.display ??
      spaced(pal.currentWork))
    : undefined

  if (
    !job &&
    !pal.physicalHealth &&
    !pal.sickness &&
    pal.fullStomach === undefined &&
    pal.sanity === undefined &&
    pal.friendship === undefined
  ) {
    return null
  }

  return (
    <>
      <div className="label mt-5 mb-2">condition</div>
      <div>
        {job && <Field label="working at" value={job} />}
        {pal.physicalHealth && (
          <Field label="health" value={spaced(pal.physicalHealth)} />
        )}
        {pal.sickness && (
          <Field label="sickness" value={spaced(pal.sickness)} />
        )}
        {pal.sanity !== undefined && (
          <Field
            label="sanity"
            value={
              <Meter
                value={pal.sanity}
                tone={pal.sanity < LOW_SANITY ? 'danger' : 'stamina'}
                height={14}
                className="w-32"
              />
            }
          />
        )}
        {pal.fullStomach !== undefined && (
          <Field
            label="hunger"
            value={Math.round(pal.fullStomach)}
            title="How full it is. The save records no maximum; it differs by species."
          />
        )}
        {pal.friendship !== undefined && (
          <Field
            label="trust"
            value={count(pal.friendship)}
            title="Friendship points earned with its owner"
          />
        )}
      </div>
    </>
  )
}

/** A pal's moves by name, each opening its skill card. */
function MoveList({ title, ids }: { title: string; ids: string[] }) {
  const { data } = useRefdataStore()
  if (ids.length === 0) return null
  return (
    <>
      <div className="label mt-5 mb-2">{title}</div>
      <ul className="space-y-1 text-xs">
        {ids.map((id) => {
          const skill = data?.skills[id.toLowerCase()]
          return (
            <CardTrigger
              key={id}
              as="li"
              card={{ kind: 'skill', id }}
              focusable
              className="flex items-center gap-2"
            >
              <ElementBadge name={skill?.element} size={10} card={false} />
              <span className="min-w-0 flex-1 truncate">
                {skill?.name ?? <RawId>{id}</RawId>}
              </span>
              {skill && (
                <span className="num text-[var(--color-muted)]">
                  {skill.power}
                </span>
              )}
            </CardTrigger>
          )
        })}
      </ul>
    </>
  )
}

/** One colour-only element filter, whose hover card names the element. */
function ElementToggle({
  el,
  on,
  onToggle,
}: {
  el: ElementDef
  on: boolean
  onToggle: () => void
}) {
  const hover = useHoverCard({ kind: 'element', name: el.name })
  return (
    <button
      type="button"
      {...hover}
      // Colour-only toggles: the card shows the name to the eye, but the
      // accessible name has to be explicit — and `aria-pressed` is the only
      // thing carrying on/off, since visually that is a scale and an opacity
      // change.
      aria-label={el.display}
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        'h-[22px] w-[22px] rounded-full border transition-all',
        on
          ? 'border-[var(--color-signal)] shadow-[var(--glow-signal)]'
          : 'border-[var(--color-line)] opacity-40',
      )}
      style={{ background: el.oklch }}
    />
  )
}
