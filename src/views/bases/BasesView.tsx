import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import {
  baseLabel,
  containerLocation,
  searchItems,
  storageTotals,
} from '../../domain/bases.ts'
import { formatMapPos, posToMap } from '../../domain/coords.ts'
import type {
  Base,
  Container,
  Guid,
  SaveIndex,
  Structure,
} from '../../domain/types.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { ExportMenu } from '../../components/ExportMenu.tsx'
import {
  CONTAINER_COLUMNS,
  ITEM_HIT_COLUMNS,
  containerRows,
  itemHitRows,
} from '../../domain/exportRows.ts'
import { Panel, Pill } from '../../components/primitives.tsx'
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
} from './params.ts'
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

  const nameOfStructure = (s: Structure) =>
    data?.structures[s.mapObjectId.toLowerCase()]?.name ?? s.mapObjectId
  const nameOfItem = (staticId: string) =>
    data?.items[staticId.toLowerCase()]?.name ?? staticId

  const bases = index.bases
  const baseNames = useMemo(
    () =>
      new Map(
        bases.map((b, i) => [b.baseId, baseLabel(b, i + 1, data?.landmarks)]),
      ),
    [bases, data],
  )
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
  const setStorageOnly = (storageOnly: boolean) => patch({ storageOnly })

  const selectedStructure = params.structureId
  const setSelectedStructure = (structureId: Guid | undefined) =>
    patch({ structureId })

  const container = selectedContainer
    ? index.containerById.get(selectedContainer)
    : undefined
  const structure = selectedStructure
    ? index.structureById.get(selectedStructure)
    : undefined

  /** What the centre column is showing, resolved to containers, for export. */
  const visibleContainers = useMemo(() => {
    if (source.kind === 'unattributed') return orphans
    const structures =
      source.kind === 'base'
        ? (index.structuresByBase.get(source.baseId) ?? [])
        : worldChests
    return structures.flatMap((s) => {
      const c = s.containerId
        ? index.containerById.get(s.containerId)
        : undefined
      return c ? [c] : []
    })
  }, [index, source, orphans, worldChests])

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
        source={source}
        onSelect={(s) => {
          setSource(s)
          setSelectedContainer(undefined)
          setSelectedStructure(undefined)
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ItemSearch
          index={index}
          query={query}
          onQuery={setQuery}
          nameOfItem={nameOfItem}
          nameOfStructure={nameOfStructure}
          nameOfBase={nameOfBase}
          onOpen={(id) => {
            openContainer(id)
            setQuery('')
          }}
          storageOnly={storageOnly}
          onStorageOnly={setStorageOnly}
          showStorageToggle={source.kind !== 'unattributed'}
        />

        {source.kind === 'unattributed' ? (
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
            structures={
              source.kind === 'base'
                ? (index.structuresByBase.get(source.baseId) ?? [])
                : worldChests
            }
            base={
              source.kind === 'base'
                ? index.baseById.get(source.baseId)
                : undefined
            }
            storageOnly={storageOnly}
            nameOfStructure={nameOfStructure}
            selected={selectedStructure}
            onSelect={(s) => {
              setSelectedStructure(s.instanceId)
              setSelectedContainer(s.containerId)
            }}
          />
        )}
      </div>

      <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--color-line)]">
        {/*
          Exports whatever the centre column is currently listing, which is the
          useful granularity here: "everything in this base" rather than the
          one container that happens to be selected. One row per stack, because
          a container is a sparse set of slots and not a rectangle.
        */}
        <div className="flex shrink-0 justify-end border-b border-[var(--color-line)] px-3 py-1.5">
          <ExportMenu
            rows={containerRows(index, data, visibleContainers)}
            columns={CONTAINER_COLUMNS}
            kind="storage"
            title={`Export the contents of ${visibleContainers.length} containers in this view`}
          />
        </div>

        {/* Structure first: it describes the selection whether or not it has
            storage. A container with no structure — the unattributed bucket —
            still falls back to the inventory-only pane. */}
        {structure ? (
          <StructureDetail
            structure={structure}
            index={index}
            name={nameOfStructure(structure)}
            nameOfStructure={nameOfStructure}
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
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="text-sm text-[var(--color-muted)]">
              Pick a structure or a container to see its details.
            </p>
          </div>
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
  source,
  onSelect,
}: {
  index: SaveIndex
  bases: Base[]
  baseNames: Map<Guid, string>
  worldChests: Structure[]
  orphans: Container[]
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
    <aside className="w-60 shrink-0 overflow-y-auto border-r border-[var(--color-line)] p-3">
      <div className="label mb-2 px-1">bases</div>
      <ul className="space-y-1">
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
                active={source.kind === 'base' && source.baseId === base.baseId}
                title={baseNames.get(base.baseId) ?? 'Base'}
                lines={[
                  `${count(structures.length)} structures · ${totals.containers} chests`,
                  `${workers} workers · ${compact(totals.items)} items`,
                  guild
                    ? `${guild.name} · camp level ${guild.baseCampLevel}`
                    : formatMapPos(posToMap(base.pos)),
                ]}
                onClick={() => onSelect({ kind: 'base', baseId: base.baseId })}
              />
            </li>
          )
        })}
        {bases.length === 0 && (
          <li className="px-1 text-xs text-[var(--color-muted)]">
            No bases in this save.
          </li>
        )}
      </ul>

      <div className="label mt-5 mb-2 px-1">elsewhere</div>
      <ul className="space-y-1">
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

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
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
  onClick,
}: {
  active: boolean
  title: string
  lines: string[]
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-[6px] border px-2.5 py-2 text-left transition-colors',
        active
          ? 'border-[var(--color-signal)]/60 bg-[var(--color-raised)]'
          : 'border-transparent hover:border-[var(--color-line)]',
      )}
    >
      <div className="truncate text-sm leading-tight">{title}</div>
      {lines.map((l) => (
        <div
          key={l}
          className="num truncate text-[10px] text-[var(--color-muted)]"
        >
          {l}
        </div>
      ))}
    </button>
  )
}

