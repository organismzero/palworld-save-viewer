import { useEffect, useMemo, useState } from 'react'

import {
  elementDistribution,
  guildTotals,
  levelHistogram,
  levelProgress,
  passiveFrequency,
  playerSummary,
  workCoverage,
  type PlayerSummary,
} from '../../domain/guild.ts'
import {
  playerGuilds,
  speciesCounts,
  systemGroups,
} from '../../domain/index.ts'
import { formatMapPos, posToMap } from '../../domain/coords.ts'
import { formatUptimeAgo, lastSeenFor } from '../../domain/lastSeen.ts'
import { STATUS_LABELS, STATUS_ORDER } from '../../domain/statusNames.ts'
import type { Guild, Player, SaveIndex } from '../../domain/types.ts'
import { WORK_TYPES } from '../../lib/color.ts'
import { count, relativeTime } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import {
  BarList,
  CountUp,
  Donut,
  Histogram,
  Radar,
  Ring,
} from '../../components/charts.tsx'
import {
  OnlineDot,
  Panel,
  PassiveChip,
  Pill,
  SectionHeading,
  type PillTone,
} from '../../components/primitives.tsx'
import { PlayerDetailPanel } from './PlayerDetailPanel.tsx'

/**
 * Guild and player dashboard.
 *
 * A real save carries one player guild and seven empty `Organization`
 * bookkeeping groups. Rendering all eight would make the app look broken, so
 * the organizations sit behind a toggle — the same call the domain layer
 * already makes in `playerGuilds`/`systemGroups`.
 */
export function GuildView({ index }: { index: SaveIndex }) {
  const { data, ensure } = useRefdataStore()

  useEffect(() => {
    void ensure()
  }, [ensure])

  const guilds = playerGuilds(index)
  const groups = systemGroups(index)
  const [showGroups, setShowGroups] = useState(false)
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => guilds[0]?.groupId,
  )
  // A jump from the command palette opens that player's detail panel, read
  // during the first render so the panel is there on first paint and cleared
  // afterwards. See the note in BasesView.
  const focus = useUiStore((s) => s.focus)
  const clearFocus = useUiStore((s) => s.clearFocus)
  useEffect(clearFocus, [clearFocus])

  const [openPlayer, setOpenPlayer] = useState<Player | undefined>(() =>
    focus?.kind === 'player' ? index.playerByUid.get(focus.id) : undefined,
  )

  const shown = showGroups ? [...guilds, ...groups] : guilds
  const guild = shown.find((g) => g.groupId === selectedId) ?? shown[0]

  if (!guild) {
    return (
      <div className="flex h-[calc(100dvh-3.25rem)] items-center justify-center p-8">
        <p className="text-sm text-[var(--color-muted)]">
          This save contains no guilds.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-3.25rem)]">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-8">
          <GuildHero
            index={index}
            guild={guild}
            guilds={shown}
            onSelect={setSelectedId}
            showGroups={showGroups}
            onShowGroups={setShowGroups}
            hasGroups={groups.length > 0}
          />

          <Players
            index={index}
            guild={guild}
            selected={openPlayer}
            onSelect={setOpenPlayer}
          />

          <Aggregates index={index} guild={guild} />

          <p className="label mt-10">
            {data
              ? 'names, elements and work suitability from reference data'
              : 'reference data unavailable — showing raw asset ids'}
          </p>
        </div>
      </div>

      {openPlayer && (
        <PlayerDetailPanel
          index={index}
          player={openPlayer}
          guild={guild}
          onClose={() => setOpenPlayer(undefined)}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------
   Hero
   ------------------------------------------------------------------------- */

function GuildHero({
  index,
  guild,
  guilds,
  onSelect,
  showGroups,
  onShowGroups,
  hasGroups,
}: {
  index: SaveIndex
  guild: Guild
  guilds: Guild[]
  onSelect: (id: string) => void
  showGroups: boolean
  onShowGroups: (v: boolean) => void
  hasGroups: boolean
}) {
  const totals = guildTotals(index, guild)
  const s = index.stats

  return (
    <header className="mb-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-3xl tracking-tight">
            {guild.name || 'Unnamed guild'}
          </h1>
          <p className="label mt-2">
            {[
              guild.type === 'Guild' ? 'guild' : 'system group',
              `${totals.players.length} members`,
              // Not a member count, despite the field name — it counts every
              // pal handle the guild holds as well.
              `${count(totals.handles)} character handles`,
              guild.hasV2Tail ? 'v2 record' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {guilds.length > 1 && (
            <select
              value={guild.groupId}
              onChange={(e) => onSelect(e.target.value)}
              className="rounded-[6px] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-signal)]"
            >
              {guilds.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.name || 'Unnamed'} ({g.members.length})
                </option>
              ))}
            </select>
          )}
          {hasGroups && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={showGroups}
                onChange={(e) => onShowGroups(e.target.checked)}
                className="accent-[var(--color-signal)]"
              />
              show system groups
            </label>
          )}
        </div>
      </div>

      <Panel className="flex flex-wrap items-center gap-8 px-6 py-5">
        {/*
          The ring shows how much of this dashboard is exact, not the camp
          level — the camp level has no known maximum, and a progress ring
          against an invented one would be decoration pretending to be data.
        */}
        <Ring
          value={s.playerDetails}
          max={s.playersInLevel}
          label={`${s.playerDetails}/${s.playersInLevel}`}
          sub="exact"
        />
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Metric label="camp level" value={guild.baseCampLevel} delay={0} />
          <Metric label="members" value={totals.players.length} delay={40} />
          <Metric label="pals" value={totals.pals.length} delay={80} accent />
          <Metric label="structures" value={totals.structures} delay={120} />
          <Metric label="bases" value={totals.bases} delay={160} />
        </dl>
      </Panel>

      <MemberStrip index={index} guild={guild} />
      <Markers guild={guild} />
    </header>
  )
}

