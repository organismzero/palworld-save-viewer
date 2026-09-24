/**
 * The production purposes: fishing and salvaging, a food base, a cake base and
 * a ranch base.
 *
 * Unlike the other purposes these are carried almost entirely by partner
 * skills and ranch drops, not by passives — no passive a pal can roll touches
 * fishing, crops or what a Ranch yields. So each one leads with the pals to
 * bring or station, from their typed partner-skill effects and the drops read
 * out of their descriptions, and shows passive advice only where passives act:
 * on the workers.
 *
 * Partner-skill values are the skill's level 1, which is what the data states;
 * a condensed pal's are higher.
 */

import type { ReactNode } from 'react'

import {
  PARTNER_WANTS,
  advisePassives,
  bestPartners,
  breedablePicks,
  ownedPartners,
  ownedProducers,
  ranchDropItems,
  ranchProducers,
  sidesFor,
  speciesHeld,
  type SideSpec,
  type Want,
} from '../../domain/recommend.ts'
import {
  CAKES,
  cakeRecipe,
  ingredientSources,
  type CakeRecipe,
  type IngredientSource,
} from '../../domain/recipes.ts'
import { count } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
import { Panel, Pill, SectionHeading } from '../../components/primitives.tsx'
import { ListRow } from '../../components/controls.tsx'
import { MINE, TOP, breedHref, effectText, type Ctx } from './buildsText.ts'
import {
  Owned,
  PassiveAdviceBlock,
  SpeciesRow,
  TwoLists,
  WorkSections,
} from './parts.tsx'

const NO_INPUT = { opponentElements: [], attackElements: [] } as const

/* -------------------------------------------------------------------------
   Fishing and salvaging
   ------------------------------------------------------------------------- */

export function Fishing({ ctx }: { ctx: Ctx }) {
  const [party] = sidesFor('fishing', { work: [], ...NO_INPUT }) as [SideSpec]
  return (
    <Panel title="In your party" padded>
      <p className="mb-4 text-sm text-[var(--color-muted)]">
        No passive a pal can roll affects fishing or salvaging. What helps is a
        partner skill, and it only counts while that pal is out with you.
      </p>
      <PartnerSection
        title="Fishing"
        wants={PARTNER_WANTS.fishing}
        spec={party}
        ctx={ctx}
        empty="No species' partner skill helps with fishing."
      />
      <PartnerSection
        title="Salvaging"
        wants={PARTNER_WANTS.salvage}
        spec={party}
        ctx={ctx}
        empty="No species' partner skill helps with salvaging."
      />
    </Panel>
  )
}

/* -------------------------------------------------------------------------
   Food base
   ------------------------------------------------------------------------- */

export function Food({ ctx, work }: { ctx: Ctx; work: readonly string[] }) {
  const [base] = sidesFor('food', { work, ...NO_INPUT }) as [SideSpec]
  const advice = advisePassives(ctx.data.passives, base)
  const drops = ranchDropItems(ctx.data, ctx.pool, true)

  return (
    <>
      <Panel title="At your base" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Growing, gathering, ranching, cooking and keeping it cold — the jobs
          picked on the left, and the passives that help a worker at them.
        </p>
        <PassiveAdviceBlock advice={advice} ctx={ctx} />
        <WorkSections ctx={ctx} work={work} spec={base} advice={advice} />
      </Panel>

      <Panel title="Base boosters" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Partner skills that act on the whole base while the pal is stationed
          there: bigger harvests, faster crops, and less hunger for everyone
          else.
        </p>
        <PartnerSection
          title="Crops"
          wants={PARTNER_WANTS.crops}
          spec={base}
          ctx={ctx}
          empty="No species' partner skill boosts crops."
        />
        <PartnerSection
          title="Hunger"
          wants={PARTNER_WANTS.hunger}
          spec={base}
          ctx={ctx}
          empty="No species' partner skill slows a base's hunger."
        />
      </Panel>

      <Panel title="Ranch food" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Food that pals drop while working a Ranch, and who drops it.
        </p>
        <ProducerSections items={drops} spec={base} ctx={ctx} />
      </Panel>

      <Panel title="In your party" padded>
        <PartnerSection
          title="Spoilage"
          wants={PARTNER_WANTS.spoilage}
          spec={base}
          ctx={ctx}
          empty="No species' partner skill slows food spoiling."
        />
      </Panel>
    </>
  )
}

