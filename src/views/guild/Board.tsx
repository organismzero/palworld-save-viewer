/**
 * The contribution board: every member of the guild in one sortable table.
 *
 * The player cards above it answer "who is this". This answers the question a
 * guild master actually has about ten people at once: who has stopped turning
 * up, and what did they leave standing. So it opens ordered by absence, longest
 * first, and the columns beside it are what each member built, holds and did.
 *
 * Everything right of "pals" is from a member's own player save. Without it the
 * cell is a dash, not a zero: the app does not know, which is a different thing
 * from knowing it is none.
 */

import { useMemo } from 'react'

import { contributions } from '../../domain/guild.ts'
import { formatUptimeAgo } from '../../domain/lastSeen.ts'
import type { Guild, Player, SaveIndex } from '../../domain/types.ts'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
import {
  OnlineDot,
  SectionHeading,
  Table,
} from '../../components/primitives.tsx'
import { count } from '../../lib/format.ts'
import { memberRole } from '../../lib/roles.ts'
import type { SortKey } from '../../lib/sortRows.ts'

const HEAD = [
  'member',
  'role',
  'level',
  'last seen',
  'built',
  'pals',
  'caught',
  'species',
  'bosses',
  'towers',
  'dungeons',
  'fish',
  'condensed',
  'crafted',
]

/** The column the board opens sorted by. */
const LAST_SEEN = HEAD.indexOf('last seen')

export function ContributionBoard({
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
  const members = useMemo(() => contributions(index, guild), [index, guild])
  if (members.length === 0) return null

  const missing = members.filter((m) => !m.record).length
  const num = (n: number | undefined) => (n === undefined ? '—' : count(n))

  const keys: SortKey[][] = []
  const rows = members.map((m) => {
    const r = m.record
    const role = memberRole(guild, m.uid)
    const dungeons = r
      ? (r.normalDungeonsCleared ?? 0) + (r.fixedDungeonsCleared ?? 0)
      : undefined
    keys.push([
      m.name.toLowerCase(),
      role.name,
      m.player?.level,
      m.awayTicks,
      m.built,
      m.pals,
      r?.palsCaught,
      r?.speciesCaught,
      r?.bossesDefeated,
      r?.towerBossesDefeated,
      dungeons,
      r?.fishCaught,
      r?.palsCondensed,
      r?.itemsCrafted,
    ])
    return [
      <CardTrigger
        card={{ kind: 'player', uid: m.uid }}
        focusable
        className="flex items-center gap-2"
      >
        {m.online && <OnlineDot />}
        {m.name}
      </CardTrigger>,
      role.name,
      m.player?.level ?? '—',
      m.online ? (
        <span className="text-[var(--color-hp)]">online at save</span>
      ) : m.awayTicks === undefined ? (
        '—'
      ) : (
        formatUptimeAgo(m.awayTicks)
      ),
      count(m.built),
      count(m.pals),
      num(r?.palsCaught),
      num(r?.speciesCaught),
      num(r?.bossesDefeated),
      num(r?.towerBossesDefeated),
      num(dungeons),
      num(r?.fishCaught),
      num(r?.palsCondensed),
      num(r?.itemsCrafted),
    ]
  })

  return (
    <section className="mb-10">
      <SectionHeading
        title="Contribution"
        hint="longest away first · click a heading to sort"
      />
      <Table
        head={HEAD}
        rows={rows}
        sort={{ keys, initial: { column: LAST_SEEN, desc: true } }}
        selectedIndex={members.findIndex((m) => m.uid === selected?.playerUid)}
        onRowClick={(i) => {
          const player = members[i]?.player
          if (player) onSelect(player)
        }}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
        Last seen is measured on the server’s uptime clock, which stops while
        the server is down, so it is the least time that can have passed and not
        a date.
        {missing > 0 &&
          ` A dash from “caught” onwards means that member’s player save is not loaded: ${missing === members.length ? 'none are' : `${missing} of ${members.length} are missing`}. Add the Players folder to fill them in.`}
      </p>
    </section>
  )
}