function Metric({
  label,
  value,
  delay,
  accent,
}: {
  label: string
  value: number
  delay: number
  accent?: boolean
}) {
  return (
    <div>
      <dd
        className={cn(
          'num text-2xl leading-none',
          accent && 'text-[var(--color-signal)]',
        )}
      >
        <CountUp value={value} delay={delay} />
      </dd>
      <dt className="label mt-1.5">{label}</dt>
    </div>
  )
}

/**
 * Guild roles, and how each one looks.
 *
 * One table because the two places that showed a role had drifted apart: the
 * player cards hard-coded "master" for the admin and rendered a pill only for
 * roles below 3 — so members and unassigned players showed nothing at all —
 * while the member strip coloured only the admin and ignored `role === 1`
 * entirely. Now both read from here.
 *
 * `signal` is normally reserved for UI chrome rather than data, and the master
 * is the deliberate exception: there is exactly one per guild, and it is the
 * one role worth spending the accent colour on.
 */
const ROLES: Record<number, { name: string; tone: PillTone; hint: string }> = {
  1: {
    name: 'master',
    tone: 'signal',
    hint: 'Guild master — founded or inherited the guild, and can disband it.',
  },
  2: {
    name: 'officer',
    tone: 'warn',
    hint: 'Officer — elevated permissions over the guild and its bases.',
  },
  3: { name: 'member', tone: 'neutral', hint: 'Member of the guild.' },
  4: {
    name: 'unassigned',
    tone: 'neutral',
    hint: 'No role recorded for this player in the guild data.',
  },
}

const roleOf = (role: number | undefined) => ROLES[role ?? 4] ?? ROLES[4]!

/** The same four tones as `Pill`, as a ring for the member avatars. */
const RING_TONES: Record<PillTone, string> = {
  signal: 'border-[var(--color-signal)] text-[var(--color-signal)]',
  warn: 'border-[oklch(0.80_0.15_85)]/70 text-[oklch(0.85_0.14_85)]',
  good: 'border-[oklch(0.78_0.16_150)]/70 text-[oklch(0.78_0.16_150)]',
  neutral: 'border-[var(--color-line)] text-[var(--color-muted)]',
}

function MemberStrip({ index, guild }: { index: SaveIndex; guild: Guild }) {
  if (guild.members.length === 0) return null
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {guild.members.map((m) => {
        const player = index.playerByUid.get(m.playerUid)
        // The admin flag and the role field are separate records and can
        // disagree; treat either as master so the strip and the cards agree.
        const role =
          guild.adminPlayerUid === m.playerUid ? ROLES[1]! : roleOf(m.role)
        return (
          <span
            key={m.playerUid}
            title={`${m.name} · ${role.name}${
              player ? ` · level ${player.level}` : ''
            }`}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full border font-mono text-[10px] uppercase',
              RING_TONES[role.tone],
            )}
          >
            {m.name.slice(0, 2)}
          </span>
        )
      })}
    </div>
  )
}

/**
 * Guild map markers.
 *
 * `icon` is a small integer with no lookup table anywhere in the reference
 * data, so it is shown as a raw index rather than guessed at — these are the
 * pins players drop on their own map, and the position is the useful part.
 */