/* -------------------------------------------------------------------------
   Ranch base
   ------------------------------------------------------------------------- */

export function Ranch({ ctx, work }: { ctx: Ctx; work: readonly string[] }) {
  const [base] = sidesFor('ranch', { work, ...NO_INPUT }) as [SideSpec]
  const advice = advisePassives(ctx.data.passives, base)
  const drops = ranchDropItems(ctx.data, ctx.pool, false)

  return (
    <>
      <Panel title="What a Ranch can make" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Every material a pal drops while working a Ranch, and who drops it.
          Food is on the food base.
        </p>
        <ProducerSections items={drops} spec={base} ctx={ctx} />
      </Panel>

      <Panel title="Base boosters" padded>
        <PartnerSection
          title="Ranching"
          wants={PARTNER_WANTS.ranchRank}
          spec={base}
          ctx={ctx}
          empty="No species' partner skill raises the base's Ranching."
        />
        <PartnerSection
          title="Hunger"
          wants={PARTNER_WANTS.hunger}
          spec={base}
          ctx={ctx}
          empty="No species' partner skill slows a base's hunger."
        />
      </Panel>

      <Panel title="At your base" padded>
        <PassiveAdviceBlock advice={advice} ctx={ctx} />
        <WorkSections ctx={ctx} work={work} spec={base} advice={advice} />
      </Panel>
    </>
  )
}

/* -------------------------------------------------------------------------
   Cake base
   ------------------------------------------------------------------------- */

/** The jobs a recipe needs: cook it, and ranch and grow what goes in it. */
function cakeWork(ctx: Ctx, recipe: CakeRecipe): string[] {
  const kinds = new Set(
    recipe.ingredients.flatMap((i) =>
      ingredientSources(ctx.data, i.item).map((s) => s.kind),
    ),
  )
  const work = ['EmitFlame']
  if (kinds.has('ranch')) work.push('MonsterFarm')
  // Flour is milled Wheat, and Wheat is a crop.
  if (kinds.has('crop') || kinds.has('processed')) {
    work.push('Seeding', 'Watering', 'Collection')
  }
  return work
}

