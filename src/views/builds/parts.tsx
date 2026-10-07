/**
 * The pieces every Builds purpose lays out with: two ranked lists side by side,
 * a species row, the player's own pals, the passive advice for a side, and the
 * per-job worker sections. Shared by `BuildsView.tsx` and `ProductionBuilds.tsx`.
 */

import { useMemo, type ReactNode } from 'react'

import {
  advisePassives,
  bestWorkers,
  breedablePicks,
  ownedWorkers,
  speciesHeld,
  type OwnedRow,
  type PassiveAdvice,
  type SideSpec,
} from '../../domain/recommend.ts'
import { carrierCounts } from '../../domain/passives.ts'
import { palName } from '../../domain/palText.ts'
import { count } from '../../lib/format.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
import {
  PassiveChip,
  Pill,
  SectionHeading,
} from '../../components/primitives.tsx'
import { ListRow } from '../../components/controls.tsx'
import {
  MINE,
  TOP,
  WHERE_LABEL,
  breedHref,
  effectText,
  workName,
  type Ctx,
} from './buildsText.ts'

export function TwoLists({
  left,
  right,
  leftTitle = 'best species',
  rightTitle = 'yours',
}: {
  left: ReactNode
  right: ReactNode
  leftTitle?: string
  rightTitle?: string
}) {
  return (
    <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
      <div>
        <div className="label mb-1.5">{leftTitle}</div>
        {left}
      </div>
      <div>
        <div className="label mb-1.5">{rightTitle}</div>
        {right}
      </div>
    </div>
  )
}

export function SpeciesRow({
  id,
  ctx,
  held,
  href,
  children,
}: {
  id: string
  ctx: Ctx
  held: boolean
  href: string
  children?: ReactNode
}) {
  return (
    <ListRow card={{ kind: 'species', id }}>
      <GameIcon
        path={ctx.text.icon(id)}
        name={id}
        elementName={ctx.text.element(id)}
        size={26}
      />
      <span className="min-w-0 flex-1 truncate">{ctx.text.name(id)}</span>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        {children}
        {held ? (
          <Pill tone="good" title="This player owns one">
            owned
          </Pill>
        ) : (
          <a
            href={href}
            className="rounded-control border border-[var(--color-signal)]/45 px-1.5 py-0.5 font-mono text-[11px] leading-none tracking-[0.08em] text-[var(--color-signal)] uppercase hover:bg-[var(--color-signal)]/10"
            title="Open the Breed tab planning this species, with the best breedable passives for this purpose"
          >
            breed →
          </a>
        )}
      </span>
    </ListRow>
  )
}

