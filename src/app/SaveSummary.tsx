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
import { useSaveStore } from '../store/saveStore.ts'
import { Button } from '../components/controls.tsx'
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
    playerFiles,
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
  const ledger = Object.values(playerFiles)

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

        {s.playerDetails < s.playersInLevel && (
          <Panel padded className="mb-10">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Pill tone="warn">partial</Pill>
              <span className="text-sm">
                {s.playersInLevel - s.playerDetails} player save
                {s.playersInLevel - s.playerDetails === 1 ? '' : 's'} missing.
              </span>
              <span className="text-sm text-[var(--color-muted)]">
                Drop your <span className="num">Players</span> folder for exact
                inventories, true positions and paldex progress. Without them,{' '}
                {count(s.unattributedContainers)} containers stay unattributed
                and last-seen falls back to the server-uptime clock.
              </span>
            </div>
          </Panel>
        )}

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
                  {p.isBoss && <Pill tone="warn">alpha</Pill>}
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

            {ledger.length > 0 && (
              <div className="mt-4 border-t border-[var(--color-line-faint)] pt-3">
                <div className="label mb-2">player saves</div>
                <ul className="grid gap-1 text-xs sm:grid-cols-2">
                  {ledger.map((f) => (
                    <li key={f.fileName} className="flex items-center gap-2">
                      <Pill
                        tone={
                          f.status === 'loaded'
                            ? 'good'
                            : f.status === 'rejected'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {f.status}
                      </Pill>
                      <span className="num truncate">{f.fileName}</span>
                      {f.reason && (
                        <span className="text-[var(--color-muted)]">
                          {f.reason}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
