import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import {
  baseHealth,
  buildersOf,
  byFullness,
  containerLocation,
  filterStructures,
  hpPercent,
  isDamaged,
  itemPlaces,
  searchItems,
  storageTotals,
  wornItems,
  type Builder,
  type ItemHit,
  type WornItem,
} from '../../domain/bases.ts'
import {
  baseNames as namesOfBases,
  itemName,
  structureName,
} from '../../domain/names.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { formatMapPos, posToMap } from '../../domain/coords.ts'
import type {
  Base,
  Container,
  Guid,
  SaveIndex,
  Structure,
} from '../../domain/types.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import {
  useHoverCard,
  type CardDescriptor,
} from '../../components/cards/hoverCard.ts'
import { ExportMenu } from '../../components/ExportMenu.tsx'
import {
  CONTAINER_COLUMNS,
  ITEM_HIT_COLUMNS,
  WORN_COLUMNS,
  containerRows,
  itemHitRows,
  wornRows,
} from '../../domain/exportRows.ts'
import { Field, Meter, Panel, Pill } from '../../components/primitives.tsx'
import {
  Checkbox,
  Button,
  IconButton,
  ListRow,
  MoreResults,
  RangeControl,
  SelectControl,
  TextInput,
} from '../../components/controls.tsx'
import {
  OPTION_ACTIVE,
  useCombobox,
  type Combobox,
} from '../../components/combobox.ts'
import { categoricalCss } from '../../lib/categorical.ts'
import { wearColor } from '../../lib/color.ts'
import { compact, count } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { useViewParams } from '../../app/viewParams.ts'
import {
  BASES_DEFAULTS,
  basesCodec,
  type BasesParams,
  type Source,
  type StructureSort,
} from './params.ts'
import { withItem } from '../map/params.ts'
import { BasePlan } from './BasePlan.tsx'
import { ContainerGrid } from './ContainerGrid.tsx'

/**
 * Base and inventory explorer.
 *
 * Three panes: where storage is (left), what is there (centre), what is in it
 * (right). The left pane's three kinds of source are not a taxonomy invented
 * for the UI — they are exactly the three attribution outcomes the parser can
 * reach. A base and a wild treasure box are both *certain*, because a map
 * object claims the container outright; everything else is a guess, and gets
 * its own section rather than being quietly folded in with the certainties.
 */

const ROW_HEIGHT = 40

/**
 * Which pane a container lives in.
 *
 * Shared by the initial focus and by every later selection, so a container
 * opened from search lands in exactly the same place as one clicked in the
 * list — otherwise the left rail would say "Base 1" while the right pane
 * showed a world chest.
 */
function locate(
  index: SaveIndex,
  containerId: Guid,
): { source: Source; structureId?: Guid } {
  const structureId = index.structureByContainer.get(containerId)
  const structure = structureId
    ? index.structureById.get(structureId)
    : undefined
  if (structure?.baseCampId) {
    return {
      source: { kind: 'base', baseId: structure.baseCampId },
      structureId,
    }
  }
  if (structure) return { source: { kind: 'world' }, structureId }
  return { source: { kind: 'unattributed' }, structureId }
}

