/**
 * Breeding paths, from one player's own pals.
 *
 * ## The question this answers, exactly
 *
 * "What do *I* pair to get that?" — where "I" is one player and their palbox is
 * the only stock on the table, because a route through a guildmate's pal is not
 * one they can walk alone. The guild toggle asks the other question, "what could
 * *we* pair?", and it is off by default: the wider answer is only useful if you
 * can see which pals are not yours, so every borrowed parent is named in the step
 * list and counted in the footnote.
 *
 * ## Why the plan is the middle pane
 *
 * Every other view puts the data in the middle and a detail panel on the right.
 * Here the *answer* is the artefact: the selectors are the query and the plan is
 * the result, so the plan gets the room and the pickers get the rails.
 *
 * Reachability is computed once per player, not per target. That split is what
 * makes clicking through the species list feel instant: the closure measures
 * 70–85 ms on a real save and does not depend on what you are looking for,
 * while planning one target against it is 5–8 ms.
 */

import { useEffect, useMemo } from 'react'

import {
  buildBreedingTable,
  buildStock,
  planFor,
  reachFrom,
  type BreedingPlan,
  type Stock,
} from '../../domain/breeding.ts'
import type { Pal, Player, SaveIndex } from '../../domain/types.ts'
import { count } from '../../lib/format.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { useViewParams } from '../../app/viewParams.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import {
  Field,
  Panel,
  Pill,
  RawId,
  SectionHeading,
  StatTile,
} from '../../components/primitives.tsx'
import {
  Button,
  Checkbox,
  ListRow,
  SelectControl,
  TextInput,
} from '../../components/controls.tsx'
import {
  MAX_EXPECTED_EGGS,
  planWithPassives,
} from '../../domain/passiveBreeding.ts'
import { carrierCounts } from '../../domain/passives.ts'
import { PlanSteps } from './PlanSteps.tsx'
import { PassivePicker } from './PassivePicker.tsx'
import { usePassiveSearch } from './usePassiveSearch.ts'
import { passiveText, type PassiveText } from './passiveText.ts'
import { speciesText, type SpeciesText } from './speciesText.ts'
import { ownerText, type OwnerText } from './ownerText.ts'
import { BREED_DEFAULTS, breedCodec, type BreedParams } from './params.ts'

