import type { Guid, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { ivTotal } from '../../domain/index.ts'
import { levelProgress, playerSummary } from '../../domain/guild.ts'
import { formatUptimeAgo, lastSeenFor } from '../../domain/lastSeen.ts'
import { palName } from '../../domain/palText.ts'
import { count, relativeTime } from '../../lib/format.ts'
import { memberRole } from '../../lib/roles.ts'
import { Field, Meter, MonogramTile, OnlineDot, Pill } from '../primitives.tsx'
import { CardFrame, CardNote, CardSection } from './CardFrame.tsx'

/**
 * A player, or a guild member who has no character in this world.
 *
 * Built from what the level says — level, guild, role, the pals they own and
 * the structures they placed — plus whatever their own player save adds:
 * platform, technology, paldex progress and an exact last-online time. With no
 * player save the last-seen line falls back to the server-uptime clock and
 * says so, because that clock cannot be turned into a date.
 *
 * `data` is absent in degraded mode and for the summary's deliberately raw
 * lists, which costs the XP bar (it needs the levelling curve) and the best
 * pal's species name, and nothing else.
 */
export function PlayerCard({
  uid,
  note,
  data,
  index,
}: {
  uid: Guid
  note?: string
  data: Refdata | undefined
  index: SaveIndex
}) {
  const player = index.playerByUid.get(uid)
  const guild =
    (player?.groupId && index.guildById.get(player.groupId)) ||
    index.guilds.find((g) => g.members.some((m) => m.playerUid === uid))
  const member = guild?.members.find((m) => m.playerUid === uid)
  const detail = index.playerDetails.find((d) => d.playerUid === uid)
  const seen = lastSeenFor(player, detail, member, index.meta)
  const role = guild ? memberRole(guild, uid) : undefined
  const name = player?.name ?? member?.name ?? uid.slice(0, 8)

  const summary = player ? playerSummary(index, player, guild) : undefined
  const progress = player
    ? levelProgress(player.level, player.exp, data?.expTable)
    : undefined
  const best = summary?.best
  const record = detail?.record

  return (
    <CardFrame
      icon={<MonogramTile name={name} size={48} />}
      title={
        <span className="flex items-center gap-2">
          {seen.onlineAtSave && <OnlineDot />}
          <span className="truncate">{name}</span>
        </span>
      }
      sub={[guild?.name, detail?.platform !== 'Unknown' && detail?.platform]
        .filter(Boolean)
        .join(' · ')}
      aside={
        <span className="flex flex-col items-end gap-1">
          {player && (
            <span className="num text-[var(--color-stamina)]">
              Lv.{player.level}
            </span>
          )}
          {role && <Pill tone={role.tone}>{role.name}</Pill>}
        </span>
      }
      accent={role?.tone === 'signal' ? 'var(--color-signal)' : undefined}
    >
      {note && <CardNote>{note}</CardNote>}

      {!player && (
        <p className="text-xs text-[var(--color-muted)]">
          A guild member with no character in this world&apos;s save.
        </p>
      )}

      {player &&
        (progress !== undefined ? (
          <div className="flex items-center gap-2 text-xs">
            <Meter
              label="XP"
              value={progress * 100}
              max={100}
              tone="xp"
              height={10}
              showValue={false}
              className="flex-1"
            />
            <span className="num shrink-0 text-[var(--color-muted)]">
              {Math.round(progress * 100)}% to {player.level + 1}
            </span>
          </div>
        ) : (
          <Field label="XP" value={count(player.exp)} />
        ))}

      <div className="grid grid-cols-2 gap-x-4 text-xs">
        {summary && <Field label="Pals" value={count(summary.pals.length)} />}
        {summary && <Field label="Built" value={count(summary.built)} />}
        {record && <Field label="Caught" value={count(record.palsCaught)} />}
        {record && <Field label="Paldex" value={record.paldexUnlocked} />}
        {detail?.technologyPoints !== undefined && (
          <Field label="Tech pts" value={detail.technologyPoints} />
        )}
        {record && <Field label="Bosses" value={record.bossesDefeated} />}
        {record?.mutations !== undefined && (
          <Field label="Mutated" value={record.mutations} />
        )}
        {record?.arenaSoloClears !== undefined && (
          <Field label="Arena" value={record.arenaSoloClears} />
        )}
      </div>

      {best && (
        <CardSection label="Best pal" hint={`IV ${ivTotal(best)} / 300`}>
          <span className="text-xs">
            {palName(best, data?.species[best.characterId.toLowerCase()])}
            <span className="num ml-2 text-[var(--color-stamina)]">
              Lv.{best.level}
            </span>
          </span>
        </CardSection>
      )}

      <LastSeenLine seen={seen} />
    </CardFrame>
  )
}

function LastSeenLine({ seen }: { seen: ReturnType<typeof lastSeenFor> }) {
  if (seen.onlineAtSave) {
    return (
      <p className="text-xs text-[var(--color-hp)]">
        In the session that wrote this save.
      </p>
    )
  }
  if (seen.source === 'player-save') {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        Last online {relativeTime(seen.at)}.
      </p>
    )
  }
  if (seen.source === 'guild-uptime') {
    // Never a date: this clock stops while the server is down, and
    // reconstructing one was measured 52 hours out.
    return (
      <p className="text-xs text-[var(--color-muted)]">
        Last online {formatUptimeAgo(seen.uptimeTicksAgo)} — server-uptime
        clock; their player save gives an exact time.
      </p>
    )
  }
  return null
}