export function BasesView({ index }: { index: SaveIndex }) {
  const { data, ensure } = useRefdataStore()

  // Structure names, item names and icons all come from reference data, so
  // this view requests it even if no other view has been opened.
  useEffect(() => {
    void ensure()
  }, [ensure])

  const nameOfStructure = (s: Structure) => structureName(data, s)
  const nameOfItem = (staticId: string) => itemName(data, staticId)

  const bases = index.bases
  const baseNames = useMemo(() => namesOfBases(index, data), [index, data])
  const nameOfBase = (b: Base) => baseNames.get(b.baseId) ?? 'Base'

  /** Structures that hold a container and sit outside any base camp. */
  const worldChests = useMemo(
    () => index.structures.filter((s) => s.containerId && !s.baseCampId),
    [index],
  )

  /** Every container no map object claims — the 351 in the reference save. */
  const orphans = useMemo(
    () => index.containers.filter((c) => c.ownerKind !== 'structure'),
    [index],
  )

  /**
   * A jump from the command palette arrives as a one-shot focus request.
   *
   * It is *read* during the first render, so the right pane paints correct
   * rather than painting the default and then correcting it, and *cleared*
   * afterwards in an effect — clearing during render would be a store write
   * mid-render, which React rejects. Clearing at all is what stops a focus
   * lingering and re-applying every time the view is revisited, overriding
   * whatever has been clicked since.
   */
  const focus = useUiStore((s) => s.focus)
  const clearFocus = useUiStore((s) => s.clearFocus)
  useEffect(clearFocus, [clearFocus])

  const [initial] = useState<{
    source: Source
    container?: Guid
    structureId?: Guid
  }>(() => {
    if (focus?.kind === 'container') {
      return { ...locate(index, focus.id), container: focus.id }
    }
    if (focus?.kind === 'base') {
      return { source: { kind: 'base', baseId: focus.id } }
    }
    if (focus?.kind === 'structure') {
      const structure = index.structureById.get(focus.id)
      if (structure) {
        return {
          source: structure.baseCampId
            ? { kind: 'base', baseId: structure.baseCampId }
            : { kind: 'world' },
          container: structure.containerId,
          structureId: structure.instanceId,
        }
      }
    }
    const first = bases[0]
    return {
      source: first
        ? { kind: 'base', baseId: first.baseId }
        : { kind: 'world' },
    }
  })

  const codec = useMemo(() => basesCodec(index), [index])
  const [params, setParams] = useViewParams(
    'bases',
    BASES_DEFAULTS,
    codec,
    // A jump beats the hash: it is intent expressed now.
    () =>
      focus
        ? {
            source: initial.source,
            containerId: initial.container,
            structureId: initial.structureId,
          }
        : undefined,
  )

  const { source, query, storageOnly } = params
  const selectedContainer = params.containerId
  const patch = (p: Partial<BasesParams>) =>
    setParams((prev) => ({ ...prev, ...p }))

  const setSource = (source: Source) => patch({ source })
  const setSelectedContainer = (containerId: Guid | undefined) =>
    patch({ containerId })
  const setQuery = (query: string) => patch({ query })

  const selectedStructure = params.structureId
  const setSelectedStructure = (structureId: Guid | undefined) =>
    patch({ structureId })

  const container = selectedContainer
    ? index.containerById.get(selectedContainer)
    : undefined
  const structure = selectedStructure
    ? index.structureById.get(selectedStructure)
    : undefined

  /** Everything at the chosen source, before the list's own filters. */
  const sourceStructures = useMemo(
    () =>
      source.kind === 'base'
        ? (index.structuresByBase.get(source.baseId) ?? [])
        : source.kind === 'world'
          ? worldChests
          : [],
    [index, source, worldChests],
  )
  const builders = useMemo(
    () => buildersOf(index, sourceStructures),
    [index, sourceStructures],
  )
  const { builder, damaged, locked, sort } = params
  const listed = useMemo(
    () =>
      filterStructures(sourceStructures, {
        storageOnly,
        builder,
        damaged,
        locked,
      }),
    [sourceStructures, storageOnly, builder, damaged, locked],
  )
  const narrowed = storageOnly || !!builder || damaged || locked
  const clearFilters = () =>
    patch({ storageOnly: false, builder: '', damaged: false, locked: false })

  /**
   * Everything worn, at the current threshold. Worked out here rather than in
   * the list because the rail counts it too. Empty until reference data
   * arrives: an item's full durability is not in the save.
   */
  const worn = useMemo(
    () =>
      wornItems(
        index,
        (staticId) => data?.items[staticId.toLowerCase()]?.durability,
        params.wear / 100,
      ),
    [index, data, params.wear],
  )

  /** What the centre column is showing, resolved to containers, for export. */
  const visibleContainers = useMemo(() => {
    if (source.kind === 'unattributed') return orphans
    return listed.flatMap((s) => {
      const c = s.containerId
        ? index.containerById.get(s.containerId)
        : undefined
      return c ? [c] : []
    })
  }, [index, source, orphans, listed])

  const openContainer = (containerId: Guid) => {
    const { source: next, structureId } = locate(index, containerId)
    setSelectedContainer(containerId)
    setSelectedStructure(structureId)
    setSource(next)
  }

  return (
    <div className="flex h-full">
      <SourceRail
        index={index}
        bases={bases}
        baseNames={baseNames}
        worldChests={worldChests}
        orphans={orphans}
        worn={data ? worn.length : undefined}
        wear={params.wear}
        source={source}
        onSelect={(s) =>
          // The builder goes with the place: whoever built one base may have
          // built nothing at the next, and the list would open empty.
          patch({
            source: s,
            containerId: undefined,
            structureId: undefined,
            builder: '',
          })
        }
      />

      {/*
        The list column is fixed and the detail pane takes the room, which is
        the design system's own proportion for this screen: the grid and the
        contents table sit side by side over there and need the width far more
        than a column of structure names does.
      */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-[var(--color-line)]">
        <ItemSearch
          index={index}
          query={query}
          onQuery={setQuery}
          nameOfItem={nameOfItem}
          nameOfStructure={nameOfStructure}
          nameOfBase={nameOfBase}
          data={data}
          onOpen={(id) => {
            openContainer(id)
            setQuery('')
          }}
          onShowOnMap={(staticId) => {
            // Read at the moment of the click: the Map is not mounted while
            // this view is, so its link lives only in the store.
            const ui = useUiStore.getState()
            ui.publishParams('map', withItem(ui.viewParams.map ?? '', staticId))
            ui.setView('map')
          }}
        >
          {source.kind === 'wear' ? (
            <RangeControl
              label="at or under, % of full"
              value={params.wear}
              onChange={(wear) => patch({ wear })}
              step={5}
            />
          ) : (
            source.kind !== 'unattributed' && (
              <StructureFilters
                params={params}
                builders={builders}
                onChange={patch}
              />
            )
          )}
        </ItemSearch>

        {source.kind === 'wear' ? (
          <WearList
            index={index}
            worn={worn}
            threshold={params.wear}
            degraded={!data}
            nameOfItem={nameOfItem}
            nameOfStructure={nameOfStructure}
            nameOfBase={nameOfBase}
            selected={selectedContainer}
            onSelect={(id) =>
              // The source stays on the audit, so the next worn thing is one
              // click away; the pane beside it shows where this one is.
              patch({
                containerId: id,
                structureId: index.structureByContainer.get(id),
              })
            }
          />
        ) : source.kind === 'unattributed' ? (
          <OrphanList
            index={index}
            orphans={orphans}
            selected={selectedContainer}
            onSelect={(id) => {
              setSelectedContainer(id)
              // No map object claims these, so nothing should still be
              // described in the right pane from a previous selection.
              setSelectedStructure(undefined)
            }}
          />
        ) : (
          <StructureList
            index={index}
            structures={listed}
            total={sourceStructures.length}
            narrowed={narrowed}
            onShowAll={clearFilters}
            sort={sort}
            nameOfStructure={nameOfStructure}
            selected={selectedStructure}
            onSelect={(s) => {
              setSelectedStructure(s.instanceId)
              setSelectedContainer(s.containerId)
            }}
          />
        )}
      </div>

      <aside className="flex min-w-0 flex-1 flex-col">
        {/*
          Exports whatever the centre column is currently listing, which is the
          useful granularity here: "everything in this base" rather than the
          one container that happens to be selected. One row per stack, because
          a container is a sparse set of slots and not a rectangle.
        */}
        <div className="flex shrink-0 justify-end border-b border-[var(--color-line)] px-3 py-1.5">
          {source.kind === 'wear' ? (
            <ExportMenu
              rows={wornRows(index, data, worn)}
              columns={WORN_COLUMNS}
              kind="wear"
              title={`Export the ${worn.length} worn items in this list`}
            />
          ) : (
            <ExportMenu
              rows={containerRows(index, data, visibleContainers)}
              columns={CONTAINER_COLUMNS}
              kind="storage"
              title={`Export the contents of ${visibleContainers.length} containers in this view`}
            />
          )}
        </div>

        {/* Structure first: it describes the selection whether or not it has
            storage. A container with no structure — the unattributed bucket —
            still falls back to the inventory-only pane. */}
        {structure ? (
          <StructureDetail
            structure={structure}
            index={index}
            name={nameOfStructure(structure)}
            nameOfBase={nameOfBase}
            onClose={() => {
              setSelectedStructure(undefined)
              setSelectedContainer(undefined)
            }}
          />
        ) : container ? (
          <ContainerDetail
            container={container}
            index={index}
            nameOfStructure={nameOfStructure}
            nameOfBase={nameOfBase}
            onClose={() => setSelectedContainer(undefined)}
          />
        ) : (
          /* Nothing picked yet, so the pane shows the base itself. Clicking a
             dot in the plan selects that structure, which swaps this out. */
          <BaseOverview
            index={index}
            base={
              source.kind === 'base'
                ? index.baseById.get(source.baseId)
                : undefined
            }
            name={
              source.kind === 'base'
                ? (baseNames.get(source.baseId) ?? 'Base')
                : undefined
            }
            selected={selectedStructure}
            nameOfStructure={nameOfStructure}
            onDamaged={() =>
              patch({ damaged: true, storageOnly: false, builder: '' })
            }
            onSelect={(id) => {
              const st = index.structureById.get(id)
              if (!st) return
              setSelectedStructure(st.instanceId)
              setSelectedContainer(st.containerId)
            }}
          />
        )}
      </aside>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Left — where storage is
   ------------------------------------------------------------------------- */

function SourceRail({
  index,
  bases,
  baseNames,
  worldChests,
  orphans,
  worn,
  wear,
  source,
  onSelect,
}: {
  index: SaveIndex
  bases: Base[]
  baseNames: Map<Guid, string>
  worldChests: Structure[]
  orphans: Container[]
  /** How many items are worn, or undefined while that cannot be known. */
  worn: number | undefined
  /** The threshold that count was taken at, as a percentage. */
  wear: number
  source: Source
  onSelect: (s: Source) => void
}) {
  const worldTotals = storageTotals(
    index,
    worldChests.map((s) => s.containerId!),
  )
  const orphanTotals = storageTotals(
    index,
    orphans.map((c) => c.containerId),
  )
  const unknown = orphans.filter((c) => c.ownerKind === 'unknown').length

  return (
    <aside className="w-[var(--rail-width)] shrink-0 space-y-3 overflow-y-auto border-r border-[var(--color-line)] p-3">
      <Panel title="Bases">
        <ul>
          {bases.map((base) => {
            const structures = index.structuresByBase.get(base.baseId) ?? []
            const totals = storageTotals(
              index,
              structures.flatMap((s) => (s.containerId ? [s.containerId] : [])),
            )
            const workers = base.workerContainerId
              ? (index.palsByContainer.get(base.workerContainerId)?.length ?? 0)
              : 0
            const guild = base.groupId
              ? index.guildById.get(base.groupId)
              : undefined

            return (
              <li key={base.baseId}>
                <RailButton
                  active={
                    source.kind === 'base' && source.baseId === base.baseId
                  }
                  title={baseNames.get(base.baseId) ?? 'Base'}
                  card={{ kind: 'base', id: base.baseId }}
                  lines={[
                    `${count(structures.length)} structures · ${totals.containers} chests`,
                    `${workers} workers · ${compact(totals.items)} items`,
                    guild
                      ? `${guild.name} · camp level ${guild.baseCampLevel}`
                      : formatMapPos(posToMap(base.pos)),
                  ]}
                  onClick={() =>
                    onSelect({ kind: 'base', baseId: base.baseId })
                  }
                />
              </li>
            )
          })}
          {bases.length === 0 && (
            <li className="px-3 py-2 text-xs text-[var(--color-muted)]">
              No bases in this save.
            </li>
          )}
        </ul>
      </Panel>

      <Panel title="Elsewhere">
        <ul>
          <li>
            <RailButton
              active={source.kind === 'world'}
              title="Out in the world"
              lines={[
                `${count(worldChests.length)} containers`,
                `${compact(worldTotals.items)} items`,
                'treasure boxes and drops',
              ]}
              onClick={() => onSelect({ kind: 'world' })}
            />
          </li>
          <li>
            <RailButton
              active={source.kind === 'unattributed'}
              title="Unattributed storage"
              lines={[
                `${count(orphans.length)} containers`,
                `${compact(orphanTotals.items)} items`,
                `${unknown} with no owner at all`,
              ]}
              onClick={() => onSelect({ kind: 'unattributed' })}
            />
          </li>
        </ul>
      </Panel>

      <Panel title="Wear">
        <ul>
          <li>
            <RailButton
              active={source.kind === 'wear'}
              title="Worn gear"
              lines={[
                worn === undefined
                  ? 'needs game data'
                  : `${count(worn)} ${worn === 1 ? 'item' : 'items'}`,
                `at or under ${wear}% durability`,
              ]}
              onClick={() => onSelect({ kind: 'wear' })}
            />
          </li>
        </ul>
      </Panel>

      <p className="px-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
        Containers do not record an owner. Anything a map object claims is
        exact; the rest is inferred, and player saves upgrade it.
      </p>
    </aside>
  )
}

function RailButton({
  active,
  title,
  lines,
  card,
  onClick,
}: {
  active: boolean
  title: string
  lines: string[]
  card?: CardDescriptor
  onClick: () => void
}) {
  return (
    <ListRow
      selected={active}
      onClick={onClick}
      card={card}
      className="items-start py-1.5"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-tight">{title}</span>
        {lines.map((l) => (
          <span
            key={l}
            className={cn(
              'num block truncate text-[11px]',
              active ? 'text-white/75' : 'text-[var(--color-muted)]',
            )}
          >
            {l}
          </span>
        ))}
      </span>
    </ListRow>
  )
}

/* -------------------------------------------------------------------------
   Centre — what is there
   ------------------------------------------------------------------------- */

/**
 * What narrows the structure list.
 *
 * The builder select only appears where somebody built something: world chests
 * have no builder, and a select with one option is not a choice.
 */
function StructureFilters({
  params,
  builders,
  onChange,
}: {
  params: BasesParams
  builders: Builder[]
  onChange: (p: Partial<BasesParams>) => void
}) {
  const check = 'gap-2 text-xs text-[var(--color-muted)]'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <Checkbox
          checked={params.storageOnly}
          onChange={(storageOnly) => onChange({ storageOnly })}
          label="storage only"
          className={check}
        />
        <Checkbox
          checked={params.damaged}
          onChange={(damaged) => onChange({ damaged })}
          label="damaged"
          className={check}
        />
        <Checkbox
          checked={params.locked}
          onChange={(locked) => onChange({ locked })}
          label="locked"
          className={check}
        />
      </div>
      <div className="flex gap-2">
        {builders.length > 0 && (
          <SelectControl
            aria-label="Built by"
            className="min-w-0 flex-1"
            value={params.builder}
            onChange={(builder) => onChange({ builder })}
            options={[
              { value: '', label: 'Built by anyone' },
              ...builders.map((b) => ({
                value: b.uid,
                label: `${b.name ?? 'Unknown player'} · ${count(b.count)}`,
              })),
            ]}
          />
        )}
        <SelectControl
          aria-label="Order"
          className="min-w-0 flex-1"
          value={params.sort}
          onChange={(sort) => onChange({ sort: sort as StructureSort })}
          options={[
            { value: 'type', label: 'Grouped by kind' },
            { value: 'full', label: 'Fullest first' },
          ]}
        />
      </div>
    </div>
  )
}

type Row =
  | { kind: 'group'; key: string; label: string; n: number; open: boolean }
  | { kind: 'structure'; key: string; structure: Structure }

function StructureList({
  index,
  structures,
  total,
  narrowed,
  onShowAll,
  sort,
  nameOfStructure,
  selected,
  onSelect,
}: {
  index: SaveIndex
  /** What the filters let through. */
  structures: Structure[]
  /** How many there are here before the filters. */
  total: number
  /** Whether any filter is on. */
  narrowed: boolean
  /** Turn the filters off, from the empty state they caused. */
  onShowAll: () => void
  sort: StructureSort
  nameOfStructure: (s: Structure) => string
  selected?: Guid
  onSelect: (s: Structure) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())

  // Grouped by asset id rather than by friendly name: two assets can share a
  // display name, and merging them would make the counts wrong.
  const rows = useMemo(() => {
    // Fullest first is a ranking across kinds, so it has no groups: the point
    // is which chest to empty, whatever it is made of.
    if (sort === 'full') {
      return byFullness(index, structures).map((s): Row => ({
        kind: 'structure',
        key: s.instanceId,
        structure: s,
      }))
    }

    const groups = new Map<string, Structure[]>()
    for (const s of structures) {
      const bucket = groups.get(s.mapObjectId)
      if (bucket) bucket.push(s)
      else groups.set(s.mapObjectId, [s])
    }

    const out: Row[] = []
    for (const [id, members] of [...groups].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      const first = members[0]
      if (!first) continue
      const open = !closed.has(id)
      out.push({
        kind: 'group',
        key: id,
        label: nameOfStructure(first),
        n: members.length,
        open,
      })
      if (!open) continue
      for (const s of members) {
        out.push({ kind: 'structure', key: s.instanceId, structure: s })
      }
    }
    return out
  }, [index, structures, sort, closed, nameOfStructure])

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  return (
    <div className="flex min-h-0 flex-1">
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          // Two different kinds of empty. With a filter on, "nothing matches"
          // is the filter's doing and one press undoes it; with none on there
          // is simply nothing built here.
          <div className="space-y-3 p-6 text-sm text-[var(--color-muted)]">
            {narrowed && total > 0 ? (
              <>
                <p>
                  Nothing here matches. {count(total)}{' '}
                  {total === 1 ? 'thing is' : 'things are'} built here that the
                  filters are hiding.
                </p>
                <Button size="sm" onClick={onShowAll}>
                  Show everything built here
                </Button>
              </>
            ) : (
              <p>Nothing is built here.</p>
            )}
          </div>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]
              if (!row) return null
              return (
                <div
                  key={row.key}
                  className="absolute inset-x-0 top-0"
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  {row.kind === 'group' ? (
                    <GroupHeader
                      row={row}
                      onToggle={() =>
                        setClosed((s) => {
                          const next = new Set(s)
                          if (next.has(row.key)) next.delete(row.key)
                          else next.add(row.key)
                          return next
                        })
                      }
                    />
                  ) : (
                    <StructureRow
                      index={index}
                      structure={row.structure}
                      name={nameOfStructure(row.structure)}
                      selected={row.structure.instanceId === selected}
                      onSelect={() => onSelect(row.structure)}
                      grouped={sort === 'type'}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * What the detail pane shows before anything in a base is picked: the base as a
 * place, rather than "pick something".
 *
 * The plan was a 288px column beside the structure list until the panes were
 * reproportioned; here it has room to be read, and every dot is still a
 * shortcut into the structure it belongs to.
 */
function BaseOverview({
  index,
  base,
  name,
  selected,
  onSelect,
  onDamaged,
  nameOfStructure,
}: {
  index: SaveIndex
  base?: Base
  name?: string
  selected?: Guid
  onSelect: (id: Guid) => void
  /** Narrow the structure list to what is damaged. */
  onDamaged: () => void
  nameOfStructure: (s: Structure) => string
}) {
  if (!base) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-[var(--color-muted)]">
          Pick a structure or a container to see its details.
        </p>
      </div>
    )
  }

  const structures = index.structuresByBase.get(base.baseId) ?? []
  const chestIds = new Set(
    structures.flatMap((s) => (s.containerId ? [s.instanceId] : [])),
  )
  const health = baseHealth(index, base)
  const guild = base.groupId ? index.guildById.get(base.groupId) : undefined

  // One colour per builder, and only when there is more than one: a plan drawn
  // all in one colour says nothing its legend would not.
  const builders = buildersOf(index, structures)
  const tints = new Map(
    builders.length > 1
      ? builders.map((b, i) => [b.uid, categoricalCss(i)])
      : [],
  )
  const unbuilt = structures.filter((s) => !s.buildPlayerUid).length

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-3xl flex-wrap items-start gap-8">
        <div className="w-[320px] shrink-0">
          <BasePlan
            base={base}
            structures={structures}
            chestIds={chestIds}
            selectedId={selected}
            onSelect={onSelect}
            nameOf={nameOfStructure}
            tintOf={
              tints.size > 0
                ? (s) =>
                    s.buildPlayerUid ? tints.get(s.buildPlayerUid) : undefined
                : undefined
            }
          />
          {tints.size > 0 && (
            <ul
              aria-label="Who built what"
              className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-muted)]"
            >
              {builders.map((b) => (
                <li key={b.uid} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ background: tints.get(b.uid) }}
                  />
                  {b.name ?? 'Unknown player'}
                  <span className="num">{count(b.count)}</span>
                </li>
              ))}
              {unbuilt > 0 && (
                <li
                  className="flex items-center gap-1.5"
                  title="World scenery, or placed by a pal rather than a player."
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full bg-[var(--color-muted)] opacity-55"
                  />
                  no builder
                  <span className="num">{count(unbuilt)}</span>
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="min-w-[220px] flex-1">
          <div className="text-lg leading-tight">{name}</div>
          <div className="label mt-1.5">
            {guild
              ? `${guild.name} · camp level ${guild.baseCampLevel}`
              : 'no guild recorded'}
          </div>
          <dl className="mt-4">
            <Field label="centre" value={formatMapPos(posToMap(base.pos))} />
            <Field
              label="build radius"
              value={`${base.areaRange.toFixed(0)} units`}
            />
            <Field label="structures" value={count(health.structures)} />
            <Field label="with storage" value={count(chestIds.size)} />
          </dl>

          <div className="label mt-5">health</div>
          <dl className="mt-1.5">
            <HealthField
              label="damaged"
              n={health.damaged}
              of={health.structures}
              action={
                health.damaged > 0
                  ? { label: 'list', onClick: onDamaged }
                  : undefined
              }
            />
            <HealthField
              label="locked"
              n={health.locked}
              of={health.structures}
              neutral
            />
            <HealthField
              label="workers needing care"
              n={health.workersAiling}
              of={health.workers}
            />
          </dl>
          <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-muted)]">
            Every dot is a structure, drawn from the same coordinates as the
            world map{tints.size > 0 && ', in the colour of whoever built it'}.
            Larger dots hold storage. The ring is the camp's build radius;
            buildings outside it are normal.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * "3 of 853", in the warning colour when the 3 is something to act on.
 *
 * A locked chest is not a fault, so it can ask to stay neutral.
 */
function HealthField({
  label,
  n,
  of,
  neutral,
  action,
}: {
  label: string
  n: number
  of: number
  neutral?: boolean
  action?: { label: string; onClick: () => void }
}) {
  return (
    <Field
      label={label}
      value={
        <>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="mr-3 font-sans text-[11px] text-[var(--color-signal)] underline-offset-2 hover:underline"
            >
              {action.label}
            </button>
          )}
          <span
            className={
              n > 0 && !neutral ? 'text-[var(--color-stamina)]' : undefined
            }
          >
            {count(n)}
          </span>
          <span className="text-[var(--color-muted)]"> of {count(of)}</span>
        </>
      }
    />
  )
}

function GroupHeader({
  row,
  onToggle,
}: {
  row: Row & { kind: 'group' }
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={row.open}
      className="flex h-full w-full items-center gap-2 border-y border-[var(--color-line-faint)] bg-[rgb(5_13_19/0.85)] px-3 text-left backdrop-blur-sm transition-colors hover:bg-[var(--color-signal)]/[0.08]"
    >
      <span
        aria-hidden
        className="num w-3 shrink-0 text-[11px] text-[var(--color-muted)]"
      >
        {row.open ? '−' : '+'}
      </span>
      <span className="truncate text-sm">{row.label}</span>
      <span className="num ml-auto shrink-0 text-xs text-[var(--color-muted)]">
        {count(row.n)}
      </span>
    </button>
  )
}

function StructureRow({
  index,
  structure,
  name,
  selected,
  onSelect,
  grouped,
}: {
  index: SaveIndex
  structure: Structure
  name: string
  selected: boolean
  onSelect: () => void
  /** Under a group heading, and so indented beneath it. */
  grouped: boolean
}) {
  const { data } = useRefdataStore()
  const info = data?.structures[structure.mapObjectId.toLowerCase()]
  const container = structure.containerId
    ? index.containerById.get(structure.containerId)
    : undefined
  const damaged = isDamaged(structure)
  const builder = structure.buildPlayerUid
    ? index.playerByUid.get(structure.buildPlayerUid)?.name
    : undefined

  return (
    <ListRow
      selected={selected}
      onClick={onSelect}
      card={{ kind: 'structure', id: structure.instanceId }}
      className={cn('h-full', grouped && 'pl-6')}
    >
      <GameIcon path={info?.icon} name={name} size={22} />
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-tight">{name}</span>
        <span
          className={cn(
            'num block truncate text-[11px]',
            selected ? 'text-white/75' : 'text-[var(--color-muted)]',
          )}
        >
          {formatMapPos(posToMap(structure.pos))}
          {damaged && ` · ${hpPercent(structure)}% hp`}
          {builder && ` · ${builder}`}
        </span>
      </span>
      {structure.locked && <Pill tone="warn">locked</Pill>}
      {container && (
        <span
          className="num shrink-0 text-xs text-[var(--color-gold)]"
          title="Stacks held"
        >
          {container.slots.length}
        </span>
      )}
    </ListRow>
  )
}

/* -------------------------------------------------------------------------
   Centre — the unattributed bucket
   ------------------------------------------------------------------------- */

function OrphanList({
  index,
  orphans,
  selected,
  onSelect,
}: {
  index: SaveIndex
  orphans: Container[]
  selected?: Guid
  onSelect: (id: Guid) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Fullest first: an unattributed container with 40 stacks in it is the one
  // someone is looking for, and one with a single arrow in it is not.
  const sorted = useMemo(
    () =>
      [...orphans].sort(
        (a, b) =>
          b.slots.length - a.slots.length ||
          a.containerId.localeCompare(b.containerId),
      ),
    [orphans],
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <p className="border-b border-[var(--color-line-faint)] px-4 py-3 text-xs leading-relaxed text-[var(--color-muted)]">
        No map object claims these. Most are pal gear and player inventories,
        whose owning records live in <span className="num">Players/*.sav</span>{' '}
        rather than in the level — drop that folder to attribute them exactly.
      </p>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const c = sorted[v.index]
          if (!c) return null
          const items = c.slots.reduce((sum, s) => sum + s.count, 0)
          return (
            <div
              key={c.containerId}
              className="absolute inset-x-0 top-0"
              style={{
                height: ROW_HEIGHT,
                transform: `translateY(${v.start}px)`,
              }}
            >
              <ListRow
                selected={c.containerId === selected}
                onClick={() => onSelect(c.containerId)}
                className="h-full"
              >
                <OwnerKindPill kind={c.ownerKind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-tight">
                    {ownerLabel(index, c)}
                  </span>
                  <span className="num block truncate text-[11px] text-[var(--color-muted)]">
                    {c.containerId.slice(0, 8)}
                  </span>
                </span>
                <span className="num shrink-0 text-xs text-[var(--color-muted)]">
                  {c.slots.length} · {compact(items)}
                </span>
              </ListRow>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ownerLabel(index: SaveIndex, c: Container): string {
  if (c.ownerKind === 'pal') return 'Pal equipment'
  if (c.ownerKind === 'guild') {
    const guild = c.ownerId ? index.guildById.get(c.ownerId) : undefined
    return guild ? `${guild.name} storage` : 'Guild storage'
  }
  if (c.ownerKind === 'player') {
    const player = c.ownerId ? index.playerByUid.get(c.ownerId) : undefined
    return player
      ? `${player.name} · ${c.ownerSlot ?? 'inventory'}`
      : 'Player inventory'
  }
  return 'No owner found'
}

function OwnerKindPill({ kind }: { kind: Container['ownerKind'] }) {
  const tone = kind === 'unknown' ? 'warn' : 'neutral'
  return <Pill tone={tone}>{kind}</Pill>
}

/* -------------------------------------------------------------------------
   Centre — the wear audit
   ------------------------------------------------------------------------- */

/**
 * Every worn item in the save, worst first, each with where it is.
 *
 * Wear was only ever visible one cell at a time, as a two-pixel bar on a slot
 * you had already found. This is the same fact asked the other way round:
 * what is about to break, and where do I go to fix it.
 */
function WearList({
  index,
  worn,
  threshold,
  degraded,
  nameOfItem,
  nameOfStructure,
  nameOfBase,
  selected,
  onSelect,
}: {
  index: SaveIndex
  worn: WornItem[]
  threshold: number
  /** No reference data, so no full durability to measure against. */
  degraded: boolean
  nameOfItem: (staticId: string) => string
  nameOfStructure: (s: Structure) => string
  nameOfBase: (b: Base) => string
  selected?: Guid
  onSelect: (containerId: Guid) => void
}) {
  const { data } = useRefdataStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: worn.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  if (worn.length === 0) {
    return (
      <p className="p-6 text-sm leading-relaxed text-[var(--color-muted)]">
        {degraded
          ? 'Wear is measured against an item’s full durability, which is game data rather than something the save records. It could not be loaded.'
          : `Nothing is at or under ${threshold}% of its durability.`}
      </p>
    )
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const w = worn[v.index]
          const c = w ? index.containerById.get(w.containerId) : undefined
          if (!w || !c) return null
          const where = containerLocation(index, c, nameOfStructure, nameOfBase)
          const name = nameOfItem(w.staticId)
          const isSelected = w.containerId === selected
          return (
            <div
              key={w.dynamicId}
              className="absolute inset-x-0 top-0"
              style={{
                height: ROW_HEIGHT,
                transform: `translateY(${v.start}px)`,
              }}
            >
              <ListRow
                selected={isSelected}
                onClick={() => onSelect(w.containerId)}
                card={{
                  kind: 'item',
                  staticId: w.staticId,
                  count: 1,
                  dynamicId: w.dynamicId,
                }}
                className="h-full"
              >
                <GameIcon
                  path={data?.items[w.staticId.toLowerCase()]?.icon}
                  name={name}
                  size={22}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-tight">{name}</span>
                  <span
                    className={cn(
                      'block truncate text-[11px]',
                      isSelected
                        ? 'text-white/75'
                        : 'text-[var(--color-muted)]',
                    )}
                  >
                    {where.label}
                    {where.detail && ` · ${where.detail}`}
                  </span>
                </span>
                <span
                  className="num shrink-0 text-xs"
                  style={{
                    color: isSelected ? undefined : wearColor(w.fraction),
                  }}
                  title={`${Math.round(w.durability)} of ${w.full} durability`}
                >
                  {Math.round(w.fraction * 100)}%
                </span>
              </ListRow>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Right — what is in it
   ------------------------------------------------------------------------- */

function ContainerDetail({
  container,
  index,
  nameOfStructure,
  nameOfBase,
  onClose,
}: {
  container: Container
  index: SaveIndex
  nameOfStructure: (s: Structure) => string
  nameOfBase: (b: Base) => string
  onClose: () => void
}) {
  const where = containerLocation(index, container, nameOfStructure, nameOfBase)
  return (
    <ContainerGrid
      container={container}
      index={index}
      title={where.label}
      subtitle={where.detail}
      onClose={onClose}
    />
  )
}

/**
 * Everything the save knows about one structure.
 *
 * This pane used to render only when the selection had a *container*, so
 * picking a wall or a bed produced "Pick something with storage" and nothing
 * else — a dead end for the 538 structures with no inventory, and the only
 * place `buildPlayerUid` could reasonably be surfaced.
 *
 * Now the structure is always described, and the inventory grid becomes an
 * additional section when there is one.
 */
function StructureDetail({
  structure,
  index,
  name,
  nameOfBase,
  onClose,
}: {
  structure: Structure
  index: SaveIndex
  name: string
  nameOfBase: (b: Base) => string
  onClose: () => void
}) {
  const { data } = useRefdataStore()
  const info = data?.structures[structure.mapObjectId.toLowerCase()]
  const container = structure.containerId
    ? index.containerById.get(structure.containerId)
    : undefined
  const base = structure.baseCampId
    ? index.baseById.get(structure.baseCampId)
    : undefined
  const builder = structure.buildPlayerUid
    ? index.playerByUid.get(structure.buildPlayerUid)
    : undefined
  const damaged = isDamaged(structure)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-lg leading-tight">{name}</div>
          <div className="label mt-1.5 truncate">
            {base ? nameOfBase(base) : 'out in the world'}
          </div>
        </div>
        <IconButton label="Close" tone="ghost" size={24} onClick={onClose}>
          ×
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[300px] shrink-0 overflow-y-auto border-r border-[var(--color-line)] p-4">
          <dl>
            <DetailRow
              label="type"
              value={info?.category ?? info?.typeA ?? '—'}
            />
            <DetailRow
              label="built by"
              value={
                builder?.name ??
                (structure.buildPlayerUid
                  ? 'a player not in this save'
                  : 'not player-built')
              }
              hint={
                structure.buildPlayerUid
                  ? undefined
                  : 'World scenery, or placed by a pal rather than a player.'
              }
            />
            <DetailRow
              label="position"
              value={formatMapPos(posToMap(structure.pos))}
            />
            <DetailRow
              label="lock"
              value={structure.locked ? 'password set' : 'unlocked'}
            />
            <DetailRow label="asset" value={structure.mapObjectId} />
          </dl>

          {structure.hpMax !== undefined && (
            <div className="mt-4">
              <div className="label mb-1.5">
                condition
                <span className="ml-2 normal-case">
                  {damaged ? `${hpPercent(structure)}% — damaged` : 'undamaged'}
                </span>
              </div>
              {/* The one HP in this app with a maximum the save actually
                records, so the one place a meter is honest. */}
              <Meter
                value={structure.hpCurrent ?? structure.hpMax}
                max={structure.hpMax}
                tone={damaged ? 'stamina' : 'hp'}
                height={12}
              />
            </div>
          )}

          {!container && (
            <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-muted)]">
              This structure holds no items. The save does not record who
              crafted an item, so storage shows what is inside and where, not
              who made it.
            </p>
          )}
        </div>

        {container && (
          <div className="min-w-0 flex-1">
            {/* No title or location here: the structure's own header two
                inches up says both. */}
            <ContainerGrid container={container} index={index} />
          </div>
        )}
      </div>
    </div>
  )
}

/** `Field` in a `<dl>`, so the pane stays a description list. */
function DetailRow({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return <Field label={label} value={value} title={hint} />
}

/* -------------------------------------------------------------------------
   Global item search
   ------------------------------------------------------------------------- */

/** Item matches shown before "show more". */
const ITEM_PAGE = 40

function ItemSearch({
  index,
  query,
  onQuery,
  nameOfItem,
  nameOfStructure,
  nameOfBase,
  data,
  onOpen,
  onShowOnMap,
  children,
}: {
  index: SaveIndex
  query: string
  onQuery: (q: string) => void
  nameOfItem: (staticId: string) => string
  nameOfStructure: (s: Structure) => string
  nameOfBase: (b: Base) => string
  data: Refdata | undefined
  onOpen: (containerId: Guid) => void
  /** Mark every container holding this item on the map, and go there. */
  onShowOnMap: (staticId: string) => void
  /** The list's own filters, which sit under the search box. */
  children?: ReactNode
}) {
  // Every match, not the first forty: the export wants them all, and the list
  // says how many it is holding back.
  const hits = useMemo(
    () => searchItems(index, query, nameOfItem, Infinity),
    [index, query, nameOfItem],
  )
  const [expanded, setExpanded] = useState<string>()
  const [limit, setLimit] = useState(ITEM_PAGE)
  const shown = hits.slice(0, limit)
  const toggle = (staticId: string | undefined) =>
    setExpanded((e) => (e === staticId ? undefined : staticId))
  const search = (q: string) => {
    onQuery(q)
    setExpanded(undefined)
    setLimit(ITEM_PAGE)
  }
  const open = query.trim() !== ''
  const rootRef = useRef<HTMLDivElement>(null)
  const combo = useCombobox({
    rootRef,
    count: shown.length,
    open,
    // A hit is a heading over the places the item is in, so choosing one opens
    // that list rather than leaving the search.
    onPick: (i) => toggle(shown[i]?.staticId),
    onClose: () => search(''),
    resetKey: query,
  })

  return (
    <div ref={rootRef} className="relative border-b border-[var(--color-line)]">
      <div className="space-y-2 px-3 py-2.5">
        <TextInput
          value={query}
          onChange={search}
          aria-label="Find an item anywhere in the world"
          {...combo.inputProps}
          placeholder="Find an item anywhere…"
        />
        {children}
      </div>

      {open && (
        <div
          {...combo.listProps}
          className="absolute top-full left-3 z-20 max-h-[60vh] w-[560px] max-w-[calc(100vw-var(--rail-width)-2rem)] overflow-y-auto"
        >
          <Panel className="divide-y divide-[var(--color-line-faint)]">
            {hits.length === 0 ? (
              <p className="px-3 py-2.5 text-sm text-[var(--color-muted)]">
                Nothing in this save matches “{query}”.
              </p>
            ) : (
              <>
                {/* One row per place, not per item — "where is my Paldium"
                    is the question, so the answer has to keep the places. */}
                <div className="flex justify-end px-3 py-1.5">
                  <ExportMenu
                    rows={itemHitRows(index, data, hits)}
                    columns={ITEM_HIT_COLUMNS}
                    kind="item-search"
                    title={`Export every place these ${hits.length} items were found`}
                  />
                </div>
                {shown.map((hit, i) => (
                  <div key={hit.staticId}>
                    <ItemHitButton
                      hit={hit}
                      expanded={expanded === hit.staticId}
                      option={combo.optionProps(i)}
                      onClick={() => toggle(hit.staticId)}
                    />

                    {expanded === hit.staticId && (
                      <ul className="border-t border-[var(--color-line-faint)] bg-[rgb(3_9_13/0.4)]">
                        <ShowOnMap
                          index={index}
                          hit={hit}
                          onClick={() => onShowOnMap(hit.staticId)}
                        />
                        {hit.places.map((place) => {
                          const c = index.containerById.get(place.containerId)
                          if (!c) return null
                          const where = containerLocation(
                            index,
                            c,
                            nameOfStructure,
                            nameOfBase,
                          )
                          return (
                            <li key={place.containerId}>
                              <button
                                type="button"
                                onClick={() => onOpen(place.containerId)}
                                className="flex w-full items-baseline gap-3 py-1.5 pr-3 pl-6 text-left transition-colors hover:bg-[var(--color-signal)]/[0.08]"
                              >
                                <span className="truncate text-xs">
                                  {where.label}
                                </span>
                                {where.detail && (
                                  <span className="label truncate">
                                    {where.detail}
                                  </span>
                                )}
                                {!where.exact && <Pill>inferred</Pill>}
                                <span className="num ml-auto shrink-0 text-xs">
                                  {count(place.count)}
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                ))}
                <MoreResults
                  shown={shown.length}
                  total={hits.length}
                  onMore={() => setLimit((n) => n + ITEM_PAGE)}
                />
              </>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

/**
 * The way from "it is in these places" to seeing those places.
 *
 * Only a container a structure claims stands anywhere, so the row says how many
 * of the places that is, and is left out when it is none: a button that opens
 * a map with nothing marked on it would be a dead end.
 */
function ShowOnMap({
  index,
  hit,
  onClick,
}: {
  index: SaveIndex
  hit: ItemHit
  onClick: () => void
}) {
  const placed = itemPlaces(index, hit.staticId).places.length
  if (placed === 0) return null
  return (
    <li className="border-b border-[var(--color-line-faint)]">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-baseline gap-3 py-1.5 pr-3 pl-6 text-left text-xs text-[var(--color-signal)] transition-colors hover:bg-[var(--color-signal)]/[0.08]"
      >
        Show on map
        <span className="label ml-auto">
          {placed === hit.places.length
            ? `all ${count(placed)}`
            : `${count(placed)} of ${count(hit.places.length)} places`}
        </span>
      </button>
    </li>
  )
}

/** A search hit, whose hover card is the item it found. */
function ItemHitButton({
  hit,
  expanded,
  option,
  onClick,
}: {
  hit: ItemHit
  expanded: boolean
  option: ReturnType<Combobox['optionProps']>
  onClick: () => void
}) {
  const hover = useHoverCard({
    kind: 'item',
    staticId: hit.staticId,
    count: hit.total,
    places: hit.places.length,
  })
  return (
    <button
      type="button"
      onClick={onClick}
      {...hover}
      {...option}
      aria-expanded={expanded}
      className={cn(
        'flex w-full items-baseline gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--color-signal)]/[0.08]',
        OPTION_ACTIVE,
      )}
    >
      <span className="truncate text-sm">{hit.name}</span>
      <span className="num ml-auto shrink-0 text-xs">{count(hit.total)}</span>
      <span className="label shrink-0">
        {hit.places.length} place
        {hit.places.length === 1 ? '' : 's'}
      </span>
    </button>
  )
}