function Markers({ guild }: { guild: Guild }) {
  if (guild.markers.length === 0) return null
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="label">map markers</span>
      {guild.markers.map((m) => (
        <span
          key={m.markerId}
          className="num rounded-[4px] border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)]"
        >
          #{m.icon} · {formatMapPos(posToMap(m.pos))}
        </span>
      ))}
      {/*
        `setView`, not `location.hash = …`. The hash is a mirror of the store
        (see `useHashSync`), and a second writer racing it breaks the moment
        the hash carries more than a view id.

        Labelled "Open map" rather than "View on map" because that is all it
        can do: it sits outside the `markers.map()` above, so it is one button
        for N markers and has no marker to centre on. Centring wants a
        positional member on the `Focus` union — worth doing, but alongside map
        deep links rather than here.
      */}
      <button
        type="button"
        onClick={() => useUiStore.getState().setView('map')}
        className="rounded-[6px] border border-[var(--color-line)] px-2.5 py-1 text-xs transition-colors hover:border-[var(--color-signal)]"
      >
        Open map
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Players
   ------------------------------------------------------------------------- */

function Players({
  index,
  guild,
  selected,
  onSelect,
}: {
  index: SaveIndex
  guild: Guild
  selected?: Player
  onSelect: (p: Player) => void
}) {
  const members = useMemo(() => {
    const byUid = new Map(index.players.map((p) => [p.playerUid, p]))
    // Driven off the guild's own member list so someone who appears there but
    // has no character record still shows up, rather than silently vanishing.
    const out: { uid: string; name: string; player?: Player }[] = []
    for (const m of guild.members) {
      out.push({
        uid: m.playerUid,
        name: m.name,
        player: byUid.get(m.playerUid),
      })
    }
    if (out.length === 0) {
      for (const p of index.playersByGuild.get(guild.groupId) ?? []) {
        out.push({ uid: p.playerUid, name: p.name, player: p })
      }
    }
    return out.sort((a, b) => (b.player?.level ?? 0) - (a.player?.level ?? 0))
  }, [index, guild])

  if (members.length === 0) return null

  return (
    <section className="mb-10">
      <SectionHeading
        title="Players"
        hint={`${members.length} in ${guild.name || 'this guild'}`}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) =>
          m.player ? (
            <PlayerCard
              key={m.uid}
              index={index}
              guild={guild}
              summary={playerSummary(index, m.player, guild)}
              selected={selected?.playerUid === m.uid}
              onSelect={() => onSelect(m.player!)}
            />
          ) : (
            <Panel key={m.uid} className="px-4 py-3">
              <div className="text-sm">{m.name}</div>
              <p className="label mt-2">
                in the guild record, but no character in this save
              </p>
            </Panel>
          ),
        )}
      </div>
    </section>
  )
}

function PlayerCard({
  index,
  guild,
  summary,
  selected,
  onSelect,
}: {
  index: SaveIndex
  guild: Guild
  summary: PlayerSummary
  selected: boolean
  onSelect: () => void
}) {
  const { data } = useRefdataStore()
  const { player } = summary
  const role = summary.isAdmin ? ROLES[1]! : roleOf(summary.role)

  const detail = index.playerDetails.find(
    (d) => d.playerUid === player.playerUid,
  )
  const member = guild.members.find((m) => m.playerUid === player.playerUid)
  const seen = lastSeenFor(player, detail, member, index.meta)
  const progress = levelProgress(player.level, player.exp, data?.expTable)
  const pos = detail?.pos ?? player.pos

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'raised-edge rounded-[10px] border bg-[var(--color-surface)] p-4 text-left transition-colors',
        selected
          ? 'border-[var(--color-signal)]/60'
          : 'border-[var(--color-line)]/60 hover:border-[var(--color-signal)]/40',
      )}
    >
      <div className="flex items-baseline gap-2">
        {seen.onlineAtSave && <OnlineDot />}
        <span className="truncate text-sm">{player.name}</span>
        {/* Every player gets a role pill now. Showing one only for master and
            officer left members looking like their role failed to load. */}
        <Pill tone={role.tone} title={role.hint}>
          {role.name}
        </Pill>
        <span className="num ml-auto shrink-0 text-sm">{player.level}</span>
      </div>

      {/* An XP bar only when the levelling curve gives it a real denominator. */}
      {progress !== undefined ? (
        <div
          className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-line)]/60"
          title={`${Math.round(progress * 100)}% to level ${player.level + 1}`}
        >
          <div
            className="h-full rounded-full bg-[var(--color-signal)]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      ) : (
        <div className="num mt-2 text-[10px] text-[var(--color-muted)]">
          {count(player.exp)} xp
        </div>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Fact label="pals" value={count(summary.pals.length)} />
        <Fact label="built" value={count(summary.built)} />
        <Fact label="hp" value={player.hp ? player.hp.toFixed(0) : '—'} />
      </dl>

      <div className="mt-3 space-y-1">
        {STATUS_ORDER.filter((k) => (player.statusPoints[k] ?? 0) > 0).map(
          (k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[10px] text-[var(--color-muted)]">
                {STATUS_LABELS[k]}
              </span>
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--color-line)]/60">
                <span
                  className="block h-full rounded-full bg-[var(--color-signal)]/70"
                  style={{
                    // Points are unbounded in principle; 20 is a readable
                    // full-bar reference for a real save's spread.
                    width: `${Math.min(100, ((player.statusPoints[k] ?? 0) / 20) * 100)}%`,
                  }}
                />
              </span>
              <span className="num w-4 shrink-0 text-right text-[10px]">
                {player.statusPoints[k]}
              </span>
            </div>
          ),
        )}
      </div>

      <div className="label mt-3 flex items-baseline justify-between gap-2">
        <span className="truncate">
          {pos ? formatMapPos(posToMap(pos)) : 'position unknown'}
        </span>
        <span className="shrink-0 normal-case">
          <LastSeen seen={seen} />
        </span>
      </div>
    </button>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="num text-sm">{value}</dd>
      <dt className="label text-[9px]">{label}</dt>
    </div>
  )
}