/* -------------------------------------------------------------------------
   Centre — what is there
   ------------------------------------------------------------------------- */

type Row =
  | { kind: 'group'; key: string; label: string; n: number; open: boolean }
  | { kind: 'structure'; key: string; structure: Structure }

function StructureList({
  index,
  structures,
  base,
  storageOnly,
  nameOfStructure,
  selected,
  onSelect,
}: {
  index: SaveIndex
  structures: Structure[]
  base?: Base
  storageOnly: boolean
  nameOfStructure: (s: Structure) => string
  selected?: Guid
  onSelect: (s: Structure) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())

  const visible = storageOnly
    ? structures.filter((s) => s.containerId)
    : structures

  // Grouped by asset id rather than by friendly name: two assets can share a
  // display name, and merging them would make the counts wrong.
  const rows = useMemo(() => {
    const groups = new Map<string, Structure[]>()
    for (const s of visible) {
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
  }, [visible, closed, nameOfStructure])

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  const chestIds = useMemo(
    () =>
      new Set(structures.flatMap((s) => (s.containerId ? [s.instanceId] : []))),
    [structures],
  )

  return (
    <div className="flex min-h-0 flex-1">
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-muted)]">
            Nothing here holds items.
          </p>
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
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {base && (
        <div className="w-72 shrink-0 border-l border-[var(--color-line)] p-4">
          <div className="label mb-2">plan</div>
          <BasePlan
            base={base}
            structures={structures}
            chestIds={chestIds}
            selectedId={selected}
            onSelect={(id) => {
              const s = index.structureById.get(id)
              if (s) onSelect(s)
            }}
          />
          <dl className="mt-4 space-y-1.5 text-xs">
            <PlanFact label="centre" value={formatMapPos(posToMap(base.pos))} />
            <PlanFact
              label="build radius"
              value={`${base.areaRange.toFixed(0)} units`}
            />
            <PlanFact label="structures" value={count(structures.length)} />
          </dl>
        </div>
      )}
    </div>
  )
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label">{label}</dt>
      <dd className="num text-[var(--color-muted)]">{value}</dd>
    </div>
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
      className="flex h-full w-full items-center gap-2 border-b border-[var(--color-line-faint)] bg-[var(--color-abyss)]/80 px-4 text-left backdrop-blur"
    >
      <span
        aria-hidden
        className="num w-3 shrink-0 text-[10px] text-[var(--color-muted)]"
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
}: {
  index: SaveIndex
  structure: Structure
  name: string
  selected: boolean
  onSelect: () => void
}) {
  const { data } = useRefdataStore()
  const info = data?.structures[structure.mapObjectId.toLowerCase()]
  const container = structure.containerId
    ? index.containerById.get(structure.containerId)
    : undefined
  const damaged =
    structure.hpMax !== undefined &&
    structure.hpCurrent !== undefined &&
    structure.hpCurrent < structure.hpMax
  const builder = structure.buildPlayerUid
    ? index.playerByUid.get(structure.buildPlayerUid)?.name
    : undefined

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex h-full w-full items-center gap-3 px-4 pl-9 text-left transition-colors',
        selected
          ? 'bg-[var(--color-raised)]'
          : 'hover:bg-[var(--color-raised)]/50',
      )}
    >
      <GameIcon path={info?.icon} name={name} size={22} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight">{name}</span>
        <span className="num block truncate text-[10px] text-[var(--color-muted)]">
          {formatMapPos(posToMap(structure.pos))}
          {damaged &&
            ` · ${Math.round((structure.hpCurrent! / structure.hpMax!) * 100)}% hp`}
          {builder && ` · ${builder}`}
        </span>
      </span>
      {structure.locked && <Pill tone="warn">locked</Pill>}
      {container && (
        <span className="num shrink-0 text-xs text-[oklch(0.80_0.15_85)]">
          {container.slots.length}
        </span>
      )}
    </button>
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
              <button
                type="button"
                onClick={() => onSelect(c.containerId)}
                className={cn(
                  'flex h-full w-full items-center gap-3 px-4 text-left transition-colors',
                  c.containerId === selected
                    ? 'bg-[var(--color-raised)]'
                    : 'hover:bg-[var(--color-raised)]/50',
                )}
              >
                <OwnerKindPill kind={c.ownerKind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-tight">
                    {ownerLabel(index, c)}
                  </span>
                  <span className="num block truncate text-[10px] text-[var(--color-muted)]">
                    {c.containerId.slice(0, 8)}
                  </span>
                </span>
                <span className="num shrink-0 text-xs text-[var(--color-muted)]">
                  {c.slots.length} · {compact(items)}
                </span>
              </button>
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
  nameOfStructure,
  nameOfBase,
  onClose,
}: {
  structure: Structure
  index: SaveIndex
  name: string
  nameOfStructure: (s: Structure) => string
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
  const damaged =
    structure.hpMax !== undefined &&
    structure.hpCurrent !== undefined &&
    structure.hpCurrent < structure.hpMax

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-display text-lg leading-tight">
            {name}
          </div>
          <div className="label mt-1 truncate">
            {base ? nameOfBase(base) : 'out in the world'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <dl className="space-y-1.5 text-xs">
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
          {structure.hpMax !== undefined && (
            <DetailRow
              label="condition"
              value={
                damaged
                  ? `${Math.round((structure.hpCurrent! / structure.hpMax) * 100)}% — ${count(structure.hpCurrent!)} / ${count(structure.hpMax)}`
                  : 'undamaged'
              }
            />
          )}
          <DetailRow
            label="lock"
            value={structure.locked ? 'password set' : 'unlocked'}
          />
          <DetailRow label="asset" value={structure.mapObjectId} />
        </dl>

        {container ? (
          <div className="-mx-4 mt-4 border-t border-[var(--color-line)]">
            <ContainerGrid
              container={container}
              index={index}
              title="Contents"
              subtitle={
                containerLocation(index, container, nameOfStructure, nameOfBase)
                  .detail
              }
            />
          </div>
        ) : (
          <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-muted)]">
            This structure holds no items. The save does not record who crafted
            an item, so storage shows what is inside and where, not who made it.
          </p>
        )}
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div
      title={hint}
      className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line-faint)] pb-1.5"
    >
      <dt className="label shrink-0">{label}</dt>
      <dd className="num truncate text-right">{value}</dd>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Global item search
   ------------------------------------------------------------------------- */

