import type { ReactNode } from 'react'

import { playerGuilds, speciesCounts, ivTotal } from '../domain/index.ts'
import type { PlayerDetail, SaveIndex } from '../domain/types.ts'
import { STATUS_LABELS, STATUS_ORDER } from '../domain/statusNames.ts'
import { palTooltip } from '../domain/palText.ts'
import {
  bytes,
  count,
  relativeTime,
  saveClock,
  ticksToDate,
} from '../lib/format.ts'
import { formatMapPos, posToMap } from '../domain/coords.ts'
import {
  formatUptimeAgo,
  lastSeenBasis,
  lastSeenFor,
} from '../domain/lastSeen.ts'
import { useSaveStore, type PlayerFileState } from '../store/saveStore.ts'
import { Button } from '../components/controls.tsx'
import { useFilePicker } from './filePicker.tsx'
import {
  ElementBadge,
  IVBar,
  MonogramTile,
  OnlineDot,
  Panel,
  PassiveChip,
  Pill,
  RawId,
  SectionHeading,
  StatTile,
  Table,
  type PillTone,
} from '../components/primitives.tsx'

/**
 * The diagnostics view: the full picture of what a save actually contains,
 * including the parts no other view surfaces — per-player progression, stat
 * allocation, parse timings and warnings.
 */
