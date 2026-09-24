import type { Guid, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { baseLabel, storageTotals } from '../../domain/bases.ts'
import { formatMapPos, posToMap } from '../../domain/coords.ts'
import { compact, count } from '../../lib/format.ts'
import { GameIcon } from '../GameIcon.tsx'
import { Field, Meter, MonogramTile, Pill } from '../primitives.tsx'
import { CardFrame, CardSection } from './CardFrame.tsx'

/**
 * A base camp: whose it is, what stands in it, who works it and what it holds.
 *
 * Named the way the Bases view names it — "Base 2 · near …", by its place in
 * the save — because the save's own label is the same placeholder for every
 * base in every world.
 */
export function BaseCard({
  id,
  data,
  index,
}: {
  id: Guid
  data: Refdata | undefined
  index: SaveIndex
}) {
  const ordinal = index.bases.findIndex((b) => b.baseId === id)
  const base = index.bases[ordinal]
  if (!base) return <CardFrame title="Base" sub="Not in this save" />

  const structures = index.structuresByBase.get(base.baseId) ?? []
  const chests = structures.flatMap((s) =>
    s.containerId ? [s.containerId] : [],
  )
  const totals = storageTotals(index, chests)
  const workers = base.workerContainerId
    ? (index.palsByContainer.get(base.workerContainerId)?.length ?? 0)
    : 0
  const guild = base.groupId ? index.guildById.get(base.groupId) : undefined

  // What it holds most of, across every chest in the camp.
  const held = new Map<string, number>()
  for (const cid of chests) {
    for (const slot of index.containerById.get(cid)?.slots ?? []) {
      held.set(slot.staticId, (held.get(slot.staticId) ?? 0) + slot.count)
    }
  }
  const top = [...held].sort((a, b) => b[1] - a[1]).slice(0, 4)

  return (
    <CardFrame
      title={baseLabel(base, ordinal + 1, data?.landmarks)}
      sub={
        guild
          ? `${guild.name} · camp level ${guild.baseCampLevel}`
          : 'Base camp'
      }
    >
      <div className="grid grid-cols-2 gap-x-4 text-xs">
        <Field label="Structures" value={count(structures.length)} />
        <Field label="Chests" value={count(totals.containers)} />
        <Field label="Workers" value={workers} />
        <Field label="Items" value={compact(totals.items)} />
        <Field label="Radius" value={Math.round(base.areaRange)} />
      </div>
      <Field
        label="Position"
        value={formatMapPos(posToMap(base.pos))}
        className="text-xs"
      />
      {top.length > 0 && (
        <CardSection label="Holds most of">
          <ul className="flex flex-col gap-1 text-xs">
            {top.map(([staticId, n]) => {
              const info = data?.items[staticId.toLowerCase()]
              return (
                <li key={staticId} className="flex items-center gap-2">
                  <GameIcon
                    eager
                    path={info?.icon}
                    name={info?.name ?? staticId}
                    size={20}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {info?.name ?? staticId}
                  </span>
                  <span className="num text-[var(--color-muted)]">
                    {compact(n)}
                  </span>
                </li>
              )
            })}
          </ul>
        </CardSection>
      )}
    </CardFrame>
  )
}

/**
 * One map object: what it is, its condition, who built it and what is in it.
 *
 * Most of a world's map objects are scenery — treasure chests, ore, ruins —
 * and have no builder; the card says only what the save records.
 */
export function StructureCard({
  id,
  data,
  index,
}: {
  id: Guid
  data: Refdata | undefined
  index: SaveIndex
}) {
  const s = index.structureById.get(id)
  if (!s) return <CardFrame title="Structure" sub="Not in this save" />

  const info = data?.structures[s.mapObjectId.toLowerCase()]
  const name = info?.name ?? s.mapObjectId
  const builder = s.buildPlayerUid
    ? index.playerByUid.get(s.buildPlayerUid)?.name
    : undefined
  const container = s.containerId
    ? index.containerById.get(s.containerId)
    : undefined
  const items = container?.slots.reduce((n, slot) => n + slot.count, 0) ?? 0
  const ordinal = s.baseCampId
    ? index.bases.findIndex((b) => b.baseId === s.baseCampId)
    : -1
  const base = ordinal >= 0 ? index.bases[ordinal] : undefined

  return (
    <CardFrame
      icon={
        info?.icon ? (
          <GameIcon eager path={info.icon} name={name} size={44} />
        ) : (
          <MonogramTile name={name} size={44} />
        )
      }
      title={name}
      sub={[
        info?.category ?? info?.typeA,
        s.isBuilt ? 'in a base' : 'in the world',
      ]
        .filter(Boolean)
        .join(' · ')}
      aside={s.locked ? <Pill tone="warn">locked</Pill> : undefined}
    >
      {s.hpMax !== undefined && s.hpCurrent !== undefined && (
        <Meter
          label="HP"
          value={Math.round(s.hpCurrent)}
          max={Math.round(s.hpMax)}
          tone={s.hpCurrent / s.hpMax > 0.2 ? 'hp' : 'danger'}
          height={14}
        />
      )}
      {/* Names get a full row each: a gamertag and "Base 3 · near …" are
          both wider than half a card. */}
      <div className="text-xs">
        {builder && <Field label="Built by" value={builder} />}
        {base && (
          <Field
            label="Base"
            value={baseLabel(base, ordinal + 1, data?.landmarks)}
          />
        )}
        <Field label="Position" value={formatMapPos(posToMap(s.pos))} />
      </div>
      {container && (
        <div className="grid grid-cols-2 gap-x-4 text-xs">
          <Field label="Stacks" value={count(container.slots.length)} />
          <Field label="Items" value={compact(items)} />
        </div>
      )}
    </CardFrame>
  )
}
