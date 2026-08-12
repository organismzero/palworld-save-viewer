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

import { useMemo, useState } from 'react'

import { ivTotal } from '../../domain/index.ts'
import { baseLabel } from '../../domain/bases.ts'
import { playerSummary } from '../../domain/guild.ts'
import { palName, palTooltip } from '../../domain/palText.ts'
import { formatMapPos, posToMap } from '../../domain/coords.ts'
import type { Guild, Player, SaveIndex } from '../../domain/types.ts'
import { count, relativeTime, ticksToDate } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useFilePicker } from '../../app/filePicker.tsx'
import { GameIcon } from '../../components/GameIcon.tsx'
import { Field, IVBar, Panel, Pill } from '../../components/primitives.tsx'
import { Button, IconButton, SegmentBar } from '../../components/controls.tsx'
import { tabId } from '../../lib/utils.ts'
import { CapacityNote, ContainerGrid } from '../bases/ContainerGrid.tsx'
import { PaldexGrid } from './Paldex.tsx'
import { buildPaldex } from './paldex.ts'

/** Ties the tab pair to the panel it drives, for `aria-controls`. */
const PLAYER_TABS = 'player'
const PLAYER_PANEL = 'player-panel'

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
    <aside className="w-[var(--detail-width)] shrink-0 overflow-y-auto border-l border-[var(--color-line)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-xl leading-tight">{player.name}</div>
          <div className="label mt-1.5">
            level {player.level}
            {detail ? ` · ${detail.platform}` : ''}
          </div>
        </div>
        <IconButton label="Close" tone="ghost" size={24} onClick={onClose}>
          ×
        </IconButton>
      </div>

      {/* A genuine tab pair, so it gets genuine tab semantics: the panel below
          points back at whichever of the two is selected. */}
      <SegmentBar
        name={PLAYER_TABS}
        panelId={PLAYER_PANEL}
        value={tab}
        onChange={(id) => setTab(id as 'overview' | 'paldex')}
        className="border-b border-[var(--color-line)] p-2"
        tabs={[
          { id: 'overview', label: 'overview' },
          { id: 'paldex', label: 'paldex' },
        ]}
      />

      <div
        id={PLAYER_PANEL}
        role="tabpanel"
        aria-labelledby={tabId(PLAYER_TABS, tab)}
      >
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
              value={
                <>
                  {formatMapPos(posToMap(detail?.pos ?? player.pos))}
                  <span className="label ml-2 normal-case">
                    {detail ? 'from player save' : 'last jump point'}
                  </span>
                </>
              }
            />
            {detail?.technologyPoints !== undefined && (
              <Field
                label="technology"
                value={count(detail.technologyPoints)}
              />
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
                      {pal.isBoss && <Pill tone="danger">alpha</Pill>}
                      <IVBar
                        hp={pal.ivHp}
                        attack={pal.ivAttack}
                        defense={pal.ivDefense}
                        width={40}
                      />
                      <span className="num w-8 shrink-0 text-right text-[11px] text-[var(--color-muted)]">
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
          <Panel key={container.containerId} className="overflow-hidden">
            <ContainerGrid
              container={container}
              index={index}
              title={SLOT_NAMES[slot] ?? slot}
              note={false}
            />
          </Panel>
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
  const picker = useFilePicker()

  return (
    <section>
      <div className="label mb-2">inventory</div>
      <Panel padded>
        <p className="text-xs leading-relaxed text-[var(--color-muted)]">
          This player’s inventory lives in{' '}
          <span className="num text-[var(--color-text)]">
            Players/{playerUid.slice(0, 8)}…sav
          </span>
          , which the level file does not contain. Add it to see what they are
          carrying, their true position and their paldex progress.
        </p>
        <Button size="sm" onClick={picker.open} className="mt-3 w-full">
          Add player saves
        </Button>
        {picker.input}
      </Panel>
    </section>
  )
}