export function Owned({
  title,
  rows,
  ctx,
  wanted,
  detail,
  empty,
}: {
  title?: string
  rows: OwnedRow[]
  ctx: Ctx
  wanted: SideSpec
  detail: (row: OwnedRow) => ReactNode
  empty: string
}) {
  const advice = advisePassives(ctx.data.passives, wanted)
  const good = new Set([...advice.best, ...advice.also].map((s) => s.id))
  const bad = new Set(advice.avoid.map((s) => s.id))

  return (
    <div className={title ? 'mt-5' : undefined}>
      {title && <div className="label mb-1.5">{title}</div>}
      {rows.length === 0 && (
        <p className="py-2 text-xs text-[var(--color-muted)]">{empty}</p>
      )}
      {rows.map((r) => {
        const id = r.pal.characterId.toLowerCase()
        return (
          <div
            key={r.pal.instanceId}
            className="border-t border-[var(--color-line-faint)] py-2"
          >
            <div className="flex items-center gap-3 text-sm">
              <CardTrigger
                card={{ kind: 'pal', pal: r.pal }}
                focusable
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <GameIcon
                  path={ctx.text.icon(id)}
                  name={id}
                  elementName={ctx.text.element(id)}
                  size={26}
                />
                <span className="min-w-0 flex-1 truncate">
                  {palName(r.pal, ctx.data.species[id])}
                </span>
              </CardTrigger>
              <Pill title="Pal level">Lv {r.pal.level}</Pill>
              <Pill title="Where it is now">{WHERE_LABEL[r.where]}</Pill>
            </div>
            {/* A second line, so the name keeps the first: a fighter can carry
                four pills of detail, and a name squeezed to "Gu…" is no answer. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-[38px]">
              {detail(r)}
              {r.pal.passives.map((raw) => {
                const pid = raw.toLowerCase()
                return (
                  <span
                    key={pid}
                    className={
                      good.has(pid) || bad.has(pid) ? undefined : 'opacity-50'
                    }
                  >
                    <PassiveChip
                      id={pid}
                      focusable
                      note={
                        good.has(pid)
                          ? 'Helps here.'
                          : bad.has(pid)
                            ? 'Works against this.'
                            : 'No effect here.'
                      }
                      name={ctx.passives.name(pid)}
                      rank={ctx.passives.rank(pid)}
                    />
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The passives for one side, with what each does here and how many this player
 * already has.
 */
export function PassiveAdviceBlock({
  advice,
  ctx,
  empty,
}: {
  advice: PassiveAdvice
  ctx: Ctx
  empty?: string
}) {
  const carriers = useMemo(() => carrierCounts(ctx.pals), [ctx.pals])

  if (advice.best.length === 0 && advice.also.length === 0) {
    return empty ? (
      <p className="text-sm text-[var(--color-muted)]">{empty}</p>
    ) : null
  }

  const row = (s: PassiveAdvice['best'][number], score: boolean) => {
    const held = carriers.get(s.id) ?? 0
    const info = ctx.data.passives[s.id]
    return (
      <div
        key={s.id}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-line-faint)] py-1.5 text-sm"
      >
        <span className="w-44 shrink-0">
          <PassiveChip
            id={s.id}
            focusable
            name={ctx.passives.name(s.id)}
            rank={ctx.passives.rank(s.id)}
          />
        </span>
        <span className="min-w-0 flex-1 text-xs text-[var(--color-muted)]">
          {s.counted.map((c, i) => (
            <span
              key={i}
              className={
                c.good
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-danger)]'
              }
            >
              {i > 0 && ', '}
              {effectText(c.effect)}
            </span>
          ))}
        </span>
        {score && (
          <span className="num w-12 text-right text-xs" title="Score here">
            {s.score > 0 ? '+' : ''}
            {s.score}
          </span>
        )}
        {info && info.source !== 'random' && (
          <Pill tone="warn" title={ctx.passives.origin(s.id)}>
            {SOURCE_LABEL[info.source]}
          </Pill>
        )}
        {held > 0 && (
          <Pill tone="good" title="This player’s pals carrying it">
            have {count(held)}
          </Pill>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
      <div>
        <div className="label mb-1.5">passives to want</div>
        {advice.best.slice(0, 8).map((s) => row(s, true))}
        {advice.also.map((s) => row(s, false))}
      </div>
      {advice.avoid.length > 0 && (
        <div>
          <div className="label mb-1.5">passives to avoid</div>
          {advice.avoid.slice(0, 6).map((s) => row(s, s.score !== 0))}
        </div>
      )}
    </div>
  )
}

const SOURCE_LABEL = {
  random: 'random',
  lucky: 'lucky only',
  worldtree: 'world tree',
  mutation: 'mutation',
  exclusive: 'species only',
} as const

export function WorkSections({
  ctx,
  work,
  spec,
  advice,
}: {
  ctx: Ctx
  work: readonly string[]
  spec: SideSpec
  advice: PassiveAdvice
}) {
  const held = speciesHeld(ctx.pals)
  const picks = breedablePicks(advice, ctx.data.passives)

  return (
    <div className="mt-6 space-y-6">
      {work.map((id) => {
        const species = bestWorkers(ctx.data, ctx.pool, id, TOP)
        const mine = ownedWorkers(ctx.data, ctx.pals, ctx.where, id, spec, MINE)
        return (
          <section key={id}>
            <CardTrigger card={{ kind: 'work', id }} as="div">
              <SectionHeading title={workName(ctx.data, id)} />
            </CardTrigger>
            <TwoLists
              left={species.map((r) => (
                <SpeciesRow
                  key={r.id}
                  id={r.id}
                  ctx={ctx}
                  held={held.has(r.id)}
                  href={breedHref(ctx.index, ctx.ownerUid, r.id, picks)}
                >
                  <Pill tone="signal" title="Work suitability level">
                    Lv {r.level}
                  </Pill>
                  <Pill title="Work speed (craft_speed); 100 is ordinary">
                    spd {r.craftSpeed}
                  </Pill>
                  <Pill title="How much it eats (food_amount); lower is cheaper">
                    food {r.food}
                  </Pill>
                </SpeciesRow>
              ))}
              right={
                <Owned
                  rows={mine}
                  ctx={ctx}
                  wanted={spec}
                  detail={(r) => (
                    <Pill
                      tone="signal"
                      title="Species level plus any the save records"
                    >
                      Lv {(r as (typeof mine)[number]).level}
                    </Pill>
                  )}
                  empty="This player has no pal that does this job."
                />
              }
            />
          </section>
        )
      })}
    </div>
  )
}
