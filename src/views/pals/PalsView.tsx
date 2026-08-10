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
  IVBar,
  Panel,
  PassiveChip,
  Pill,
} from '../../components/primitives.tsx'
import { cn } from '../../lib/utils.ts'

const CARD_HEIGHT = 168
const CARD_MIN_WIDTH = 210

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
    <div className="flex h-[calc(100dvh-3.25rem)]">
      {/* Filter rail */}
      <aside className="w-64 shrink-0 space-y-5 overflow-y-auto border-r border-[var(--color-line)]/60 p-4">
        <div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter pals by name, species or passive"
            placeholder="Name, species, passive…"
            className="w-full rounded-[6px] border border-[var(--color-line)] bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-signal)]"
          />
        </div>

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
                    'h-6 w-6 rounded-full border-2 transition-all',
                    on ? 'scale-110' : 'border-transparent opacity-45',
                  )}
                  style={{
                    background: el.oklch,
                    borderColor: on ? 'var(--color-text)' : 'transparent',
                  }}
                />
              )
            })}
          </div>
        </div>

        <Range
          label="minimum level"
          value={minLevel}
          min={1}
          max={60}
          onChange={setMinLevel}
        />
        <Range
          label="minimum IV total"
          value={minIv}
          min={0}
          max={300}
          step={10}
          onChange={setMinIv}
        />

        <div>
          <div className="label mb-2">owner</div>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="w-full rounded-[6px] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-signal)]"
          >
            <option value="">Anyone</option>
            {index.players.map((p) => (
              <option key={p.playerUid} value={p.playerUid}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          {(
            [
              ['boss', 'Alphas only'],
              ['rare', 'Rare only'],
              ['named', 'Nicknamed only'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={(e) =>
                  setFlags((f) => ({ ...f, [key]: e.target.checked }))
                }
                className="accent-[var(--color-signal)]"
              />
              {label}
            </label>
          ))}
        </div>

        {dirty && (
          <button
            type="button"
            onClick={clearAll}
            className="w-full rounded-[6px] border border-[var(--color-line)] px-2 py-1.5 text-xs hover:border-[var(--color-signal)]"
          >
            Clear all filters
          </button>
        )}

        {/*
          Exports `filtered`, not `index.pals`. Sitting at the foot of the
          filter rail is the argument: whatever the rail is showing is what
          comes out. An export that ignored the filters would make the rail
          pointless for the one job people want a spreadsheet for.
        */}
        <div className="mt-auto border-t border-[var(--color-line)]/60 pt-3">
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
        <div className="flex items-center gap-3 border-b border-[var(--color-line)]/60 px-4 py-2.5">
          <span className="label">
            {count(filtered.length)} of {count(index.pals.length)} pals
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="label">sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-[6px] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-xs outline-none"
            >
              <option value="iv">IV total</option>
              <option value="level">Level</option>
              <option value="rarity">Rarity</option>
              <option value="caught">Recently caught</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4"
          onScroll={() => {
            const w = scrollRef.current?.clientWidth ?? 0
            const next = Math.max(1, Math.floor((w - 32) / CARD_MIN_WIDTH))
            if (next !== columns) setColumns(next)
          }}
        >
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-[var(--color-muted)]">
                No pals match these filters.
              </p>
              {dirty && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded-[6px] border border-[var(--color-line)] px-3 py-1.5 text-sm hover:border-[var(--color-signal)]"
                >
                  Clear filters
                </button>
              )}
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
                        onSelect={setSelected}
                      />
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <PalDetail
          pal={selected}
          index={index}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  )
}

function PalCard({
  pal,
  index,
  onSelect,
}: {
  pal: Pal
  index: SaveIndex
  onSelect: (p: Pal) => void
}) {
  const { data } = useRefdataStore()
  const info = data?.species[pal.characterId.toLowerCase()]
  const el = element(info?.element1)
  const owner = pal.ownerPlayerUid
    ? index.playerByUid.get(pal.ownerPlayerUid)?.name
    : undefined

  return (
    <button
      type="button"
      onClick={() => onSelect(pal)}
      title={palTooltip(pal, info, (a) => data?.passives[a.toLowerCase()])}
      style={{
        height: CARD_HEIGHT - 12,
        // A faint element wash from the corner is what makes a wall of a
        // thousand cards read as a collection rather than a table.
        backgroundImage: el
          ? `radial-gradient(120% 100% at 0% 100%, color-mix(in oklch, ${el.oklch} 16%, transparent), transparent 70%)`
          : undefined,
      }}
      className="raised-edge group relative flex flex-col gap-2 overflow-hidden rounded-[10px] border border-[var(--color-line)]/60 bg-[var(--color-surface)] p-3 text-left transition-colors hover:border-[var(--color-signal)]/60"
    >
      <div className="flex items-start gap-2.5">
        <GameIcon
          path={info?.icon}
          name={pal.characterId}
          elementName={info?.element1}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-tight">
            {palName(pal, info)}
          </div>
          <div className="num truncate text-[10px] text-[var(--color-muted)]">
            {info?.name ?? pal.characterId}
          </div>
        </div>
        <div className="num shrink-0 text-xs">{pal.level}</div>
      </div>

      <div className="flex items-center gap-2">
        <IVBar
          hp={pal.ivHp}
          attack={pal.ivAttack}
          defense={pal.ivDefense}
          width={72}
        />
        <span className="num text-[10px] text-[var(--color-muted)]">
          {ivTotal(pal)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ElementBadge name={info?.element1} size={10} />
          <ElementBadge name={info?.element2} size={10} />
        </div>
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
          <span className="num text-[10px] text-[var(--color-muted)]">
            +{pal.passives.length - 2}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5">
        {pal.isBoss && <Pill tone="warn">alpha</Pill>}
        {pal.isRare && <Pill tone="signal">rare</Pill>}
        {pal.rank > 0 && (
          <Pill tone="warn" title={CONDENSER_RANK_HELP}>
            ★{pal.rank}
          </Pill>
        )}
        {owner && (
          <span className="truncate text-[10px] text-[var(--color-muted)]">
            {owner}
          </span>
        )}
      </div>
    </button>
  )
}

function PalDetail({
  pal,
  index,
  onClose,
}: {
  pal: Pal
  index: SaveIndex
  onClose: () => void
}) {
  const { data } = useRefdataStore()
  const info = data?.species[pal.characterId.toLowerCase()]
  const owner = pal.ownerPlayerUid
    ? index.playerByUid.get(pal.ownerPlayerUid)
    : undefined

  // "Top 3% of your Kitsunebi" is far more useful than a bare number.
  const cohort = index.palsByCharacterId.get(pal.characterId) ?? []
  const better = cohort.filter((p) => ivTotal(p) > ivTotal(pal)).length
  const percentile = cohort.length > 1 ? better / cohort.length : 0

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-[var(--color-line)]/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <GameIcon
            path={info?.icon}
            name={pal.characterId}
            elementName={info?.element1}
            size={56}
          />
          <div>
            <div className="font-display text-xl leading-tight">
              {palName(pal, info)}
            </div>
            <div className="label mt-1">{info?.name ?? pal.characterId}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {pal.isBoss && <Pill tone="warn">alpha</Pill>}
        {pal.isRare && <Pill tone="signal">rare</Pill>}
        {pal.gender && <Pill>{pal.gender}</Pill>}
        {pal.sickness && <Pill tone="warn">{pal.sickness}</Pill>}
      </div>

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
      <Field label="caught" value={relativeTime(ticksToDate(pal.ownedTime))} />
      <Field
        label="position"
        value={pal.pos ? formatMapPos(posToMap(pal.pos)) : '—'}
      />

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
          <Panel className="divide-y divide-[var(--color-line)]/40">
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

function Field({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div
      title={title}
      className="mt-3 flex items-baseline justify-between gap-3 border-b border-[var(--color-line)]/30 pb-1.5"
    >
      <span className="label">{label}</span>
      <span className="num text-sm">{value}</span>
    </div>
  )
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="num text-xs">{value}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-signal)]"
      />
    </div>
  )
}
