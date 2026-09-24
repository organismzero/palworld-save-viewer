/**
 * Which pals to carry and which to station, for a purpose.
 *
 * ## What it answers
 *
 * "I am setting up a breeding base — what should work there, and with which
 * passives?" "I am fighting this — what should be in my party?" Each purpose is
 * split by where a pal does its job: in your party, at your base, or in the
 * breeding farm, because the same passive can be worth a lot in one and nothing
 * in another.
 *
 * Every ranking is worked out in `domain/recommend.ts` from the game's tables;
 * none of it is a list someone typed in. Each section pairs the general answer
 * (the best species there are) with this save's answer (the best of this
 * player's own pals), and a species the player lacks links across to the Breed
 * view with the purpose's passives already picked.
 */

import { useEffect, useMemo, type ReactNode } from 'react'

import type { Guid, Pal, Player, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import {
  BREEDING_WORK,
  MOUNT_KINDS,
  advisePassives,
  bestFighters,
  bestMounts,
  bestWorkers,
  breedablePicks,
  carriersOf,
  elementsOf,
  locator,
  ownedFighters,
  ownedMounts,
  ownedWorkers,
  sidesFor,
  speciesHeld,
  speciesPool,
  strongSkills,
  type GoalId,
  type OwnedRow,
  type PassiveAdvice,
  type SideSpec,
  type Where,
} from '../../domain/recommend.ts'
import { strongAgainst, STRONG, WEAK } from '../../domain/typeChart.ts'
import { carrierCounts } from '../../domain/passives.ts'
import { palName } from '../../domain/palText.ts'
import { WORK_TYPES } from '../../lib/color.ts'
import { count } from '../../lib/format.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { useViewParams } from '../../app/viewParams.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
import {
  ElementBadge,
  Panel,
  PassiveChip,
  Pill,
  SectionHeading,
} from '../../components/primitives.tsx'
import {
  Checkbox,
  ListRow,
  MenuButton,
  SelectControl,
  TextInput,
} from '../../components/controls.tsx'
import { passiveText, type PassiveText } from '../breed/passiveText.ts'
import { speciesText, type SpeciesText } from '../breed/speciesText.ts'
import {
  MOUNT_LABEL,
  WHERE_LABEL,
  breedHref,
  effectText,
} from './buildsText.ts'
import { BUILDS_DEFAULTS, buildsCodec, type BuildsParams } from './params.ts'

const GOALS: { id: GoalId; label: string; hint: string }[] = [
  {
    id: 'breeding',
    label: 'Breeding base',
    hint: 'Who works it, and what speeds up eggs',
  },
  { id: 'work', label: 'Work base', hint: 'The best pals for chosen jobs' },
  { id: 'fight', label: 'Fight a pal', hint: 'A party for a boss or alpha' },
  { id: 'travel', label: 'Travel', hint: 'The fastest mounts' },
]

/** The jobs a work base starts with, before any are picked. */
const WORK_DEFAULT = ['Mining', 'Deforest']

/** How many species and how many of your own pals each list shows. */
const TOP = 5
const MINE = 3

export function BuildsView({ index }: { index: SaveIndex }) {
  const { data, status, ensure } = useRefdataStore()
  useEffect(() => {
    void ensure()
  }, [ensure])

  const focus = useUiStore((s) => s.focus)
  const clearFocus = useUiStore((s) => s.clearFocus)
  useEffect(clearFocus, [clearFocus])

  const codec = useMemo(() => buildsCodec(index), [index])
  const [params, setParams] = useViewParams(
    'builds',
    BUILDS_DEFAULTS,
    codec,
    () => (focus?.kind === 'player' ? { playerUid: focus.id } : undefined),
  )
  const patch = (p: Partial<BuildsParams>) =>
    setParams((prev) => ({ ...prev, ...p }))

  const fallback = useMemo(() => busiestPlayer(index), [index])
  const player = params.playerUid
    ? index.playerByUid.get(params.playerUid)
    : fallback
  const ownerUid = player?.playerUid
  const pals = useMemo(
    () => (ownerUid ? (index.palsByOwner.get(ownerUid) ?? []) : []),
    [index, ownerUid],
  )
  const where = useMemo(() => locator(index), [index])

  const work =
    params.work.length > 0
      ? params.work
      : params.goal === 'breeding'
        ? [...BREEDING_WORK]
        : WORK_DEFAULT

  const text = speciesText(data)
  const passives = passiveText(data)
  const pool = useMemo(() => (data ? speciesPool(data) : []), [data])

  const ctx: Ctx | undefined = data && {
    index,
    data,
    pool,
    pals,
    where,
    ownerUid,
    text,
    passives,
  }

  const opponent =
    params.opponent && data?.species[params.opponent]
      ? params.opponent
      : undefined

  return (
    <div className="flex h-full">
      <aside className="w-[var(--rail-width)] shrink-0 space-y-5 overflow-y-auto border-r border-[var(--color-line)] p-4">
        <SelectControl
          label="whose pals"
          value={ownerUid ?? ''}
          onChange={(v) => patch({ playerUid: v })}
          options={index.players.map((p) => ({
            value: p.playerUid,
            label: `${p.name} — ${count(index.palsByOwner.get(p.playerUid)?.length ?? 0)} pals`,
          }))}
        />

        <div className="space-y-2">
          <div className="label">what for</div>
          {GOALS.map((g) => (
            <MenuButton
              key={g.id}
              selected={params.goal === g.id}
              onClick={() => patch({ goal: g.id, work: [] })}
              className="px-4 py-2.5"
            >
              <div className="text-sm">{g.label}</div>
              <div className="text-[11px] text-[var(--color-muted)]">
                {g.hint}
              </div>
            </MenuButton>
          ))}
        </div>

        {(params.goal === 'breeding' || params.goal === 'work') && data && (
          <WorkPicker
            data={data}
            pool={pool}
            selected={work}
            onChange={(next) => patch({ work: next })}
          />
        )}
      </aside>

      {params.goal === 'fight' && (
        <OpponentPicker
          data={data}
          pool={pool}
          text={text}
          query={params.query}
          selected={params.opponent}
          onQuery={(q) => patch({ query: q })}
          onPick={(id) => patch({ opponent: id })}
        />
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {!ctx ? (
          <Missing
            what={
              status === 'degraded'
                ? 'Game data could not be loaded, and every recommendation here is worked out from it — so there is nothing to show. The rest of the app still works.'
                : 'Loading game data.'
            }
          />
        ) : (
          <div className="mx-auto max-w-6xl space-y-6">
            {params.goal === 'breeding' && <Breeding ctx={ctx} work={work} />}
            {params.goal === 'work' && <Work ctx={ctx} work={work} />}
            {params.goal === 'fight' &&
              (opponent ? (
                <Fight ctx={ctx} opponent={opponent} />
              ) : (
                <Missing what="Pick the pal you are fighting on the left — a tower boss, an alpha, anything. What beats it is worked out from its elements." />
              ))}
            {params.goal === 'travel' && <Travel ctx={ctx} />}
            <Footnote goal={params.goal} player={player} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Everything a section needs, passed as one so the call sites stay legible. */
interface Ctx {
  index: SaveIndex
  data: Refdata
  pool: string[]
  pals: readonly Pal[]
  where: (pal: Pal) => Where
  ownerUid: Guid | undefined
  text: SpeciesText
  passives: PassiveText
}

/* -------------------------------------------------------------------------
   Purposes
   ------------------------------------------------------------------------- */

function Breeding({ ctx, work }: { ctx: Ctx; work: readonly string[] }) {
  const [base, farm] = sidesFor('breeding', {
    work,
    opponentElements: [],
    attackElements: [],
  }) as [SideSpec, SideSpec]
  const baseAdvice = advisePassives(ctx.data.passives, base)
  const farmAdvice = advisePassives(ctx.data.passives, farm)
  const farmIds = [...farmAdvice.best, ...farmAdvice.also].map((s) => s.id)

  return (
    <>
      <Panel title="In your party" padded>
        <p className="text-sm text-[var(--color-muted)]">
          Nothing in the game’s passive table speeds up breeding from the party:
          every breeding effect targets either the pal in the farm or the base’s
          buildings. Carry whatever the other purposes suggest.
        </p>
      </Panel>

      <Panel title="In the breeding farm" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          The two parents. Which species to pair is the{' '}
          <a className="text-[var(--color-signal)] underline" href="#/breed">
            Breed
          </a>{' '}
          tab’s job; this is what makes the pair itself work faster.
        </p>
        <PassiveAdviceBlock
          advice={farmAdvice}
          ctx={ctx}
          empty="No passive in the data speeds up the farm from the parents."
        />
        <Owned
          title="yours already carrying one"
          rows={carriersOf(ctx.data, ctx.pals, ctx.where, farmIds, farm, MINE)}
          ctx={ctx}
          detail={() => null}
          wanted={farm}
          empty="None of this player’s pals carries one yet."
        />
      </Panel>

      <Panel title="At your base" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          The jobs picked on the left, and the passives that help a worker —
          including the ones that act on the base’s incubators and farms rather
          than on the pal.
        </p>
        <PassiveAdviceBlock advice={baseAdvice} ctx={ctx} />
        <WorkSections ctx={ctx} work={work} spec={base} advice={baseAdvice} />
      </Panel>
    </>
  )
}

function Work({ ctx, work }: { ctx: Ctx; work: readonly string[] }) {
  const [party, base] = sidesFor('work', {
    work,
    opponentElements: [],
    attackElements: [],
  }) as [SideSpec, SideSpec]
  const partyAdvice = advisePassives(ctx.data.passives, party)
  const baseAdvice = advisePassives(ctx.data.passives, base)
  const partyIds = partyAdvice.best.map((s) => s.id)

  return (
    <>
      <Panel title="In your party" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Passives that act on you rather than on the pal, so they only count
          while it is out with you — for the work you do yourself.
        </p>
        <PassiveAdviceBlock
          advice={partyAdvice}
          ctx={ctx}
          empty="No passive in the data boosts your own work at these jobs."
        />
        <Owned
          title="yours already carrying one"
          rows={carriersOf(
            ctx.data,
            ctx.pals,
            ctx.where,
            partyIds,
            party,
            MINE,
          )}
          ctx={ctx}
          detail={() => null}
          wanted={party}
          empty="None of this player’s pals carries one yet."
        />
      </Panel>

      <Panel title="At your base" padded>
        <PassiveAdviceBlock advice={baseAdvice} ctx={ctx} />
        <WorkSections ctx={ctx} work={work} spec={base} advice={baseAdvice} />
      </Panel>
    </>
  )
}

function WorkSections({
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

function Fight({ ctx, opponent }: { ctx: Ctx; opponent: string }) {
  const els = elementsOf(ctx.data, opponent)
  const strong = strongAgainst(els)
  const attackElements = strong.map((s) => s.element)
  const [party] = sidesFor('fight', {
    work: [],
    opponentElements: els,
    attackElements,
  }) as [SideSpec]
  const advice = advisePassives(ctx.data.passives, party)
  const picks = breedablePicks(advice, ctx.data.passives)
  const held = speciesHeld(ctx.pals)
  const species = bestFighters(ctx.data, ctx.pool, els, TOP * 2)
  const mine = ownedFighters(ctx.data, ctx.pals, ctx.where, els, party, TOP)
  const moves = strongSkills(ctx.data, attackElements, 4)

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <CardTrigger card={{ kind: 'species', id: opponent }} focusable>
          <GameIcon
            path={ctx.text.icon(opponent)}
            name={opponent}
            elementName={ctx.text.element(opponent)}
            size={56}
          />
        </CardTrigger>
        <div>
          <div className="label">fighting</div>
          <div className="text-xl">{ctx.text.name(opponent)}</div>
          <div className="mt-1 flex gap-3">
            {els.map((e) => (
              <ElementBadge key={e} name={e} showLabel />
            ))}
          </div>
        </div>
        <div className="ml-auto text-sm">
          {strong.length === 0 ? (
            <span className="text-[var(--color-muted)]">
              No element beats it, so pick for raw attack.
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="label">weak to</span>
              {strong.map((s) => (
                <span key={s.element} className="flex items-center gap-1.5">
                  <ElementBadge name={s.element} showLabel />
                  <Pill tone="good">×{s.multiplier}</Pill>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <Panel title="In your party" padded>
        <TwoLists
          leftTitle="best species"
          left={species.map((r) => (
            <SpeciesRow
              key={r.id}
              id={r.id}
              ctx={ctx}
              held={held.has(r.id)}
              href={breedHref(ctx.index, ctx.ownerUid, r.id, picks)}
            >
              <Matchup dealt={r.dealt} taken={r.taken} element={r.element} />
              <Pill title="Base attack (shot_attack)">atk {r.attack}</Pill>
            </SpeciesRow>
          ))}
          rightTitle="yours"
          right={
            <Owned
              rows={mine}
              ctx={ctx}
              wanted={party}
              detail={(r) => {
                const f = r as (typeof mine)[number]
                return (
                  <>
                    <Matchup
                      dealt={f.fight.dealt}
                      taken={f.fight.taken}
                      element={f.fight.element}
                    />
                    {f.strongMoves.map((m) => (
                      <CardTrigger
                        key={m}
                        card={{
                          kind: 'skill',
                          id: m,
                          note: 'Equipped, and strong here.',
                        }}
                        focusable
                      >
                        <Pill tone="good">
                          {ctx.data.skills[m.toLowerCase()]?.name ?? m}
                        </Pill>
                      </CardTrigger>
                    ))}
                  </>
                )
              }}
              empty="This player has no pals."
            />
          }
        />

        {moves.length > 0 && (
          <section className="mt-6">
            <SectionHeading
              title="hardest-hitting moves of those elements"
              hint="by power; species-only moves left out"
            />
            <div className="grid gap-x-6 sm:grid-cols-2">
              {moves.map((m) => (
                <ListRow key={m.id} card={{ kind: 'skill', id: m.id }}>
                  <ElementBadge name={m.element} card={false} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <Pill>pow {m.power}</Pill>
                  <Pill>{m.cooldown}s</Pill>
                </ListRow>
              ))}
            </div>
          </section>
        )}

        <div className="mt-6">
          <PassiveAdviceBlock advice={advice} ctx={ctx} />
        </div>
      </Panel>
    </>
  )
}

function Travel({ ctx }: { ctx: Ctx }) {
  const [party] = sidesFor('travel', {
    work: [],
    opponentElements: [],
    attackElements: [],
  }) as [SideSpec]
  const advice = advisePassives(ctx.data.passives, party)
  const picks = breedablePicks(advice, ctx.data.passives)
  const held = speciesHeld(ctx.pals)
  const mine = ownedMounts(ctx.data, ctx.pals, ctx.where, party, 1000)

  return (
    <Panel title="In your party" padded>
      <PassiveAdviceBlock advice={advice} ctx={ctx} />
      <div className="mt-6 space-y-6">
        {MOUNT_KINDS.map((kind) => {
          const species = bestMounts(ctx.data, ctx.pool, kind, TOP)
          if (species.length === 0) return null
          const glider = kind === 'glider'
          return (
            <section key={kind}>
              <SectionHeading
                title={MOUNT_LABEL[kind]}
                hint={
                  glider
                    ? 'never ridden — they change your glider while in the party'
                    : 'by sprint speed while ridden'
                }
              />
              <TwoLists
                left={species.map((r) => (
                  <SpeciesRow
                    key={r.id}
                    id={r.id}
                    ctx={ctx}
                    held={held.has(r.id)}
                    href={breedHref(ctx.index, ctx.ownerUid, r.id, picks)}
                  >
                    {!glider && (
                      <Pill tone="signal" title="ride_sprint_speed">
                        {count(r.speed)}
                      </Pill>
                    )}
                  </SpeciesRow>
                ))}
                right={
                  <Owned
                    rows={mine.filter((m) => m.kind === kind).slice(0, MINE)}
                    ctx={ctx}
                    wanted={party}
                    detail={(r) =>
                      glider ? null : (
                        <Pill tone="signal" title="ride_sprint_speed">
                          {count((r as (typeof mine)[number]).speed)}
                        </Pill>
                      )
                    }
                    empty="This player has none."
                  />
                }
              />
            </section>
          )
        })}
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

function TwoLists({
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

function SpeciesRow({
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

function Owned({
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

function Matchup({
  dealt,
  taken,
  element,
}: {
  dealt: number
  taken: number
  element?: string
}) {
  return (
    <>
      {element && <ElementBadge name={element} />}
      <Pill
        tone={dealt > 1 ? 'good' : dealt < 1 ? 'danger' : 'neutral'}
        title={`Its best element hits for ×${dealt} (assuming ×${STRONG} strong, ×${WEAK} weak)`}
      >
        hits ×{dealt}
      </Pill>
      {taken !== 1 && (
        <Pill
          tone={taken < 1 ? 'good' : 'danger'}
          title={`The opponent’s elements hit it for ×${taken}`}
        >
          takes ×{taken}
        </Pill>
      )}
    </>
  )
}

/**
 * The passives for one side, with what each does here and how many this player
 * already has.
 */
function PassiveAdviceBlock({
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

/* -------------------------------------------------------------------------
   The rail
   ------------------------------------------------------------------------- */

function WorkPicker({
  data,
  pool,
  selected,
  onChange,
}: {
  data: Refdata
  pool: readonly string[]
  selected: readonly string[]
  onChange: (next: string[]) => void
}) {
  // Only jobs some real pal does: Oil Extraction is a work type with no
  // breedable pal suited to it, and a box that lists nothing is noise.
  const jobs = WORK_TYPES.filter((w) =>
    pool.some((id) => (data.species[id]?.work?.[w.id] ?? 0) > 0),
  )
  const on = new Set(selected)
  const toggle = (id: string) => {
    const next = new Set(on)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next].sort())
  }

  return (
    <div>
      <div className="label mb-2">jobs</div>
      <div className="flex flex-col gap-2">
        {jobs.map((w) => (
          <Checkbox
            key={w.id}
            checked={on.has(w.id)}
            onChange={() => toggle(w.id)}
            label={workName(data, w.id)}
          />
        ))}
      </div>
    </div>
  )
}

function OpponentPicker({
  data,
  pool,
  text,
  query,
  selected,
  onQuery,
  onPick,
}: {
  data: Refdata | undefined
  pool: readonly string[]
  text: SpeciesText
  query: string
  selected: string
  onQuery: (q: string) => void
  onPick: (id: string) => void
}) {
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pool
      .filter(
        (id) => !q || id.includes(q) || text.name(id).toLowerCase().includes(q),
      )
      .map((id) => ({
        id,
        name: text.name(id),
        zukan: data?.species[id]?.zukan ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.zukan - b.zukan || a.name.localeCompare(b.name))
    // `text` is rebuilt every render from `data`, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, query, data])

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-[var(--color-line)]">
      <div className="p-4 pb-3">
        <TextInput
          label="fighting what"
          value={query}
          onChange={onQuery}
          placeholder="Search species"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {rows.map((r) => (
          <ListRow
            key={r.id}
            selected={r.id === selected}
            onClick={() => onPick(r.id)}
            card={{ kind: 'species', id: r.id }}
          >
            <GameIcon
              path={text.icon(r.id)}
              name={r.id}
              elementName={text.element(r.id)}
              size={26}
            />
            <span className="min-w-0 flex-1 truncate text-xs">{r.name}</span>
            {data &&
              elementsOf(data, r.id).map((e) => (
                <ElementBadge key={e} name={e} size={10} card={false} />
              ))}
          </ListRow>
        ))}
        {rows.length === 0 && (
          <p className="px-2 py-3 text-xs text-[var(--color-muted)]">
            Nothing matches that.
          </p>
        )}
      </div>
    </aside>
  )
}

/* -------------------------------------------------------------------------
   The assumptions, said out loud
   ------------------------------------------------------------------------- */

function Footnote({ goal, player }: { goal: GoalId; player?: Player }) {
  return (
    <section className="border-t border-[var(--color-line-faint)] pt-4 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <p>
        Worked out from the game’s own tables rather than from anyone’s tier
        list: species by their work-suitability levels, work speed, appetite,
        attack and riding speed; passives by what each effect does, how much,
        and whether it lands on the pal, on you, or on the base’s buildings —
        which is what decides party against base. Every percentage point a
        purpose wants counts the same, because the game gives no rate for
        trading attack against defence — and only percentages of one kind are
        added up, so regeneration, stamina, cooldowns and switches like working
        through the night are listed beside the ranking rather than scored.
      </p>
      {goal === 'fight' && (
        <p className="mt-2">
          The element chart is the one thing here not read from the data, which
          does not carry it. Its ×{STRONG} and ×{WEAK} are an assumption, as is
          multiplying them across a two-element pal, and the opponent is assumed
          to fight with its own elements. Level, IVs and condensing are in the
          save, but the damage formula is not, so they order your pals rather
          than feed a number.
        </p>
      )}
      <p className="mt-2">
        “Yours” lists {player ? `${player.name}’s` : 'this player’s'} own pals,
        wherever they are. “Breed →” opens the Breed tab on that species with up
        to four of the best passives a hatch can roll already picked.
      </p>
    </section>
  )
}

function Missing({ what }: { what: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="max-w-sm text-center text-sm text-[var(--color-muted)]">
        {what}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

function workName(data: Refdata, id: string): string {
  return (
    data.work.find((w) => w.id === id)?.display ??
    WORK_TYPES.find((w) => w.id === id)?.display ??
    id
  )
}

/** The player with the most pals — the one most likely to be asking. */
function busiestPlayer(index: SaveIndex): Player | undefined {
  let best: Player | undefined
  let most = -1
  for (const p of index.players) {
    const n = index.palsByOwner.get(p.playerUid)?.length ?? 0
    if (n > most) {
      most = n
      best = p
    }
  }
  return best
}
