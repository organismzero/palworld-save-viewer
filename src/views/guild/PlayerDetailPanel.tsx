/**
 * One player, in depth.
 *
 * The interesting design problem here is what to do about the half of a
 * player's data that `Level.json` simply does not contain. Their inventory,
 * true position and paldex progress live in `Players/<uid>.sav`, which is a
 * separate file. Rendering an empty inventory would be a lie; hiding the
 * section would hide the fact that there is more to see. So the gap is shown
 * as an affordance — a drop target for exactly that file.
 */

import { useMemo, useRef, useState } from 'react'

import { ivTotal } from '../../domain/index.ts'
import { baseLabel } from '../../domain/bases.ts'
import { playerSummary } from '../../domain/guild.ts'
import { palName, palTooltip } from '../../domain/palText.ts'
import { formatMapPos, posToMap } from '../../domain/coords.ts'
import type { Guild, Player, SaveIndex } from '../../domain/types.ts'
import { count, relativeTime, ticksToDate } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useSaveStore } from '../../store/saveStore.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { IVBar, Panel, Pill } from '../../components/primitives.tsx'
import { CapacityNote, ContainerGrid } from '../bases/ContainerGrid.tsx'
import { PaldexGrid } from './Paldex.tsx'
import { buildPaldex } from './paldex.ts'