export function SaveSummary({ index }: { index: SaveIndex }) {
  const {
    fileName,
    fileBytes,
    timings,
    localData,
    levelMeta,
    restoredFrom,
    reset,
  } = useSaveStore()

  // The save's own record of when it was written, from `LevelMeta.sav`. Distinct
  // from `restoredFrom`, which is when *this browser* stored a snapshot, and from
  // the file's mtime, which the app never sees and which copying destroys.
  //
  // Rendered as a clock reading rather than as "3 hours ago" on purpose: the game
  // writes these ticks with no timezone, so the instant is unknowable and a
  // relative time would be wrong by the server's offset. See `saveClock`.
  const writtenAt = saveClock(levelMeta?.savedAtTicks)
  const guilds = playerGuilds(index)
  const s = index.stats
  const ownerName = localData?.ownerUid
    ? index.playerByUid.get(localData.ownerUid)?.name
    : undefined

  const detailByUid = new Map<string, PlayerDetail>(
    index.playerDetails.map((d) => [d.playerUid, d]),
  )
  const basis = lastSeenBasis(index.players, detailByUid)
  const totalMs = timings
    ? Object.values(timings).reduce((a, b) => a + b, 0)
    : undefined

  return (
    // Scrolls itself. The shell is a fixed-height flex column, so a view that
    // leaves scrolling to the document gets clipped at the fold instead.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-8">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
          <div>
            <h1 className="num text-2xl leading-none">{fileName ?? 'Save'}</h1>
            <p
              className="label mt-2"
              title={
                writtenAt
                  ? `The save's own clock reading. Palworld records no timezone, so this is the server's local time rather than a known instant.`
                  : undefined
              }
            >
              {[
                fileBytes ? bytes(fileBytes) : null,
                // Ahead of the parse timing, because when the world is *from* is a
                // more useful first fact than how long reading it took.
                writtenAt ? `written ${writtenAt}` : null,
                restoredFrom !== undefined
                  ? `restored · saved ${relativeTime(new Date(restoredFrom))}`
                  : totalMs
                    ? `parsed in ${totalMs.toFixed(0)} ms`
                    : null,
                index.meta.engineVersion,
                s.playerDetails > 0
                  ? `${s.playerDetails}/${s.playersInLevel} player saves`
                  : 'no player saves',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <Button onClick={reset}>Load another</Button>
        </header>

        {/* First, above the overview: what the numbers below are computed from
            determines how much to trust them. */}
        <FilesPanel index={index} />

        <section className="mb-10">
          <SectionHeading title="Overview" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="pals" value={s.pals} accent />
            <StatTile label="species" value={s.species} />
            <StatTile label="players" value={s.players} />
            <StatTile label="bases" value={s.bases} />
            <StatTile label="structures" value={s.structures} />
            <StatTile label="dungeons" value={s.dungeons} />
            <StatTile
              label="attributed exactly"
              value={s.attributedExact}
              hint={`of ${count(s.containers)} containers`}
            />
            <StatTile label="inferred" value={s.attributedInferred} />
            <StatTile
              label="unattributed"
              value={s.unattributedContainers}
              hint={s.playerDetails > 0 ? undefined : 'add player saves'}
            />
            <StatTile label="pal storage" value={s.charContainers} />
            <StatTile label="dynamic items" value={s.dynamicItems} />
            <StatTile label="guilds" value={s.guilds} />
            {levelMeta?.inGameDay !== undefined && (
              <StatTile
                label="in-game day"
                value={levelMeta.inGameDay}
                hint="from LevelMeta.sav"
              />
            )}
          </div>
        </section>

        {localData && (
          <section className="mb-10">
            <SectionHeading
              title={
                ownerName
                  ? `Client data — ${ownerName}`
                  : `Client data — ${localData.fileName}`
              }
              hint="from LocalData.sav — one client, not the server"
              action={
                ownerName ? undefined : (
                  <Pill
                    tone="neutral"
                    title="Whose client this is is inferred from the owners of the pals in its party presets. They did not agree, or none of them resolved."
                  >
                    owner unknown
                  </Pill>
                )
              }
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {localData.fog.map((f) => (
                <StatTile
                  key={f.map}
                  label={f.map === 'overworld' ? 'explored' : 'tree explored'}
                  value={`${(f.exploredFraction * 100).toFixed(1)}%`}
                  accent={f.map === 'overworld'}
                  hint={`${f.size}×${f.size} mask`}
                />
              ))}
              <StatTile
                label="paldeck seen"
                value={localData.paldeckEncountered}
              />
              <StatTile label="techs" value={localData.techsUnlocked} />
              <StatTile label="builds" value={localData.buildsUnlocked} />
              <StatTile
                label="hidden locations"
                value={localData.hiddenLocations}
              />
              <StatTile label="map pins" value={localData.markers.length} />
              <StatTile label="tutorials" value={localData.tutorialsSeen} />
            </div>

            {localData.trackingQuestId && (
              <p className="label mt-3">
                tracking <RawId>{localData.trackingQuestId}</RawId>
              </p>
            )}

            {localData.presets.length > 0 && (
              <div className="mt-6">
                <SectionHeading
                  title="Party presets"
                  hint="saved loadouts, resolved against the level save"
                />
                <Table
                  head={['preset', 'pals']}
                  rows={localData.presets.map((preset, i) => [
                    preset.name || `Preset ${i + 1}`,
                    preset.palIds
                      .map((id) => {
                        const pal = index.palById.get(id)
                        if (!pal) return '—'
                        return `${pal.nickname ?? pal.characterId} (Lv ${pal.level})`
                      })
                      .join(', ') || '—',
                  ])}
                  align={() => false}
                />
              </div>
            )}
          </section>
        )}

        {guilds.map((guild) => (
          <section key={guild.groupId} className="mb-10">
            <SectionHeading
              title={`Guild — ${guild.name}`}
              hint={`base camp level ${guild.baseCampLevel} · ${guild.members.length} members · ${count(guild.memberCount)} handles`}
              action={
                <Pill>
                  {basis === 'absolute' ? 'exact times' : 'uptime clock'}
                </Pill>
              }
            />
            <Table
              head={[
                'player',
                'role',
                'platform',
                'lvl',
                'pals',
                'caught',
                'paldex',
                'tech',
                'last seen',
                'position',
              ]}
              rows={guild.members.map((m) => {
                const player = index.playerByUid.get(m.playerUid)
                const detail = detailByUid.get(m.playerUid)
                const seen = player
                  ? lastSeenFor(player, detail, m, index.meta)
                  : undefined
                const pos = detail?.pos ?? player?.pos

                return [
                  <span className="flex items-center gap-2">
                    {seen?.onlineAtSave && <OnlineDot />}
                    {m.name}
                  </span>,
                  ROLE_NAMES[m.role ?? 4] ?? '—',
                  detail ? detail.platform : <RawId>—</RawId>,
                  player?.level ?? '—',
                  index.palsByOwner.get(m.playerUid)?.length ?? 0,
                  detail?.record.palsCaught ?? '—',
                  detail?.record.paldexUnlocked ?? '—',
                  detail?.technologyPoints ?? '—',
                  <LastSeenCell seen={seen} />,
                  pos ? formatMapPos(posToMap(pos)) : '—',
                ]
              })}
            />
          </section>
        ))}

        {index.playerDetails.length > 0 && (
          <section className="mb-10">
            <SectionHeading
              title="Progression"
              hint="from player saves — not present in Level.json"
            />
            <Table
              head={[
                'player',
                'caught',
                'species',
                'paldex',
                'bosses',
                'towers',
                'relics',
                'dungeons',
                'fish',
                'condensed',
                'crafted',
                'recipes',
              ]}
              rows={[...index.playerDetails]
                .sort((a, b) => b.record.palsCaught - a.record.palsCaught)
                .map((d) => {
                  const player = index.playerByUid.get(d.playerUid)
                  return [
                    player?.name ?? <RawId>{d.playerUid.slice(0, 8)}</RawId>,
                    d.record.palsCaught,
                    d.record.speciesCaught,
                    d.record.paldexUnlocked,
                    d.record.bossesDefeated,
                    d.record.towerBossesDefeated,
                    d.record.relicsFound ?? '—',
                    (d.record.normalDungeonsCleared ?? 0) +
                      (d.record.fixedDungeonsCleared ?? 0),
                    d.record.fishCaught,
                    d.record.palsCondensed,
                    count(d.record.itemsCrafted),
                    d.unlockedRecipes.length,
                  ]
                })}
            />
          </section>
        )}

        <section className="mb-10">
          <SectionHeading title="Players" hint="stat point allocation" />
          <Table
            head={[
              'name',
              'lvl',
              'hp',
              ...STATUS_ORDER.map((k) => STATUS_LABELS[k]),
            ]}
            rows={index.players.map((p) => [
              p.name,
              p.level,
              p.hp ? p.hp.toFixed(0) : '—',
              ...STATUS_ORDER.map((k) => p.statusPoints[k] ?? 0),
            ])}
          />
        </section>

        <section className="mb-10">
          <SectionHeading title="Bases" />
          <Table
            head={['position', 'radius', 'workers', 'structures', 'guild']}
            rows={index.bases.map((b) => [
              formatMapPos(posToMap(b.pos)),
              b.areaRange.toFixed(0),
              b.workerContainerId
                ? (index.palsByContainer.get(b.workerContainerId)?.length ?? 0)
                : 0,
              index.structuresByBase.get(b.baseId)?.length ?? 0,
              b.groupId ? (index.guildById.get(b.groupId)?.name ?? '—') : '—',
            ])}
            align={(i) => i !== 4}
          />
        </section>

        <section className="mb-10">
          <SectionHeading title="Most common species" />
          <Table
            head={['species', 'count', 'best IVs', 'best total', 'top level']}
            rows={speciesCounts(index)
              .slice(0, 12)
              .map(({ id, count: n }) => {
                const pals = index.palsByCharacterId.get(id) ?? []
                const best = pals.reduce((a, b) =>
                  ivTotal(b) > ivTotal(a) ? b : a,
                )
                return [
                  <span className="flex items-center gap-2">
                    <MonogramTile name={id} size={26} />
                    {id}
                  </span>,
                  n,
                  <IVBar
                    hp={best.ivHp}
                    attack={best.ivAttack}
                    defense={best.ivDefense}
                  />,
                  `${ivTotal(best)} / 300`,
                  Math.max(...pals.map((p) => p.level)),
                ]
              })}
          />
        </section>

        <section className="mb-10">
          <SectionHeading title="Best pals" hint="by IV total" />
          <Table
            head={['species', 'nickname', 'lvl', 'IVs', 'passives', 'caught']}
            rows={[...index.pals]
              .sort((a, b) => ivTotal(b) - ivTotal(a))
              .slice(0, 10)
              .map((p) => [
                // No refdata in this view by design — it reports what the save
                // says, raw ids and all. `palTooltip` degrades to exactly that.
                <span title={palTooltip(p)} className="flex items-center gap-2">
                  <MonogramTile name={p.characterId} size={26} />
                  {p.isBoss && <Pill tone="danger">alpha</Pill>}
                  {p.characterId}
                </span>,
                p.nickname ?? '—',
                p.level,
                <span className="flex items-center gap-2">
                  <IVBar
                    hp={p.ivHp}
                    attack={p.ivAttack}
                    defense={p.ivDefense}
                  />
                  <span className="text-[11px]">{ivTotal(p)}</span>
                </span>,
                <span className="flex flex-wrap gap-1">
                  {p.passives.length === 0
                    ? '—'
                    : p.passives.map((name) => (
                        <PassiveChip key={name} name={name} />
                      ))}
                </span>,
                relativeTime(ticksToDate(p.ownedTime)),
              ])}
          />
        </section>

        <section className="mb-10">
          <SectionHeading title="Diagnostics" />
          <Panel padded>
            {s.warnings.length === 0 ? (
              <p className="text-sm text-[var(--color-hp)]">
                No parse warnings — every cross-reference in this save resolved.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {s.warnings.map((w) => (
                  <li key={w.kind + w.detail}>
                    <span className="num text-[var(--color-gold)]">
                      {w.count}×
                    </span>{' '}
                    {w.detail} <RawId>{w.kind}</RawId>
                  </li>
                ))}
              </ul>
            )}

            {/* The ingestion ledger used to be repeated here. It is the Files
              panel's now: that panel exists to answer "what did this session
              actually read", and saying it twice on one screen invited the two
              copies to disagree. */}

            {/* A restored session has no per-phase breakdown because no phase
              ever ran. Losing the line silently would look like a bug in the
              section rather than an honest absence. */}
            {restoredFrom !== undefined ? (
              <p className="label mt-4">
                restored from this browser · saved{' '}
                {relativeTime(new Date(restoredFrom))} · no parse timings
              </p>
            ) : (
              timings && (
                <p className="label mt-4">
                  {Object.entries(timings)
                    .map(([k, v]) => `${k} ${v.toFixed(0)}ms`)
                    .join(' · ')}
                </p>
              )
            )}
          </Panel>
        </section>
      </div>
    </div>
  )
}

/**
 * What a save is made of, and which parts this session has.
 *
 * A row per *slot* rather than a list of files, because the question people
 * arrive at this panel with is "what am I missing?" — and a list of filenames
 * only answers that if you already know what the complete set looks like. The
 * filenames are still here, underneath, where they answer the other question:
 * "I dropped that, why did nothing happen?"
 */
function FilesPanel({ index }: { index: SaveIndex }) {
  const { fileName, fileBytes, playerFiles, localData, levelMeta } =
    useSaveStore()
  const s = index.stats
  const writtenAt = saveClock(levelMeta?.savedAtTicks)
  const ownerName = localData?.ownerUid
    ? index.playerByUid.get(localData.ownerUid)?.name
    : undefined
  const overworld = localData?.fog.find((f) => f.map === 'overworld')

  // Rejections first: they are the only rows that need somebody to do something.
  const ledger = Object.values(playerFiles).sort(
    (a, b) => LEDGER_ORDER[a.status] - LEDGER_ORDER[b.status],
  )

  return (
    <section className="mb-10">
      <SectionHeading
        title="Files"
        hint="only the level is required — everything else can be added at any time, in any order"
      />
      <Panel>
        <div className="divide-y divide-[var(--color-line-faint)]">
          <FileSlot
            label="level"
            hint="The world itself: pals, players, bases, guilds, containers."
            loaded
            detail={[fileName, fileBytes ? bytes(fileBytes) : undefined]
              .filter(Boolean)
              .join(' · ')}
            action={
              <AddButton title="Reads a different world. Nothing is written or destroyed.">
                Replace
              </AddButton>
            }
          />

          <FileSlot
            label="world metadata"
            hint="LevelMeta.sav — when the save was written, and the in-game day."
            loaded={levelMeta !== undefined}
            detail={
              levelMeta
                ? [
                    writtenAt ? `written ${writtenAt}` : undefined,
                    levelMeta.inGameDay !== undefined
                      ? `day ${levelMeta.inGameDay}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'no clock reading, no in-game day'
            }
            action={<AddButton>Add</AddButton>}
          />

          <FileSlot
            label="player saves"
            hint="Players/<uid>.sav — exact inventories, true positions and paldex progress, none of which the level file contains."
            loaded={s.playerDetails > 0}
            partial={s.playerDetails > 0 && s.playerDetails < s.playersInLevel}
            detail={`${s.playerDetails} of ${s.playersInLevel}`}
            /*
             * The consequence, not just the count. This used to be its own panel
             * above the overview; it says the same thing as this row's `0 of 4`
             * and belongs to it.
             */
            note={missingPlayerNote(s)}
            action={
              <>
                <AddButton>Add files</AddButton>
                <AddButton directory title="Pick the whole Players folder">
                  Add folder
                </AddButton>
              </>
            }
          />

          <FileSlot
            label="client data"
            hint="LocalData.sav — fog of war, map pins and unlocks. One player's own client, not the server."
            loaded={localData !== undefined}
            detail={
              localData
                ? [
                    ownerName ?? 'owner unknown',
                    overworld
                      ? `${(overworld.exploredFraction * 100).toFixed(1)}% explored`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'no fog of war on the Map'
            }
            action={<AddButton>Add</AddButton>}
          />
        </div>
      </Panel>

      {ledger.length > 0 && (
        <div className="mt-4">
          <div className="label mb-2">files seen this session</div>
          {/*
            The reason goes on its own line rather than beside the name. On one
            line a long refusal squeezed both of the things that identify the row:
            the pill rendered as `REJECT…` and the filename as `stranger.j…`,
            which is the one word in the row that has to survive.
          */}
          <ul className="grid gap-2 text-xs sm:grid-cols-2">
            {ledger.map((f) => (
              <li key={f.fileName} className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0">
                    <Pill tone={LEDGER_TONES[f.status]}>
                      {/* A file can load and still be worth a second look —
                          metadata older than the world it was dropped on. */}
                      {f.status === 'loaded' && f.reason ? 'flagged' : f.status}
                    </Pill>
                  </span>
                  <span className="num min-w-0 truncate">{f.fileName}</span>
                </div>
                {f.reason && (
                  <p className="mt-1 text-[var(--color-muted)]">{f.reason}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * What is still missing from the `Players/` folder, and what its absence costs.
 *
 * Two clauses, either of which can drop out. With every player save loaded there
 * is nothing to say at all; with *some* loaded, the unattributed-container count
 * can already have reached zero while a player is still missing — which is the
 * case that read "Without them, 0 containers stay unattributed" the first time
 * this was driven with one of the fixture's two players.
 */
function missingPlayerNote(s: SaveIndex['stats']): string | undefined {
  if (s.playerDetails >= s.playersInLevel) return undefined

  const n = s.unattributedContainers
  const containers =
    n > 0
      ? `${count(n)} container${n === 1 ? '' : 's'} stay${n === 1 ? 's' : ''} unattributed, and `
      : ''
  return `Until they are all here, ${containers}last-seen falls back to the server-uptime clock for whoever is missing.`
}

const LEDGER_ORDER: Record<PlayerFileState['status'], number> = {
  rejected: 0,
  queued: 1,
  parsing: 2,
  loaded: 3,
}

const LEDGER_TONES: Record<PlayerFileState['status'], PillTone> = {
  rejected: 'danger',
  queued: 'neutral',
  parsing: 'neutral',
  loaded: 'good',
}

function FileSlot({
  label,
  hint,
  loaded,
  /** Loaded, but not all of it — some player saves present, not all. */
  partial = false,
  detail,
  note,
  action,
}: {
  label: string
  hint: string
  loaded: boolean
  partial?: boolean
  detail: ReactNode
  note?: ReactNode
  action: ReactNode
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm">{label}</span>
        <Pill tone={partial ? 'warn' : loaded ? 'good' : 'neutral'}>
          {partial ? 'partial' : loaded ? 'loaded' : 'not loaded'}
        </Pill>
        <span className="num min-w-0 truncate text-xs text-[var(--color-muted)]">
          {detail}
        </span>
        <span className="ml-auto flex shrink-0 gap-2">{action}</span>
      </div>
      <p className="mt-1.5 text-xs text-[var(--color-muted)]">{hint}</p>
      {note && (
        <p className="mt-1.5 text-xs text-[var(--color-gold)]">{note}</p>
      )}
    </div>
  )
}

/**
 * An "Add" button that owns its own hidden input.
 *
 * One per row rather than one shared picker driven by a "which slot?" state: the
 * store classifies every file by content anyway — `useFilePicker` says why — so
 * a per-slot picker is purely about putting the button where the gap is. Nothing
 * routes on which one was clicked, and `directory` only widens what the dialog
 * will let you select.
 */
function AddButton({
  children,
  directory = false,
  title,
}: {
  children: ReactNode
  directory?: boolean
  title?: string
}) {
  const picker = useFilePicker({ directory })

  return (
    <>
      <Button size="sm" onClick={picker.open} title={title}>
        {children}
      </Button>
      {picker.input}
    </>
  )
}

function LastSeenCell({
  seen,
}: {
  seen: ReturnType<typeof lastSeenFor> | undefined
}) {
  if (!seen) return <>—</>
  if (seen.onlineAtSave) {
    return <span className="text-[var(--color-hp)]">online at save</span>
  }
  if (seen.source === 'player-save') {
    return <span title={seen.at?.toISOString()}>{relativeTime(seen.at)}</span>
  }
  if (seen.source === 'guild-uptime') {
    // Never a date — this clock stops while the server is down, and
    // reconstructing one was measured 52 hours out.
    return (
      <span
        className="text-[var(--color-muted)]"
        title="Server-uptime clock — cannot be converted to a real date. Load this player's save for an exact time."
      >
        {formatUptimeAgo(seen.uptimeTicksAgo)}
      </span>
    )
  }
  return <>—</>
}

const ROLE_NAMES: Record<number, string> = {
  1: 'master',
  2: 'officer',
  3: 'member',
  4: '—',
}

/** Kept for the element pip's import to stay meaningful in future views. */
export { ElementBadge }