function LastSeen({ seen }: { seen: ReturnType<typeof lastSeenFor> }) {
  if (seen.onlineAtSave) {
    return <span className="text-[oklch(0.78_0.16_150)]">online at save</span>
  }
  if (seen.source === 'player-save') return <>{relativeTime(seen.at)}</>
  if (seen.source === 'guild-uptime') {
    return (
      <span title="Server-uptime clock — not convertible to a real date.">
        {formatUptimeAgo(seen.uptimeTicksAgo)}
      </span>
    )
  }
  return <>—</>
}

/* -------------------------------------------------------------------------
   Aggregates
   ------------------------------------------------------------------------- */

/** Shared empty roster, so a guild with no pals keeps a stable identity. */
const EMPTY: never[] = []

function Aggregates({ index, guild }: { index: SaveIndex; guild: Guild }) {
  const { data } = useRefdataStore()

  // `?? []` inline would mint a new array on every render and invalidate every
  // aggregate below it — for a 1,098-pal roster that is five recomputations
  // per keystroke elsewhere on the page.
  const pals = useMemo(
    () => index.palsByGuild.get(guild.groupId) ?? EMPTY,
    [index, guild],
  )

  const species = (id: string) => data?.species[id.toLowerCase()]

  const bins = useMemo(() => levelHistogram(pals), [pals])
  const slices = useMemo(
    () => elementDistribution(pals, (id) => data?.species[id.toLowerCase()]),
    [pals, data],
  )
  const work = useMemo(
    () =>
      workCoverage(
        pals,
        (id) => data?.species[id.toLowerCase()],
        data?.work ?? WORK_TYPES,
      ),
    [pals, data],
  )
  const passives = useMemo(
    () => passiveFrequency(pals, (a) => data?.passives[a.toLowerCase()]),
    [pals, data],
  )

  const topSpecies = useMemo(
    () =>
      speciesCounts(index)
        .filter(({ id }) =>
          (index.palsByCharacterId.get(id) ?? []).some(
            (p) => p.groupId === guild.groupId,
          ),
        )
        .slice(0, 10),
    [index, guild],
  )

  if (pals.length === 0) return null

  const weakest = [...work].sort((a, b) => a.levels - b.levels)[0]

  return (
    <section className="mb-10">
      <SectionHeading title="Roster" hint={`${count(pals.length)} pals`} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="label mb-3">level distribution</div>
          <Histogram bins={bins} />
        </Panel>

        <Panel className="p-5">
          <div className="label mb-3">elements</div>
          <Donut slices={slices} />
        </Panel>

        <Panel className="p-5">
          <div className="label mb-3">most common species</div>
          <BarList
            rows={topSpecies.map(({ id, count: n }) => ({
              key: id,
              label: species(id)?.name ?? id,
              value: n,
            }))}
          />
        </Panel>

        <Panel className="p-5">
          <div className="label mb-1">work suitability coverage</div>
          <p className="mb-2 text-xs text-[var(--color-muted)]">
            {weakest && weakest.levels === 0
              ? `No pal in this guild can do ${weakest.display}.`
              : weakest
                ? `Weakest on ${weakest.display} — ${count(weakest.pals)} pals.`
                : ''}
          </p>
          <div className="px-8 py-4">
            <Radar
              size={220}
              axes={work.map((w) => ({ label: w.display, value: w.levels }))}
            />
          </div>
        </Panel>

        <Panel className="p-5 lg:col-span-2">
          <div className="label mb-3">most common passives</div>
          <div className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {passives.map((p) => (
              <div key={p.asset} className="flex items-center gap-2">
                <PassiveChip name={p.name} rank={p.rank} />
                <span className="num ml-auto text-xs text-[var(--color-muted)]">
                  {count(p.count)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  )
}