export function PlayerDetailPanel({
  index,
  player,
  guild,
  onClose,
}: {
  index: SaveIndex
  player: Player
  guild: Guild
  onClose: () => void
}) {
  const { data } = useRefdataStore()
  const summary = playerSummary(index, player, guild)
  const detail = index.playerDetails.find(
    (d) => d.playerUid === player.playerUid,
  )

  const bases = (index.basesByGuild.get(guild.groupId) ?? []).filter((b) =>
    (index.structuresByBase.get(b.baseId) ?? []).some(
      (s) => s.buildPlayerUid === player.playerUid,
    ),
  )

  // Their own build history, by structure type — a fingerprint of what this
  // player actually does in the world.
  const built = new Map<string, number>()
  for (const s of index.structures) {
    if (s.buildPlayerUid !== player.playerUid) continue
    built.set(s.mapObjectId, (built.get(s.mapObjectId) ?? 0) + 1)
  }

  const topPals = [...summary.pals]
    .sort((a, b) => ivTotal(b) - ivTotal(a))
    .slice(0, 12)

  // The panel's first piece of state. Everything above is derived, which is
  // why this stays local rather than joining the view's hash params: which tab
  // is open is not something worth sending anybody.
  const [tab, setTab] = useState<'overview' | 'paldex'>('overview')
  const paldex = useMemo(
    () => buildPaldex(index, data, detail?.record, player.playerUid),
    [index, data, detail, player.playerUid],
  )

  return (
    <aside className="w-96 shrink-0 overflow-y-auto border-l border-[var(--color-line)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-display text-xl leading-tight">
            {player.name}
          </div>
          <div className="label mt-1">
            level {player.level}
            {detail ? ` · ${detail.platform}` : ''}
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

      <div className="flex gap-1 border-b border-[var(--color-line)] px-4 pt-2">
        {(['overview', 'paldex'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'true' : undefined}
            onClick={() => setTab(id)}
            className={cn(
              'rounded-t-[4px] px-2.5 py-1 text-xs transition-colors',
              tab === id
                ? 'bg-[var(--color-raised)] text-[var(--color-text)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {id}
          </button>
        ))}
      </div>

      {tab === 'paldex' && (
        <div className="p-4">
          <PaldexGrid view={paldex} />
        </div>
      )}

      <div className={cn('space-y-6 p-4', tab !== 'overview' && 'hidden')}>
        <section>
          <Field label="pals owned" value={count(summary.pals.length)} />
          <Field label="structures built" value={count(summary.built)} />
          <Field
            label="position"
            value={formatMapPos(posToMap(detail?.pos ?? player.pos))}
            hint={detail ? 'from player save' : 'last jump point'}
          />
          {detail?.technologyPoints !== undefined && (
            <Field label="technology" value={count(detail.technologyPoints)} />
          )}
          {detail && (
            <Field
              label="paldex"
              value={`${detail.record.paldexUnlocked} unlocked`}
            />
          )}
          {detail?.lastOnlineTicks !== undefined && (
            <Field
              label="last online"
              value={relativeTime(ticksToDate(detail.lastOnlineTicks))}
            />
          )}
        </section>

        {bases.length > 0 && (
          <section>
            <div className="label mb-2">bases they built in</div>
            <ul className="space-y-1">
              {bases.map((b) => (
                <li key={b.baseId} className="text-xs">
                  {baseLabel(
                    b,
                    index.bases.findIndex((x) => x.baseId === b.baseId) + 1,
                    data?.landmarks,
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {built.size > 0 && (
          <section>
            {/* Uncapped. This was `.slice(0, 8)` with nothing saying so, which
                read as missing data rather than as a truncated list — the
                biggest builder in a real save has 38 distinct types. */}
            <div className="label mb-2">
              what they build — {count(built.size)} types,{' '}
              {count(summary.built)} placed
            </div>
            <Panel className="divide-y divide-[var(--color-line-faint)]">
              {[...built]
                .sort((a, b) => b[1] - a[1])
                .map(([id, n]) => (
                  <div
                    key={id}
                    className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs"
                  >
                    <span className="truncate">
                      {data?.structures[id.toLowerCase()]?.name ?? id}
                    </span>
                    <span className="num shrink-0 text-[var(--color-muted)]">
                      {count(n)}
                    </span>
                  </div>
                ))}
            </Panel>
          </section>
        )}

        {topPals.length > 0 && (
          <section>
            <div className="label mb-2">
              best pals{summary.pals.length > 12 ? ' — top 12 by IV' : ''}
            </div>
            <ul className="space-y-1.5">
              {topPals.map((pal) => {
                const info = data?.species[pal.characterId.toLowerCase()]
                return (
                  <li
                    key={pal.instanceId}
                    // The row shows a name, an IV bar and a level; everything
                    // else about the pal was previously a click away.
                    title={palTooltip(
                      pal,
                      info,
                      (a) => data?.passives[a.toLowerCase()],
                    )}
                    className="flex items-center gap-2"
                  >
                    <GameIcon
                      path={info?.icon}
                      name={pal.characterId}
                      elementName={info?.element1}
                      size={24}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {palName(pal, info)}
                    </span>
                    {pal.isBoss && <Pill tone="warn">alpha</Pill>}
                    <IVBar
                      hp={pal.ivHp}
                      attack={pal.ivAttack}
                      defense={pal.ivDefense}
                      width={40}
                    />
                    <span className="num w-8 shrink-0 text-right text-[10px] text-[var(--color-muted)]">
                      {pal.level}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <Inventory index={index} playerUid={player.playerUid} />
      </div>
    </aside>
  )
}

/**
 * Their carried items, or the reason there are none to show.
 */
function Inventory({
  index,
  playerUid,
}: {
  index: SaveIndex
  playerUid: string
}) {
  const detail = index.playerDetails.find((d) => d.playerUid === playerUid)

  if (!detail) return <InventoryPrompt playerUid={playerUid} />

  const slots = Object.entries(detail.inventory) as [string, string][]
  const containers = slots.flatMap(([slot, id]) => {
    const container = index.containerById.get(id)
    return container && container.slots.length > 0 ? [{ slot, container }] : []
  })

  if (containers.length === 0) {
    return (
      <section>
        <div className="label mb-2">inventory</div>
        <p className="text-xs text-[var(--color-muted)]">
          Their save loaded, and every container they carry is empty.
        </p>
      </section>
    )
  }

  return (
    <section>
      <div className="label mb-1">inventory</div>
      {/* Said once for the whole stack rather than under each grid. */}
      <CapacityNote className="mb-3" />
      <div className="space-y-4">
        {containers.map(({ slot, container }) => (
          <div
            key={container.containerId}
            className="overflow-hidden rounded-[10px] border border-[var(--color-line)]"
          >
            <ContainerGrid
              container={container}
              index={index}
              title={SLOT_NAMES[slot] ?? slot}
              note={false}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

const SLOT_NAMES: Record<string, string> = {
  main: 'Backpack',
  essential: 'Key items',
  weapon: 'Weapons',
  equip: 'Armour',
  food: 'Food belt',
  drop: 'Drop slot',
}

/**
 * The missing-player-save affordance.
 *
 * A file input rather than only a drop target: the drop zone on the empty
 * screen already accepts a whole folder, and someone who got this far wants
 * one specific file.
 */
function InventoryPrompt({ playerUid }: { playerUid: string }) {
  const acceptFiles = useSaveStore((s) => s.acceptFiles)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <section>
      <div className="label mb-2">inventory</div>
      <Panel className="px-4 py-3">
        <p className="text-xs leading-relaxed text-[var(--color-muted)]">
          This player’s inventory lives in{' '}
          <span className="num text-[var(--color-text)]">
            Players/{playerUid.slice(0, 8)}…sav
          </span>
          , which the level file does not contain. Add it to see what they are
          carrying, their true position and their paldex progress.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 w-full rounded-[6px] border border-[var(--color-line)] px-3 py-1.5 text-xs transition-colors hover:border-[var(--color-signal)]"
        >
          Add player saves
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".sav,.json,application/json"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files
            if (files) void acceptFiles(Array.from(files))
          }}
        />
      </Panel>
    </section>
  )
}

function Field({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line-faint)] py-1.5">
      <span className="label">{label}</span>
      <span className="num text-right text-sm">
        {value}
        {hint && <span className="label ml-2 normal-case">{hint}</span>}
      </span>
    </div>
  )
}
