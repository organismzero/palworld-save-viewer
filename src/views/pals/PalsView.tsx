import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { ivTotal } from '../../domain/index.ts'
import type { Pal, SaveIndex } from '../../domain/types.ts'
import { ELEMENTS, element } from '../../lib/color.ts'
import { count, relativeTime, ticksToDate } from '../../lib/format.ts'
import { formatMapPos, posToMap } from '../../domain/coords.ts'
import {
  CONDENSER_RANK_HELP,
  palName,
  palTooltip,
} from '../../domain/palText.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { ExportMenu } from '../../components/ExportMenu.tsx'
import { useViewParams } from '../../app/viewParams.ts'
import {
  PALS_DEFAULTS,
  palsCodec,
  type PalsParams,
  type SortKey,
} from './params.ts'
import { palColumns } from '../../domain/exportRows.ts'
import {
  ElementBadge,
  Field,
  IVBar,
  Panel,
  PassiveChip,
  Pill,
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
  const { data, ensure } = useRefdataStore()
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
      : undefined,
  )

  const { query, elements, minLevel, minIv, owner, flags, sort } = params
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

  const named = (p: Pal) =>
    data?.species[p.characterId.toLowerCase()]?.name ?? p.characterId

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = index.pals.filter((p) => {
      if (p.level < minLevel) return false
      if (ivTotal(p) < minIv) return false
      if (flags.boss && !p.isBoss) return false
      if (flags.rare && !p.isRare) return false
      if (flags.named && !p.nickname) return false
      if (owner && p.ownerPlayerUid !== owner) return false
      if (elements.size) {
        const info = data?.species[p.characterId.toLowerCase()]
        const own = [info?.element1, info?.element2].filter(Boolean) as string[]
        if (!own.some((e) => elements.has(e))) return false
      }
      if (q) {
        const hay = `${p.characterId} ${p.nickname ?? ''} ${named(p)} ${p.passives.join(' ')}`
        if (!hay.toLowerCase().includes(q)) return false
      }
      return true
    })

    const cmp: Record<SortKey, (a: Pal, b: Pal) => number> = {
      iv: (a, b) => ivTotal(b) - ivTotal(a),
      level: (a, b) => b.level - a.level,
      name: (a, b) => named(a).localeCompare(named(b)),
      caught: (a, b) => (b.ownedTime ?? 0) - (a.ownedTime ?? 0),
      rarity: (a, b) =>
        (data?.species[b.characterId.toLowerCase()]?.rarity ?? 0) -
        (data?.species[a.characterId.toLowerCase()]?.rarity ?? 0),
    }
    return out.sort(cmp[sort])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index.pals, query, elements, minLevel, minIv, owner, flags, sort, data])

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
      selectedId: prev.selectedId,
    }))
  const dirty =
    query ||
    elements.size ||
    minLevel > 1 ||
    minIv > 0 ||
    owner ||
    flags.boss ||
    flags.rare ||
    flags.named

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
            {ELEMENTS.map((el) => {
              const on = elements.has(el.name)
              return (
                <button
                  key={el.name}
                  type="button"
                  title={el.display}
                  // These are colour-only toggles: `title` is the last resort
                  // in the accessible-name algorithm and some assistive tech
                  // ignores it outright, so the name is explicit — and
                  // `aria-pressed` is the only thing carrying on/off, since
                  // visually that is a scale and an opacity change.
                  aria-label={el.display}
                  aria-pressed={on}
                  onClick={() =>
                    setElements((s) => {
                      const next = new Set(s)
                      if (on) next.delete(el.name)
                      else next.add(el.name)
                      return next
                    })
                  }
                  className={cn(
                    'h-[22px] w-[22px] rounded-full border transition-all',
                    on
                      ? 'border-[var(--color-signal)] shadow-[var(--glow-signal)]'
                      : 'border-[var(--color-line)] opacity-40',
                  )}
                  style={{ background: el.oklch }}
                />
              )
            })}
          </div>
        </div>

        <RangeControl
          label="minimum level"
          value={minLevel}
          min={1}
          max={60}
          onChange={setMinLevel}
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
          ]}
        />

        <div className="space-y-1.5">
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
                { value: 'rarity', label: 'Rarity' },
                { value: 'caught', label: 'Recently caught' },
                { value: 'name', label: 'Name' },
              ]}
            />
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-[var(--color-muted)]">
                No pals match these filters.
              </p>
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

  const name = palName(pal, info)
  const species = info?.name ?? pal.characterId

  return (
    <button
      type="button"
      onClick={() => onSelect(pal)}
      title={palTooltip(pal, info, (a) => data?.passives[a.toLowerCase()])}
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
            <ElementBadge name={info?.element1} size={10} />
            <ElementBadge name={info?.element2} size={10} />
          </span>
        </div>

        <div className="flex flex-wrap gap-1 overflow-hidden">
          {pal.passives.slice(0, 2).map((asset) => (
            <PassiveChip
              key={asset}
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
  const info = pal ? data?.species[pal.characterId.toLowerCase()] : undefined
  const owner = pal?.ownerPlayerUid
    ? index.playerByUid.get(pal.ownerPlayerUid)
    : undefined

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
    <aside className="w-[var(--detail-width)] shrink-0 overflow-y-auto border-l border-[var(--color-line)] p-4">
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
        {pal.sickness && <Pill tone="danger">{pal.sickness}</Pill>}
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
        <Field label="level" value={String(pal.level)} />
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
        <Field label="owner" value={owner?.name ?? 'unowned'} />
        <Field
          label="caught"
          value={relativeTime(ticksToDate(pal.ownedTime))}
        />
        <Field
          label="position"
          value={pal.pos ? formatMapPos(posToMap(pal.pos)) : '—'}
        />
      </div>

      {pal.passives.length > 0 && (
        <>
          <div className="label mt-5 mb-2">passives</div>
          <ul className="space-y-2">
            {pal.passives.map((asset) => {
              const p = data?.passives[asset.toLowerCase()]
              return (
                <li key={asset}>
                  <PassiveChip name={p?.name ?? asset} rank={p?.rank} />
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

      {info?.work && Object.keys(info.work).length > 0 && (
        <>
          <div className="label mt-5 mb-2">work suitability</div>
          <Panel className="divide-y divide-[var(--color-line-faint)]">
            {Object.entries(info.work).map(([id, level]) => (
              <div
                key={id}
                className="flex items-center justify-between px-3 py-1.5 text-xs"
              >
                <span>
                  {data?.work.find((w) => w.id === id)?.display ?? id}
                </span>
                <span className="num">{level}</span>
              </div>
            ))}
          </Panel>
        </>
      )}

      {pal.equipWaza.length > 0 && (
        <>
          <div className="label mt-5 mb-2">equipped moves</div>
          <ul className="num space-y-1 text-xs text-[var(--color-muted)]">
            {pal.equipWaza.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
