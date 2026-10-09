/**
 * The party the player is carrying now, against what the page recommends.
 *
 * Every other list on this tab answers "what is best". This one answers the
 * question that follows: "so what do I change". It only speaks about the
 * selected player's own party, whoever else's pals are being counted, and it
 * only exists when their player save is loaded, because that is the file that
 * says which container is their party.
 */

import { speciesOf } from '../../domain/names.ts'
import type { ReactNode } from 'react'

import type { MountGap, OwnedRow, PartyAdvice } from '../../domain/recommend.ts'
import { palName } from '../../domain/palText.ts'
import type { Pal } from '../../domain/types.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { Jump } from '../../components/Jump.tsx'
import { Panel, Pill } from '../../components/primitives.tsx'
import { count } from '../../lib/format.ts'
import { MOUNT_LABEL, WHERE_LABEL, partyKnown, type Ctx } from './buildsText.ts'

function Shell({ children }: { children: ReactNode }) {
  return (
    <Panel title="Your party now" padded>
      {children}
    </Panel>
  )
}

function Unknown({ ctx }: { ctx: Ctx }) {
  const name = ctx.owner.name(ctx.ownerUid)
  return (
    <Shell>
      <p className="text-sm text-[var(--color-muted)]">
        The level save does not say which pals are in {name}’s party. Add their
        file from the <span className="num">Players</span> folder and this will
        compare the party against the lists below.
      </p>
    </Shell>
  )
}

function PalLink({ pal, ctx }: { pal: Pal; ctx: Ctx }) {
  const id = pal.characterId.toLowerCase()
  const name = palName(pal, speciesOf(ctx.data, pal))
  return (
    <Jump
      view="pals"
      focus={{ kind: 'pal', id: pal.instanceId, label: name }}
      card={{ kind: 'pal', pal }}
      quiet
      className="items-center gap-2"
    >
      <GameIcon
        path={ctx.text.icon(id)}
        name={id}
        elementName={ctx.text.element(id)}
        size={22}
      />
      <span className="min-w-0 truncate">{name}</span>
      {/* Two of a species are common in a ranking, and only this tells them
          apart. */}
      <span className="num shrink-0 text-[11px] text-[var(--color-muted)]">
        lv{pal.level}
      </span>
    </Jump>
  )
}

/** Where a pal that should be in the party is now, and whose it is. */
function From({ row, ctx }: { row: OwnedRow; ctx: Ctx }) {
  const who = ctx.owner.badge(row.pal)
  return (
    <>
      {who && <Pill tone="warn">{who.name}</Pill>}
      <Pill title="Where it is now">{WHERE_LABEL[row.where]}</Pill>
    </>
  )
}

/**
 * The fight party: who stays, and who to swap for whom and why.
 *
 * `detail` draws a row's own figures, so this stays the one strip whatever is
 * being ranked.
 */
export function FightParty<T extends OwnedRow>({
  ctx,
  advice,
  detail,
  reason,
}: {
  ctx: Ctx
  advice: PartyAdvice<T>
  detail: (row: T) => ReactNode
  /** Why the first ranks above the second, as the end of "it has …". */
  reason: (better: T, worse: T) => string
}) {
  if (!partyKnown(ctx)) return <Unknown ctx={ctx} />
  if (advice.party.length === 0) {
    return (
      <Shell>
        <p className="text-sm text-[var(--color-muted)]">
          The party is empty, so there is nothing to compare. The list below is
          who to take.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <p className="mb-3 text-sm text-[var(--color-muted)]">
        {advice.swaps.length === 0
          ? `All ${count(advice.party.length)} are who the ranking below would pick for this fight.`
          : `${count(advice.swaps.length)} of ${count(advice.party.length)} would change for this fight.`}
      </p>
      <div className="divide-y divide-[var(--color-line-faint)] border-y border-[var(--color-line-faint)] text-sm">
        {advice.swaps.map(({ out, in: into }) => (
          <div key={out.pal.instanceId} className="space-y-1.5 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="label w-10 shrink-0">out</span>
              <PalLink pal={out.pal} ctx={ctx} />
              <span className="flex flex-wrap gap-1">{detail(out)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="label w-10 shrink-0 text-[var(--color-signal)]">
                in
              </span>
              <PalLink pal={into.pal} ctx={ctx} />
              <span className="flex flex-wrap gap-1">
                {detail(into)}
                <From row={into} ctx={ctx} />
              </span>
            </div>
            <p className="pl-[52px] text-[11px] text-[var(--color-muted)]">
              It has {reason(into, out)}.
            </p>
          </div>
        ))}
        {advice.keep.map((row) => (
          <div
            key={row.pal.instanceId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
          >
            <span className="label w-10 shrink-0">keep</span>
            <PalLink pal={row.pal} ctx={ctx} />
            <span className="flex flex-wrap gap-1">{detail(row)}</span>
          </div>
        ))}
      </div>
    </Shell>
  )
}

/** The travel party: for each kind of mount, whether the fastest is carried. */
export function TravelParty({
  ctx,
  gaps,
  carried,
}: {
  ctx: Ctx
  gaps: MountGap[]
  /** How many mounts of any kind are in the party. */
  carried: number
}) {
  if (!partyKnown(ctx)) return <Unknown ctx={ctx} />
  return (
    <Shell>
      <p className="mb-3 text-sm text-[var(--color-muted)]">
        {gaps.length === 0
          ? carried === 0
            ? 'No mount is in the party, and none is on offer either.'
            : 'The fastest of every kind of mount on offer is already in the party.'
          : `${count(carried)} ${carried === 1 ? 'mount is' : 'mounts are'} in the party. For ${count(gaps.length)} ${gaps.length === 1 ? 'kind' : 'kinds'}, a faster one is not.`}
      </p>
      {gaps.length > 0 && (
        <div className="divide-y divide-[var(--color-line-faint)] border-y border-[var(--color-line-faint)] text-sm">
          {gaps.map((g) => {
            const glider = g.kind === 'glider'
            return (
              <div
                key={g.kind}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
              >
                <span className="label w-32 shrink-0">
                  {MOUNT_LABEL[g.kind]}
                </span>
                <PalLink pal={g.best.pal} ctx={ctx} />
                <span className="flex flex-wrap gap-1">
                  {!glider && (
                    <Pill tone="signal" title="ride_sprint_speed">
                      {count(g.best.speed)}
                    </Pill>
                  )}
                  <From row={g.best} ctx={ctx} />
                </span>
                <span className="text-[11px] text-[var(--color-muted)]">
                  {g.carried
                    ? glider
                      ? `ranks above the ${palName(g.carried.pal, speciesOf(ctx.data, g.carried.pal))} being carried`
                      : `the party’s is ${palName(g.carried.pal, speciesOf(ctx.data, g.carried.pal))} at ${count(g.carried.speed)}`
                    : 'the party has none of this kind'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Shell>
  )
}