export function BreedView({ index }: { index: SaveIndex }) {
  const { data, status, ensure } = useRefdataStore()
  useEffect(() => {
    void ensure()
  }, [ensure])

  const focus = useUiStore((s) => s.focus)
  const clearFocus = useUiStore((s) => s.clearFocus)
  useEffect(clearFocus, [clearFocus])

  const codec = useMemo(() => breedCodec(index), [index])
  const [params, setParams] = useViewParams(
    'breed',
    BREED_DEFAULTS,
    codec,
    () => (focus?.kind === 'player' ? { playerUid: focus.id } : undefined),
  )
  const patch = (p: Partial<BreedParams>) =>
    setParams((prev) => ({ ...prev, ...p }))

  const text = speciesText(data)
  const passives = passiveText(data)

  // A default that keeps the view from opening blank, but stays out of the URL
  // — only a choice the user made is worth sending anyone.
  const fallback = useMemo(() => busiestPlayer(index), [index])
  const player = params.playerUid
    ? index.playerByUid.get(params.playerUid)
    : fallback
  const ownerUid = player?.playerUid

  // An empty projection means the breeding fetch failed — `slimBreeding` yields
  // empty rather than throwing, so emptiness is the signal, not absence.
  const table = useMemo(() => {
    const raw = data?.breeding
    if (!raw || Object.keys(raw.pals).length === 0) return undefined
    return buildBreedingTable(raw)
  }, [data])
  const stock = useMemo(
    () =>
      buildStock(index, table, ownerUid, {
        assumeUnknownGender: params.assumeUnknownGender,
        includeGuild: params.includeGuild,
      }),
    [index, table, ownerUid, params.assumeUnknownGender, params.includeGuild],
  )
  const owner = useMemo(() => ownerText(index, ownerUid), [index, ownerUid])
  // The expensive one, and the reason for the memo split.
  const reach = useMemo(
    () => (table ? reachFrom(stock, table) : undefined),
    [table, stock],
  )
  // The search is keyed on the stock and the passive set, not on the target, so
  // clicking through the species list still costs only the plan. It runs in a
  // worker because it takes seconds at four passives — see `search.worker.ts`.
  const search = usePassiveSearch(stock, data?.breeding, params.passives)

  // Who in this pool carries what, for the picker's marks. Cheap, and needed
  // whether or not a search has finished.
  const carriers = useMemo(() => {
    const pals: Pal[] = []
    for (const entry of stock.bySpecies.values()) {
      pals.push(...entry.male, ...entry.female, ...entry.unknown)
    }
    return carrierCounts(pals)
  }, [stock])

  const plan = useMemo(() => {
    if (!params.target) return undefined
    // Nothing asked for, or the answer is not in yet: the species plan is the
    // honest thing to show, and it is what the passive planner would return
    // anyway once it had nothing to add.
    if (params.passives.length === 0 || !search.reach) {
      return planFor(table, reach, stock, params.target, params.route)
    }
    return planWithPassives(
      table,
      reach,
      search.reach,
      stock,
      params.target,
      params.route,
    )
  }, [
    table,
    reach,
    stock,
    params.target,
    params.route,
    params.passives.length,
    search.reach,
  ])

  // Reference data loaded, but its breeding section did not. That fetch is the
  // one allowed to fail on its own, so this is a real state rather than a guard.
  const noBreedingData = data !== undefined && table === undefined

  return (
    <div className="flex h-full">
      <aside className="w-[var(--rail-width)] shrink-0 space-y-5 overflow-y-auto border-r border-[var(--color-line)] p-4">
        <div>
          <SelectControl
            label="whose pals"
            value={ownerUid ?? ''}
            onChange={(v) => patch({ playerUid: v, route: undefined })}
            options={index.players.map((p) => ({
              value: p.playerUid,
              label: `${p.name} — ${count(index.palsByOwner.get(p.playerUid)?.length ?? 0)} pals`,
            }))}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
            {stock.includedGuild
              ? `All of ${guildLabel(stock)}’s pals are used, base workers included — not just this player’s.`
              : stock.guild
                ? 'Only this player’s pals are used. Guildmates’ pals are not counted.'
                : 'Only this player’s pals are used. They are in no guild, so there is nothing else to pool.'}
          </p>
        </div>

        <StockPanel
          stock={stock}
          owner={owner}
          reachable={reach?.depth.size}
          total={table?.rank.size}
          onToggleUnknown={() =>
            patch({ assumeUnknownGender: !params.assumeUnknownGender })
          }
          onToggleGuild={() =>
            // Clears a pinned route, as the player picker does: a different stock
            // can make the pinned pair no longer one of the shortest.
            patch({ includeGuild: !params.includeGuild, route: undefined })
          }
        />
      </aside>

      {/* A flex column rather than the fixed `calc` the list used to size
          itself with: the picker above it has no fixed height. */}
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-[var(--color-line)]">
        <div className="space-y-4 p-4 pb-3">
          <TextInput
            label="what to breed"
            value={params.query}
            onChange={(v) => patch({ query: v })}
            placeholder="Search species"
          />
          <PassivePicker
            selected={params.passives}
            carriers={carriers}
            text={passives}
            // The store's own status, not the shape of `data`. A failed fetch
            // never sets `data` at all — `loadRefdata` throws and the catch
            // sets `status` — so testing it for emptiness reads `false` in
            // exactly the case this is for, and the picker would offer a search
            // box that answers "no passive matches that" to every real name.
            // It is also the only test that separates degraded from still
            // loading, where `data` is equally undefined. `MapView` reads
            // `status` for its own degraded pill for both reasons.
            degraded={status === 'degraded'}
            // A different passive set can make the pinned pair no longer one of
            // the shortest, exactly as changing the stock can.
            onChange={(next) => patch({ passives: next, route: undefined })}
          />
        </div>
        <SpeciesList
          index={index}
          table={table}
          reach={reach}
          query={params.query}
          selected={params.target}
          onPick={(id) => patch({ target: id, route: undefined })}
          text={text}
        />
      </aside>

      <div className="flex-1 overflow-y-auto p-6">
        {noBreedingData ? (
          <Missing what="Breeding data could not be loaded, so no path can be worked out. Everything else in the app still works." />
        ) : !params.target ? (
          <Missing
            what={
              stock.includedGuild
                ? `Pick a species on the left to see how to breed it from all of ${guildLabel(stock)}’s pals.`
                : 'Pick a species on the left to see how to breed it from this player’s pals.'
            }
          />
        ) : !plan ? null : (
          <PlanPane
            plan={plan}
            player={player}
            stock={stock}
            text={text}
            passives={passives}
            owner={owner}
            pending={search.pending}
            failed={search.failed}
            routeIndex={activeRoute(plan, params)}
            onRoute={(i) => patch({ route: plan.options[i] })}
          />
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------
   The plan
   ------------------------------------------------------------------------- */

function PlanPane({
  plan,
  player,
  stock,
  text,
  passives,
  owner,
  pending,
  failed,
  routeIndex,
  onRoute,
}: {
  plan: BreedingPlan
  player: Player | undefined
  stock: Stock
  text: SpeciesText
  passives: PassiveText
  owner: OwnerText
  pending: boolean
  failed: boolean
  routeIndex: number
  onRoute: (i: number) => void
}) {
  // Split, because with the guild pooled in `ownedTarget` is guild-wide, and
  // "already have 3" would otherwise mean a guildmate has three of them.
  const mine = plan.ownedTarget.filter(
    (p) => p.ownerPlayerUid === stock.ownerUid,
  ).length
  const elsewhere = plan.ownedTarget.length - mine

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start gap-4">
        <GameIcon
          path={text.icon(plan.target)}
          name={plan.target}
          elementName={text.element(plan.target)}
          size={56}
        />
        <div className="min-w-0">
          <h2 className="text-2xl leading-tight">{text.name(plan.target)}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {plan.status === 'plan' && (
              <>
                <Pill tone="signal">
                  {plan.generations}{' '}
                  {plan.generations === 1 ? 'generation' : 'generations'}
                </Pill>
                <Pill>
                  {plan.steps.length} {plan.steps.length === 1 ? 'egg' : 'eggs'}
                </Pill>
                {plan.borrowed.length > 0 && (
                  <Pill
                    tone="warn"
                    title="Pals in this route that belong to someone else, or to nobody."
                  >
                    {plan.borrowed.length} borrowed
                  </Pill>
                )}
                {/* Two different numbers, and conflating them is the mistake
                    the footnote exists to prevent: the egg count is the route,
                    the hatch count is the evening. */}
                {plan.expectedEggs !== undefined &&
                  plan.expectedEggs > plan.steps.length + 0.5 && (
                    <Pill
                      tone="warn"
                      title="Hatches to expect, not eggs that have to go right. Most will not carry the passives you asked for."
                    >
                      ≈{Math.round(plan.expectedEggs)} hatches
                    </Pill>
                  )}
              </>
            )}
            {mine > 0 && <Pill tone="good">already have {count(mine)}</Pill>}
            {elsewhere > 0 && (
              <Pill tone="good">
                {count(elsewhere)} more in {guildLabel(stock)}
              </Pill>
            )}
            {player && (
              <span className="label normal-case">
                {stock.includedGuild
                  ? `from all of ${guildLabel(stock)}’s pals`
                  : `from ${player.name}’s pals`}
              </span>
            )}
          </div>
        </div>
      </header>

      <PassiveHeader
        plan={plan}
        stock={stock}
        passives={passives}
        pending={pending}
        failed={failed}
      />

      {plan.status === 'plan' ? (
        <>
          {plan.options.length > 1 && (
            <section>
              <div className="label mb-2">
                starting pair — {plan.options.length} routes tie for shortest
              </div>
              <div className="flex flex-wrap gap-1.5">
                {plan.options.map((o, i) => (
                  <Button
                    key={`${o.a}|${o.b}`}
                    size="sm"
                    tone={i === routeIndex ? 'signal' : 'default'}
                    onClick={() => onRoute(i)}
                    aria-current={i === routeIndex ? 'true' : undefined}
                  >
                    {text.name(o.a)} × {text.name(o.b)}
                  </Button>
                ))}
              </div>
            </section>
          )}
          <PlanSteps
            plan={plan}
            text={text}
            passives={passives}
            owner={owner}
          />
        </>
      ) : (
        <NoRoute plan={plan} stock={stock} text={text} />
      )}

      <Footnote stock={stock} plan={plan} />
    </div>
  )
}

/**
 * What the passive ask is doing to this plan.
 *
 * Three things worth saying and each of them only sometimes: that a search is
 * running, that one failed, and that some of what was asked for is not in the
 * pool at all. The last is the important one — a passive nobody holds is not a
 * routing problem, it is a "go and catch one" problem, and the difference is
 * the only actionable thing on the screen.
 */
function PassiveHeader({
  plan,
  stock,
  passives,
  pending,
  failed,
}: {
  plan: BreedingPlan
  stock: Stock
  passives: PassiveText
  pending: boolean
  failed: boolean
}) {
  const missing = plan.missingPassives ?? []
  const ignored = plan.ignoredPassives ?? []
  /** What the search actually planned for, as against what was asked. */
  const planned = plan.wanted ?? []
  if (!pending && !failed && missing.length === 0 && ignored.length === 0) {
    return null
  }

  const names = (ids: string[]) =>
    ids.map((id) => passives.name(id)).join(', ')

  return (
    <Panel padded className="space-y-1.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
      {pending && (
        <p>
          Working out a route that carries those passives. Four of them can take
          a few seconds — the plan below is the species route until it lands.
        </p>
      )}
      {failed && (
        <p>
          The passive search could not run, so this is the species route only.
          Everything else on the page is unaffected.
        </p>
      )}
      {missing.length > 0 && (
        <>
          <p>
            <span className="text-[var(--color-gold)]">{names(missing)}</span>{' '}
            {missing.length === 1 ? 'is' : 'are'} carried by nothing in this
            pool, so {missing.length === 1 ? 'it' : 'they'} cannot be{' '}
            <em>inherited</em> — a passive only ever comes down from a parent
            that already has it. The plan below is for{' '}
            {planned.length > 0 ? names(planned) : 'the species alone'}.
          </p>
          {/* The correction that matters. A hatch rolls random passives on top
              of what it inherits, so "no amount of breeding will produce it" —
              which this said — is simply false, and anyone who has hatched a
              dozen eggs has seen it be false. What is true is that it is a
              lottery rather than a route, which is why the planner will not
              plan it. */}
          <p>
            A hatch can still turn one up on its own: every egg rolls a few
            random passives on top of what it inherits, which is why pals arrive
            carrying things neither parent had. It is a lottery rather than a
            route — the odds are not in any published data — so the planner will
            not pretend to route it. To fish for one, pair two pals carrying as
            little as possible: random passives only land in the slots
            inheritance left empty. Once <em>one</em> pal has it, it is
            inheritable and this plan can carry it.
          </p>
          <p>
            Catching or trading for a carrier is the reliable way
            {/* Only worth suggesting when it is not already done — a hint that
                names something already switched on reads as a broken page. */}
            {!stock.includedGuild && stock.guild
              ? ', and pooling the guild’s pals in on the left may already have one'
              : ''}
            .
          </p>
        </>
      )}
      {ignored.length > 0 && (
        <p>
          A pal has four passive slots, so{' '}
          <span className="text-[var(--color-gold)]">{names(ignored)}</span>{' '}
          {ignored.length === 1 ? 'was' : 'were'} left out of the plan.
        </p>
      )}
    </Panel>
  )
}

/**
 * Why there is no route.
 *
 * Each reason gets its own wording because they call for different actions, and
 * a single "no path found" would hide the difference between "catch one more
 * species" and "this can never come out of a breeding pen".
 */
function NoRoute({
  plan,
  stock,
  text,
}: {
  plan: BreedingPlan
  stock: Stock
  text: SpeciesText
}) {
  if (plan.status === 'no-data') {
    return (
      <Missing what="Breeding data is not loaded, so no path can be worked out." />
    )
  }

  if (plan.status === 'not-in-data') {
    return (
      <Panel padded className="text-sm text-[var(--color-muted)]">
        The reference data has no species called <RawId>{plan.target}</RawId>,
        so there is nothing to plan. A link from a different version of the data
        would land here.
      </Panel>
    )
  }

  return (
    <Panel padded className="space-y-3 text-sm">
      {plan.reason === 'no-stock' && (
        <p className="text-[var(--color-muted)]">
          {stock.counted === 0
            ? stock.includedGuild
              ? `No pal in ${guildLabel(stock)} is one the breeding data recognises, so there is nothing to start from.`
              : 'This player owns no pals that the breeding data recognises, so there is nothing to start from.'
            : stock.includedGuild
              ? `Nothing in ${guildLabel(stock)} can form a legal pair — every species the guild holds is one gender only.`
              : 'None of this player’s pals can form a legal pair — every species they hold is one gender only.'}
          {stock.singleGender.length > 0 && (
            <> {count(stock.singleGender.length)} species are single-gender.</>
          )}
          <PoolHint stock={stock} />
        </p>
      )}

      {plan.reason === 'cross-species-impossible' && (
        <p className="text-[var(--color-muted)]">
          No pairing of two different species produces {text.name(plan.target)}{' '}
          — the breeding tables exclude it as a result, which is how the
          legendaries and a few unreleased species work. It still breeds true
          with itself, so the only route is to already hold a male and a female.
        </p>
      )}

      {plan.reason === 'needs-unique-parents' && (
        <>
          <p className="text-[var(--color-muted)]">
            {text.name(plan.target)} only comes from one specific pairing, and
            this player cannot reach it yet:
          </p>
          <ul className="space-y-1.5">
            {plan.blockers.map((b) => (
              <li key={`${b.pair.a}|${b.pair.b}`} className="text-sm">
                <span>
                  {text.name(b.pair.a)} × {text.name(b.pair.b)}
                </span>
                {b.missing.map((m) => (
                  <span
                    key={`${m.species}-${m.why}`}
                    className="ml-2 text-xs text-[var(--color-muted)]"
                  >
                    {m.why === 'unreachable'
                      ? `needs ${text.name(m.species)}, which they cannot breed or catch from what they have`
                      : `has both, but not in the right genders`}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="text-[var(--color-muted)]">
            <PoolHint stock={stock} />
          </p>
        </>
      )}

      {plan.reason === 'nothing-produces-it' && (
        <p className="text-[var(--color-muted)]">
          Nothing this player can reach pairs into {text.name(plan.target)}.
          Catching a species further along the ladder is the way in.
          <PoolHint stock={stock} />
        </p>
      )}

      {/* The species route exists — only the passives are out of reach. Said
          separately from the reasons above because the action is different:
          nothing about the ladder needs to change, only what is carried along
          it. Passives nobody carries are not this message's business — they
          never entered the search, and `PassiveHeader` names them whether a
          route was found or not. */}
      {plan.reason === 'passive-unreachable' && (
        <p className="text-[var(--color-muted)]">
          {text.name(plan.target)} is reachable and something in this pool
          carries every passive still being planned for — but no route lands
          them all together inside{' '}
          <span className="num">{MAX_EXPECTED_EGGS}</span> expected hatches,
          which is where a plan stops being advice. Asking for fewer at once, or
          finding a cleaner carrier, is the way in: every unrelated passive on a
          parent competes for the child’s four slots.
          <PoolHint stock={stock} />
        </p>
      )}
    </Panel>
  )
}

/**
 * The "have you tried the guild" nudge, in the three places it earns its keep.
 *
 * Silent when the guild is already pooled, or when there is no guild to pool —
 * suggesting a control that is already on is worse than saying nothing.
 */
function PoolHint({ stock }: { stock: Stock }) {
  if (stock.includedGuild || !stock.guild) return null
  return (
    <>
      {' '}
      Their guild’s pals are not counted. Pooling them in, on the left, may open
      a pairing this player cannot make alone.
    </>
  )
}

/* -------------------------------------------------------------------------
   Rails
   ------------------------------------------------------------------------- */

function StockPanel({
  stock,
  owner,
  reachable,
  total,
  onToggleUnknown,
  onToggleGuild,
}: {
  stock: Stock
  owner: OwnerText
  reachable: number | undefined
  total: number | undefined
  onToggleUnknown: () => void
  onToggleGuild: () => void
}) {
  return (
    <div className="space-y-3">
      <SectionHeading
        title={stock.includedGuild ? 'the guild’s stock' : 'their stock'}
      />{' '}
      {/* prettier-ignore */}
      <StatTile
        label="species reachable"
        value={
          reachable !== undefined && total !== undefined
            ? `${reachable} / ${total}`
            : '—'
        }
        accent
        hint="including the ones they already hold"
      />
      <Panel className="px-3 py-1">
        <Row label="pals counted" value={count(stock.counted)} />
        {stock.includedGuild && (
          <>
            <Row label="theirs" value={count(stock.countedOwn)} />
            <Row label="guildmates’" value={count(stock.countedBorrowed)} />
            {stock.countedUnowned > 0 && (
              <Row label="unowned" value={count(stock.countedUnowned)} />
            )}
          </>
        )}
        <Row label="species held" value={count(stock.bySpecies.size)} />
        <Row label="single gender" value={count(stock.singleGender.length)} />
        {stock.skippedUnknownSpecies > 0 && (
          <Row
            label="species not in data"
            value={count(stock.skippedUnknownSpecies)}
          />
        )}
      </Panel>
      {/* `checked` is read off the stock, not off the params, so a flag the
          domain refused to honour — no guild, or a bookkeeping Organization —
          cannot render as ticked. */}
      {stock.guild && (
        <Checkbox
          checked={stock.includedGuild}
          onChange={onToggleGuild}
          className="items-start text-[11px] leading-relaxed text-[var(--color-muted)]"
          label={
            <span>
              Pool all {count(stock.guild.palCount)} of {guildLabel(stock)}’s
              pals, base workers included. Off by default — a pal a guildmate
              holds is one you have to go and ask for.
            </span>
          }
        />
      )}
      {stock.includedGuild && stock.byOwner.size > 1 && (
        <div>
          <div className="label mb-1.5">who is contributing</div>
          <Panel className="px-3 py-1">
            {[...stock.byOwner]
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .map(([uid, n]) => (
                <Row key={uid} label={owner.name(uid)} value={count(n)} />
              ))}
            {stock.countedUnowned > 0 && (
              <Row label="no owner" value={count(stock.countedUnowned)} />
            )}
          </Panel>
        </div>
      )}
      {stock.skippedNoGender > 0 && (
        <Checkbox
          checked={stock.assumedUnknownGender}
          onChange={onToggleUnknown}
          className="items-start text-[11px] leading-relaxed text-[var(--color-muted)]"
          label={
            <span>
              Count the {count(stock.skippedNoGender)} pals whose gender this
              save does not record, splitting them evenly. Off by default — it
              invents data.
            </span>
          }
        />
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return <Field label={label} value={value} className="last:border-b-0" />
}

/**
 * Every species, in paldex order, badged with how far away it is.
 *
 * 304 rows, so no virtualiser: this repo reaches for one at a thousand and up,
 * and a plain scroller keeps the selected-row behaviour simple.
 */
function SpeciesList({
  index,
  table,
  reach,
  query,
  selected,
  onPick,
  text,
}: {
  index: SaveIndex
  table: ReturnType<typeof buildBreedingTable> | undefined
  reach: ReturnType<typeof reachFrom> | undefined
  query: string
  selected: string
  onPick: (id: string) => void
  text: SpeciesText
}) {
  const { data } = useRefdataStore()

  const rows = useMemo(() => {
    const ids = table
      ? [...table.rank.keys()]
      : // Degraded: whatever this world contains, which is short but honest.
        [...new Set(index.pals.map((p) => p.characterId.toLowerCase()))]
    const q = query.trim().toLowerCase()
    return ids
      .filter(
        (id) => !q || id.includes(q) || text.name(id).toLowerCase().includes(q),
      ) // prettier-ignore
      .map((id) => ({
        id,
        name: text.name(id),
        // Absent `zukan` sorts last rather than being dropped, as the paldex
        // grid does — a species with no paldex slot is still breedable.
        zukan: data?.species[id]?.zukan ?? Number.MAX_SAFE_INTEGER,
        depth: reach?.depth.get(id),
      }))
      .sort((a, b) => a.zukan - b.zukan || a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, reach, query, data, index.pals])

  return (
    // `flex-1` inside the rail's flex column, not a hardcoded `calc` of the
    // header's height: the passive picker above this grows and shrinks with the
    // selection, so there is no fixed number to subtract. `min-h-0` is what lets
    // a flex child actually scroll rather than stretch its parent.
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {rows.map((r) => (
        <ListRow
          key={r.id}
          selected={r.id === selected}
          onClick={() => onPick(r.id)}
        >
          <GameIcon
            path={text.icon(r.id)}
            name={r.id}
            elementName={text.element(r.id)}
            size={26}
          />
          <span className="min-w-0 flex-1 truncate text-xs">{r.name}</span>
          {r.depth === 0 ? (
            <Pill tone="good">owned</Pill>
          ) : r.depth !== undefined ? (
            <Pill tone="signal">{r.depth} gen</Pill>
          ) : null}
        </ListRow>
      ))}
      {rows.length === 0 && (
        <p className="px-2 py-3 text-xs text-[var(--color-muted)]">
          Nothing matches that.
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------
   The assumptions, said out loud
   ------------------------------------------------------------------------- */

/**
 * The footnote is not decoration.
 *
 * Every sentence here describes a way the plan could be optimistic, or whose pals
 * it is being optimistic about. A player who did not know them would read a
 * two-generation route as two eggs rather than as "at least two, probably more",
 * or a pooled route as one they can walk tonight.
 */
function Footnote({
  stock,
  plan,
}: {
  stock: Stock
  plan?: BreedingPlan
}) {
  return (
    <section className="border-t border-[var(--color-line-faint)] pt-4 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <p>
        {stock.includedGuild ? (
          <>
            Counted {count(stock.counted)} pals across{' '}
            {count(stock.bySpecies.size)} species from all of{' '}
            {guildLabel(stock)} — {count(stock.countedOwn)} this player’s,{' '}
            {count(stock.countedBorrowed)} other members’, and{' '}
            {count(stock.countedUnowned)} owned by nobody. A route through
            someone else’s pal needs them to put it in the pen.
          </>
        ) : (
          <>
            Counted {count(stock.counted)} pals across{' '}
            {count(stock.bySpecies.size)} species that this player owns.
            Guildmates’ pals are not counted.
          </>
        )}
        {stock.skippedNoGender > 0 && (
          <>
            {' '}
            {count(stock.skippedNoGender)} of them have no gender recorded and{' '}
            {stock.assumedUnknownGender
              ? 'were counted anyway, at your request'
              : 'were left out'}
            .
          </>
        )}
        {stock.includedGuild
          ? stock.countedUnowned > 0 && (
              <>
                {' '}
                The {count(stock.countedUnowned)} with no recorded owner are
                base workers in shared storage, mostly — nobody has to hand
                those over.
              </>
            )
          : stock.unownedInWorld > 0 && (
              <>
                {' '}
                {count(stock.unownedInWorld)} pals in this world have no
                recorded owner, so they count for nobody.
              </>
            )}
      </p>
      <p className="mt-2">
        Offspring gender is a coin flip, so anything bred along the way is
        assumed available in either gender — expect more than one egg per step,
        and two of them for a step that pairs a species with itself. Breeding
        does not consume the parents. Eggs already sitting in storage are items
        rather than pals, and are not counted.
      </p>
      {plan?.wanted && plan.wanted.length > 0 && (
        <p className="mt-2">
          A child’s passives are drawn from its parents’ combined list, and how
          many it takes is a roll. Those odds are not in the save, and not in the
          game’s own exported tables either — they are community reverse
          engineering, so read “≈{Math.round(plan.expectedEggs ?? 0)} hatches” as
          an order of magnitude rather than a promise. It is the pessimistic end:
          the two parents’ other passives are assumed not to overlap, a random
          fill is never counted as one you wanted, and breeding cakes are not
          modelled at all — each of which makes the real thing a little kinder
          than the number.
          {plan.truncated && (
            <>
              {' '}
              This search also hit its budget, so a better route may exist that
              it did not reach.
            </>
          )}
        </p>
      )}
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

/**
 * The guild's name, or a stand-in.
 *
 * Guild names can be empty in a real save, which the Guild view also falls back
 * for — an unnamed guild is not a missing guild.
 */
function guildLabel(stock: Stock): string {
  return stock.guild?.name || 'this guild'
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

/** Which of the tied routes is showing, so the buttons can mark it. */
function activeRoute(plan: BreedingPlan, params: BreedParams): number {
  if (!params.route) return 0
  const i = plan.options.findIndex(
    (o) =>
      (o.a === params.route!.a && o.b === params.route!.b) ||
      (o.a === params.route!.b && o.b === params.route!.a),
  )
  return i === -1 ? 0 : i
}