function ItemSearch({
  index,
  query,
  onQuery,
  nameOfItem,
  nameOfStructure,
  nameOfBase,
  onOpen,
  storageOnly,
  onStorageOnly,
  showStorageToggle,
}: {
  index: SaveIndex
  query: string
  onQuery: (q: string) => void
  nameOfItem: (staticId: string) => string
  nameOfStructure: (s: Structure) => string
  nameOfBase: (b: Base) => string
  onOpen: (containerId: Guid) => void
  storageOnly: boolean
  onStorageOnly: (v: boolean) => void
  showStorageToggle: boolean
}) {
  const hits = useMemo(
    () => searchItems(index, query, nameOfItem),
    [index, query, nameOfItem],
  )
  const [expanded, setExpanded] = useState<string>()

  return (
    <div className="relative border-b border-[var(--color-line)]">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <input
          value={query}
          onChange={(e) => {
            onQuery(e.target.value)
            setExpanded(undefined)
          }}
          aria-label="Find an item anywhere in the world"
          placeholder="Find an item anywhere in the world…"
          className="min-w-0 flex-1 rounded-[6px] border border-[var(--color-line)] bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-signal)]"
        />
        {showStorageToggle && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={storageOnly}
              onChange={(e) => onStorageOnly(e.target.checked)}
              className="accent-[var(--color-signal)]"
            />
            storage only
          </label>
        )}
      </div>

      {query.trim() !== '' && (
        <div className="absolute inset-x-4 top-full z-20 max-h-[60vh] overflow-y-auto">
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
                    rows={itemHitRows(index, hits)}
                    columns={ITEM_HIT_COLUMNS}
                    kind="item-search"
                    title={`Export every place these ${hits.length} items were found`}
                  />
                </div>
                {hits.map((hit) => (
                  <div key={hit.staticId}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((e) =>
                          e === hit.staticId ? undefined : hit.staticId,
                        )
                      }
                      className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-[var(--color-raised)]/60"
                    >
                      <span className="truncate text-sm">{hit.name}</span>
                      <span className="num ml-auto shrink-0 text-xs">
                        {count(hit.total)}
                      </span>
                      <span className="label shrink-0">
                        {hit.places.length} place
                        {hit.places.length === 1 ? '' : 's'}
                      </span>
                    </button>

                    {expanded === hit.staticId && (
                      <ul className="border-t border-[var(--color-line-faint)] bg-[var(--color-abyss)]/40">
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
                                className="flex w-full items-baseline gap-3 py-1.5 pr-3 pl-6 text-left hover:bg-[var(--color-raised)]/60"
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
              </>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