export function Cake({ ctx, cake }: { ctx: Ctx; cake: string }) {
  const recipe = cakeRecipe(cake) ?? CAKES[CAKES.length - 1]!
  const work = cakeWork(ctx, recipe)
  const [base, farm] = sidesFor('cake', { work, ...NO_INPUT }) as [
    SideSpec,
    SideSpec,
  ]
  const advice = advisePassives(ctx.data.passives, base)
  const farmAdvice = advisePassives(ctx.data.passives, farm)
  const ranchItems = recipe.ingredients
    .map((i) => i.item.toLowerCase())
    .filter((id) =>
      ingredientSources(ctx.data, id).some((s) => s.kind === 'ranch'),
    )
    .map((item) => ({ item, species: [] }))

  return (
    <>
      <Panel title="Which cake" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Every cake makes a Breeding Farm&apos;s pair lay a healthy egg; each
          tier adds something. Which is best depends on what you are breeding
          for — pick one on the left.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {CAKES.map((c) => (
            <CakeTile
              key={c.item}
              ctx={ctx}
              recipe={c}
              selected={c.item === recipe.item}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Ingredients" padded>
        <Ingredients ctx={ctx} recipe={recipe} />
      </Panel>

      <Panel title="At your base" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Who ranches the ingredients, who grows the crops, and who cooks.
        </p>
        <PassiveAdviceBlock advice={advice} ctx={ctx} />
        {ranchItems.length > 0 && (
          <div className="mt-6">
            <ProducerSections items={ranchItems} spec={base} ctx={ctx} />
          </div>
        )}
        <WorkSections ctx={ctx} work={work} spec={base} advice={advice} />
      </Panel>

      <Panel title="In the breeding farm" padded>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          The cake goes in the Breeding Farm&apos;s chest. The{' '}
          <a
            className="text-[var(--color-signal)] underline"
            href="#/builds?g=breeding"
          >
            breeding base
          </a>{' '}
          build covers the rest of it; this is what makes the pair itself work
          faster.
        </p>
        <PassiveAdviceBlock
          advice={farmAdvice}
          ctx={ctx}
          empty="No passive in the data speeds up the farm from the parents."
        />
      </Panel>
    </>
  )
}

/**
 * What a cake does, from its own description: the sentence every cake shares
 * ("…lay a particularly healthy egg") is taken as read, and the rest is what
 * sets this tier apart.
 */
function cakeEffect(description: string | undefined): string | undefined {
  if (!description) return undefined
  const rest = description
    .replace(/\r\n?/g, ' ')
    .split(/(?<=\.)\s+/)
    .filter((s) => !/healthy egg|dish eaten during celebrations/i.test(s))
    .join(' ')
    .trim()
  return rest || undefined
}

function CakeTile({
  ctx,
  recipe,
  selected,
}: {
  ctx: Ctx
  recipe: CakeRecipe
  selected: boolean
}) {
  const info = ctx.data.items[recipe.item.toLowerCase()]
  const effect = cakeEffect(info?.description)
  return (
    <CardTrigger
      as="div"
      card={{ kind: 'item', staticId: recipe.item }}
      focusable
      className={cn(
        'flex gap-3 rounded-panel border p-3',
        selected
          ? 'border-[var(--color-signal)] bg-[var(--color-signal)]/[0.06]'
          : 'border-[var(--color-line)]',
      )}
    >
      <GameIcon path={info?.icon} name={info?.name ?? recipe.item} size={36} />
      <div className="min-w-0">
        <div className="text-sm">{info?.name ?? recipe.item}</div>
        <p className="mt-1 text-xs leading-normal text-[var(--color-muted)]">
          {effect ?? 'A healthy egg, and nothing more.'}
        </p>
      </div>
    </CardTrigger>
  )
}

function Ingredients({ ctx, recipe }: { ctx: Ctx; recipe: CakeRecipe }) {
  return (
    <ul className="divide-y divide-[var(--color-line-faint)]">
      {recipe.ingredients.map((i) => {
        const info = ctx.data.items[i.item.toLowerCase()]
        return (
          <li key={i.item} className="flex items-center gap-3 py-2 text-sm">
            <CardTrigger
              card={{ kind: 'item', staticId: i.item, count: i.count }}
              focusable
              className="flex w-56 shrink-0 items-center gap-3"
            >
              <GameIcon
                path={info?.icon}
                name={info?.name ?? i.item}
                size={26}
              />
              <span className="min-w-0 flex-1 truncate">
                {info?.name ?? i.item}
              </span>
              <span className="num text-[var(--color-muted)]">×{i.count}</span>
            </CardTrigger>
            <span className="min-w-0 flex-1 text-xs text-[var(--color-muted)]">
              <SourceText
                ctx={ctx}
                sources={ingredientSources(ctx.data, i.item)}
              />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Where an ingredient comes from, in a phrase per source. */
function SourceText({
  ctx,
  sources,
}: {
  ctx: Ctx
  sources: IngredientSource[]
}): ReactNode {
  if (sources.length === 0) return 'Nothing in the data says where to get it.'
  const name = (id: string) => ctx.data.items[id.toLowerCase()]?.name ?? id
  const phrases = sources.map((s) => {
    switch (s.kind) {
      case 'ranch':
        return `dropped at a Ranch by ${s.species.map((id) => ctx.text.name(id)).join(', ')}`
      case 'crop':
        return `grown from ${name(s.seed)}`
      case 'processed':
        return `made from ${name(s.from)} at a ${s.at}`
      case 'butcher':
        return `from butchering ${ctx.text.name(s.species)}`
    }
  })
  const text = phrases.join('; or ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}

/* -------------------------------------------------------------------------
   Shared sections
   ------------------------------------------------------------------------- */

/** Species whose partner skill does one of `wants`, and the player's own. */
function PartnerSection({
  title,
  wants,
  spec,
  ctx,
  empty,
}: {
  title: string
  wants: readonly Want[]
  spec: SideSpec
  ctx: Ctx
  empty: string
}) {
  const held = speciesHeld(ctx.pals)
  const picks = breedablePicks(
    advisePassives(ctx.data.passives, spec),
    ctx.data.passives,
  )
  const species = bestPartners(ctx.data, ctx.pool, wants, TOP)
  const mine = ownedPartners(ctx.data, ctx.pals, ctx.where, wants, spec, MINE)

  return (
    <section className="mt-6 first:mt-0">
      <SectionHeading title={title} hint="partner skill at Lv 1" />
      {species.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">{empty}</p>
      ) : (
        <TwoLists
          left={species.map((r) => (
            <SpeciesRow
              key={r.id}
              id={r.id}
              ctx={ctx}
              held={held.has(r.id)}
              href={breedHref(ctx.index, ctx.ownerUid, r.id, picks)}
            >
              {r.effects.map((e) => (
                <Pill key={e.type} tone="signal">
                  {effectLabel(e)}
                </Pill>
              ))}
            </SpeciesRow>
          ))}
          right={
            <Owned
              rows={mine}
              ctx={ctx}
              wanted={spec}
              detail={(r) =>
                (r as (typeof mine)[number]).effects.map((e) => (
                  <Pill key={e.type} tone="signal">
                    {effectLabel(e)}
                  </Pill>
                ))
              }
              empty="This player has none of these."
            />
          }
        />
      )}
    </section>
  )
}

/** A partner effect without the "You:" a passive list needs to say. */
function effectLabel(e: Parameters<typeof effectText>[0]): string {
  return effectText(e).replace(/^You: /, '')
}

/** One section per ranch drop: who drops it, and the player's own. */
function ProducerSections({
  items,
  spec,
  ctx,
}: {
  items: { item: string }[]
  spec: SideSpec
  ctx: Ctx
}) {
  const held = speciesHeld(ctx.pals)
  const picks = breedablePicks(
    advisePassives(ctx.data.passives, spec),
    ctx.data.passives,
  )
  if (items.length === 0) {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        No pal in the data drops any of these at a Ranch.
      </p>
    )
  }
  return (
    <div className="space-y-6">
      {items.map(({ item }) => {
        const info = ctx.data.items[item]
        const species = ranchProducers(ctx.data, ctx.pool, item, TOP)
        const mine = ownedProducers(
          ctx.data,
          ctx.pals,
          ctx.where,
          item,
          spec,
          MINE,
        )
        return (
          <section key={item}>
            <CardTrigger
              as="div"
              card={{ kind: 'item', staticId: item }}
              className="mb-3 flex items-center gap-2"
            >
              <GameIcon path={info?.icon} name={info?.name ?? item} size={22} />
              <h2 className="label">{info?.name ?? item}</h2>
              <span className="text-xs text-[var(--color-muted)]">
                {count(species.length)} producer
                {species.length === 1 ? '' : 's'}
              </span>
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
                  <Pill tone="signal" title="Ranching level">
                    Lv {r.level}
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
                    <Pill tone="signal" title="Ranching level">
                      Lv {(r as (typeof mine)[number]).level}
                    </Pill>
                  )}
                  empty="This player has none that drop it."
                />
              }
            />
          </section>
        )
      })}
    </div>
  )
}

/** The cake tiers, for the rail. Each opens its item card. */
export function CakePicker({
  ctx,
  selected,
  onPick,
}: {
  ctx: Ctx
  selected: string
  onPick: (item: string) => void
}) {
  return (
    <div className="space-y-1">
      <div className="label">cake</div>
      {CAKES.map((c) => {
        const info = ctx.data.items[c.item.toLowerCase()]
        return (
          <ListRow
            key={c.item}
            selected={c.item === selected}
            onClick={() => onPick(c.item)}
            card={{ kind: 'item', staticId: c.item }}
          >
            <GameIcon path={info?.icon} name={info?.name ?? c.item} size={22} />
            <span className="min-w-0 flex-1 truncate text-xs">
              {info?.name ?? c.item}
            </span>
          </ListRow>
        )
      })}
    </div>
  )
}
