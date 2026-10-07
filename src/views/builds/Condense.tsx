/**
 * The Condense purpose: for every species held more than once, which one to
 * keep and how many there are to feed it.
 *
 * Unlike the other purposes this ranks nothing against the game's tables. It
 * is a reading of the player's own palbox, so it only ever counts their own
 * pals: a guildmate's duplicate is not yours to put in the condenser.
 */

import { useMemo } from 'react'

import {
  condensePlan,
  soulRanks,
  type CondenseRow,
} from '../../domain/condense.ts'
import { ivTotal } from '../../domain/index.ts'
import { condenserStars, palName } from '../../domain/palText.ts'
import type { Pal } from '../../domain/types.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
import { Jump } from '../../components/Jump.tsx'
import { Panel, PassiveChip, Pill } from '../../components/primitives.tsx'
import { count } from '../../lib/format.ts'
import type { Ctx } from './buildsText.ts'

/** Species shown before "longer lists" is ticked. */
const ROWS = 15

export function Condense({ ctx, more }: { ctx: Ctx; more: boolean }) {
  const rows = useMemo(
    () =>
      condensePlan(
        ctx.pals.filter((p) => p.ownerPlayerUid === ctx.ownerUid),
        (id) => ctx.data.passives[id]?.rank ?? 0,
      ),
    [ctx.pals, ctx.ownerUid, ctx.data],
  )
  const shown = more ? rows : rows.slice(0, ROWS)
  const spare = rows.reduce((sum, r) => sum + r.feed.length, 0)
  const name = ctx.owner.name(ctx.ownerUid)

  if (rows.length === 0) {
    return (
      <Panel title="At the Pal Condenser" padded>
        <p className="text-sm text-[var(--color-muted)]">
          {name} holds no species more than once, so there is nothing to
          condense.
        </p>
      </Panel>
    )
  }

  return (
    <Panel title="At the Pal Condenser" padded>
      <p className="mb-4 text-sm text-[var(--color-muted)]">
        {count(rows.length)} species held more than once, with {count(spare)}{' '}
        duplicates between them. For each, the one to keep is the one with the
        best IVs, since those are the one thing about a pal that nothing later
        changes.
      </p>
      <div className="divide-y divide-[var(--color-line-faint)] border-y border-[var(--color-line-faint)]">
        {shown.map((row) => (
          <Row key={row.species} row={row} ctx={ctx} />
        ))}
      </div>
      {shown.length < rows.length && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Showing the {count(shown.length)} with most to feed of{' '}
          {count(rows.length)}. Tick “longer lists” for the rest.
        </p>
      )}
    </Panel>
  )
}

function Row({ row, ctx }: { row: CondenseRow; ctx: Ctx }) {
  const { keep } = row
  const keepName = palName(keep, ctx.data.species[row.species])
  return (
    <div className="grid gap-x-6 gap-y-2 py-3 lg:grid-cols-[13rem_1fr_15rem]">
      <CardTrigger
        card={{ kind: 'species', id: row.species }}
        focusable
        className="flex items-center gap-3 self-start text-sm"
      >
        <GameIcon
          path={ctx.text.icon(row.species)}
          name={row.species}
          elementName={ctx.text.element(row.species)}
          size={30}
        />
        <span className="min-w-0 truncate">{ctx.text.name(row.species)}</span>
      </CardTrigger>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="label">keep</span>
          <Jump
            view="pals"
            focus={{ kind: 'pal', id: keep.instanceId, label: keepName }}
            card={{ kind: 'pal', pal: keep }}
            title="Open this pal in Pals"
            quiet
          >
            {keepName}
          </Jump>
          <Figures pal={keep} />
        </div>
        {keep.passives.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {keep.passives.map((raw) => {
              const id = raw.toLowerCase()
              return (
                <PassiveChip
                  key={id}
                  id={id}
                  focusable
                  name={ctx.passives.name(id)}
                  rank={ctx.passives.rank(id)}
                />
              )
            })}
          </div>
        )}
      </div>

      <div className="text-sm">
        <Jump
          view="pals"
          focus={{
            kind: 'species',
            id: row.species,
            label: ctx.text.name(row.species),
            owner: ctx.ownerUid,
          }}
          title="Show all of this player’s in Pals"
          quiet
        >
          <span className="label">feed</span>{' '}
          <span className="num">{count(row.feed.length)}</span>{' '}
          <span className="text-[11px] text-[var(--color-muted)]">
            best IV among them {Math.max(...row.feed.map(ivTotal))}
          </span>
        </Jump>
        {row.invested.length > 0 && (
          <p
            className="mt-1 text-[11px] leading-relaxed text-[var(--color-gold)]"
            title="Stars or souls have already gone into these. Look at them before spending them."
          >
            {count(row.invested.length)} of them{' '}
            {row.invested.length === 1 ? 'has' : 'have'} stars or souls already:{' '}
            {row.invested
              .slice(0, 3)
              .map(
                (p) =>
                  `lv${p.level}${condenserStars(p) ? ` ★${condenserStars(p)}` : ''}${soulRanks(p) ? ` ${soulRanks(p)} souls` : ''}`,
              )
              .join(', ')}
            {row.invested.length > 3 && ' …'}
          </p>
        )}
      </div>
    </div>
  )
}

/** The figures a keeper is chosen on, and the ones condensing adds to. */
function Figures({ pal }: { pal: Pal }) {
  const stars = condenserStars(pal)
  const souls = [
    ['HP', pal.rankHp],
    ['ATK', pal.rankAttack],
    ['DEF', pal.rankDefence],
    ['WORK', pal.rankCraftSpeed],
  ].filter(([, n]) => (n as number) > 0)
  return (
    <span className="flex flex-wrap gap-1">
      <Pill title="Pal level">Lv {pal.level}</Pill>
      <Pill
        tone="signal"
        title={`IVs: HP ${pal.ivHp ?? '–'}, attack ${pal.ivAttack ?? '–'}, defense ${pal.ivDefense ?? '–'}`}
      >
        IV {ivTotal(pal)}
      </Pill>
      <Pill
        tone={stars > 0 ? 'good' : 'neutral'}
        title="Condenser stars, of four"
      >
        ★{stars}
      </Pill>
      {souls.map(([label, n]) => (
        <Pill key={label} title={`Soul enhancements to ${label}`}>
          {label} +{n}
        </Pill>
      ))}
    </span>
  )
}
