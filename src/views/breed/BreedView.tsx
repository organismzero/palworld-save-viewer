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
  planFor,
  type BreedingPlan,
  type BreedingTable,
  type Reach,
  type Stock,
} from '../../domain/breeding.ts'
import { busiestPlayer } from '../../domain/guild.ts'
import type { Guid, Pal, Player, SaveIndex } from '../../domain/types.ts'
import { count } from '../../lib/format.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { useViewParams } from '../../app/viewParams.ts'
import { saveCurrentPath, usePathsStore } from './pathsStore.ts'
import { canonicalPath, liveTicks, summarisePlan } from './savedPaths.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
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
  SegmentBar,
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
import { reachFor, stockFor, tableFor } from './stockCache.ts'
import { usePassiveSearch, type PassiveSearch } from './usePassiveSearch.ts'
import { passiveText, type PassiveText } from './passiveText.ts'
import { speciesText, type SpeciesText } from './speciesText.ts'
import {
  filterSpecies,
  speciesFiltered,
  type SpeciesFilter,
  type SpeciesRow,
} from './speciesFilter.ts'
import { ElementToggles } from '../../components/ElementToggles.tsx'
import { ownerText, type OwnerText } from './ownerText.ts'
import { PoolPicker } from './PoolPicker.tsx'
import {
  BREED_DEFAULTS,
  breedCodec,
  type BreedMode,
  type BreedParams,
} from './params.ts'
import { PairPicker } from './PairPicker.tsx'
import { PairPane } from './PairPane.tsx'

const MODES: { id: BreedMode; label: string }[] = [
  { id: 'plan', label: 'Plan a target' },
  { id: 'pair', label: 'Pick a pair' },
]

/** Stable, so pair mode hands the passive search the same nothing every render. */
const NO_PASSIVES: string[] = []

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
  const table = tableFor(data?.breeding)
  // Looked up rather than memoised: the stock is keyed on identity by
  // everything downstream — the reach and the passive search both — and a memo
  // dies with the view, which is unmounted on every tab switch. `stockFor`
  // returns the same object for the same save and settings however many times
  // the view has come and gone. See `stockCache.ts`.
  const stock = stockFor(index, table, {
    ownerUid,
    assumeUnknownGender: params.assumeUnknownGender,
    includeGuild: params.includeGuild,
    includeBase: params.includeBase,
    includeMembers: params.includeMembers,
  })
  const owner = useMemo(() => ownerText(index, ownerUid), [index, ownerUid])
  const pairMode = params.mode === 'pair'
  // The expensive one, and the reason for the memo split. Pair mode still pays
  // for it: the rail's "species reachable" tile is shared by both modes.
  const reach = table ? reachFor(stock, table) : undefined
  // The search is keyed on the stock and the passive set, not on the target, so
  // clicking through the species list still costs only the plan. It runs in a
  // worker because it takes seconds at four passives — see `search.worker.ts`.
  const search = usePassiveSearch(
    stock,
    data?.breeding,
    pairMode ? NO_PASSIVES : params.passives,
  )

  // A linked parent that is not in the pool as it stands — another player
  // picked, a guildmate unpooled — is no parent. Derived rather than cleared, so
  // pooling them back in brings the pair back.
  const inStock = (uid: Guid | undefined) => {
    const pal = uid ? index.palById.get(uid) : undefined
    const entry = pal && stock.bySpecies.get(pal.characterId.toLowerCase())
    if (!pal || !entry) return undefined
    return [...entry.male, ...entry.female, ...entry.unknown].includes(pal)
      ? pal
      : undefined
  }
  const pairA = inStock(params.pairA)
  const pairB = inStock(params.pairB)

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
      params.noSpares,
    )
  }, [
    table,
    reach,
    stock,
    params.target,
    params.route,
    params.passives.length,
    params.noSpares,
    search.reach,
  ])

  // The saved path this is, if it is one — for keeping its summary current and
  // for the ticks on its steps.
  const paths = usePathsStore((s) => s.paths)
  const setProgress = usePathsStore((s) => s.setProgress)
  const tickStep = usePathsStore((s) => s.tick)
  const currentPath = useMemo(
    () => canonicalPath(params, index),
    [params, index],
  )
  const savedPath = currentPath && paths.find((p) => p.qs === currentPath.qs)
  // While a passive search is running, called off or failed, `plan` is the
  // species-only route standing in for the real one. Recording that would
  // overwrite a path's summary with a route nobody asked for, and drop every
  // tick, since none of its steps carry anything.
  const settled =
    !pairMode && (params.passives.length === 0 || search.reach !== undefined)
  const savedAt = index.meta.savedAtTicks
  useEffect(() => {
    if (!savedPath || !plan || !settled) return
    const ticks =
      plan.status === 'plan'
        ? liveTicks(plan, savedPath.ticks ?? [])
        : (savedPath.ticks ?? [])
    setProgress(
      savedPath.id,
      summarisePlan(plan, ticks, savedAt, savedPath.summary),
      ticks,
    )
  }, [savedPath, plan, settled, savedAt, setProgress])

  // Reference data loaded, but its breeding section did not. That fetch is the
  // one allowed to fail on its own, so this is a real state rather than a guard.
  const noBreedingData = data !== undefined && table === undefined

  return (
    <div className="flex h-full">
      <aside className="w-[var(--rail-width)] shrink-0 space-y-5 overflow-y-auto border-r border-[var(--color-line)] p-4">
        <SegmentBar
          name="breed-mode"
          tabs={MODES}
          value={params.mode}
          onChange={(v) => patch({ mode: v as BreedMode })}
          panelId="breed-panel"
        />
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
              : !stock.guild
                ? 'Only this player’s pals are used. They are in no guild, so there is nothing else to pool.'
                : stock.includedBase || stock.includedMembers.size > 0
                  ? 'This player’s pals, plus the ones ticked below.'
                  : 'Only this player’s pals are used. Tick anyone below to widen it.'}
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
          // Every one of these clears a pinned route, as the player picker
          // does: a different stock can make the pinned pair no longer one of
          // the shortest.
          onPool={(next) => patch({ ...next, route: undefined })}
        />
      </aside>

      {/* A flex column rather than the fixed `calc` the list used to size
          itself with: the picker above it has no fixed height. */}
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-[var(--color-line)]">
        {pairMode ? (
          <PairPicker
            // Remounted per player, so the active slot and the search box
            // start fresh rather than carrying over into a different palbox.
            key={ownerUid}
            stock={stock}
            a={pairA}
            b={pairB}
            assumeUnknownGender={params.assumeUnknownGender}
            text={text}
            passives={passives}
            owner={owner}
            onPick={(slot, pal) =>
              patch(
                slot === 'a'
                  ? { pairA: pal?.instanceId }
                  : { pairB: pal?.instanceId },
              )
            }
          />
        ) : (
          <>
            <div className="space-y-4 p-4 pb-3">
              <TextInput
                label="what to breed"
                value={params.query}
                onChange={(v) => patch({ query: v })}
                placeholder="Search species"
              />
              <PassivePicker
                selected={params.passives}
                noSpares={params.noSpares}
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
                // And so can a different requirement: it selects a different goal
                // state, which has its own cheapest route.
                onNoSpares={(next) =>
                  patch({ noSpares: next, route: undefined })
                }
              />
            </div>
            <SpeciesList
              index={index}
              table={table}
              reach={reach}
              filter={{
                query: params.query,
                elements: new Set(params.listElements),
                reachable: params.listReachable,
                unowned: params.listUnowned,
                sort: params.listSort,
              }}
              onFilter={(f) =>
                patch({
                  listElements: [...f.elements].sort(),
                  listReachable: f.reachable,
                  listUnowned: f.unowned,
                  listSort: f.sort,
                })
              }
              selected={params.target}
              onPick={(id) => patch({ target: id, route: undefined })}
              text={text}
            />
          </>
        )}
      </aside>

      <div
        id="breed-panel"
        role="tabpanel"
        className="flex-1 overflow-y-auto p-6"
      >
        <SavePath params={params} index={index} data={data} />
        {pairMode ? (
          noBreedingData ? (
            <Missing what="Breeding data could not be loaded, so what a pair hatches cannot be worked out. Everything else in the app still works." />
          ) : !pairA || !pairB || !table ? (
            <Missing
              what={
                pairA || pairB
                  ? 'Now pick the second parent on the left.'
                  : 'Pick two pals on the left to see what they would hatch, best first.'
              }
            />
          ) : (
            <PairPane
              a={pairA}
              b={pairB}
              table={table}
              data={data}
              purpose={params.purpose}
              onPurpose={(purpose) => patch({ purpose })}
              assumeUnknownGender={params.assumeUnknownGender}
              text={text}
              passives={passives}
              owner={owner}
            />
          )
        ) : noBreedingData ? (
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
            search={search}
            ticks={savedPath && settled ? (savedPath.ticks ?? []) : undefined}
            onTick={(key, done) => {
              if (savedPath) tickStep(savedPath.id, key, done)
            }}
            routeIndex={activeRoute(plan, params)}
            onRoute={(i) => patch({ route: plan.options[i] })}
            onDropNoSpares={() => patch({ noSpares: false, route: undefined })}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Keeps what the view is showing, so it can be come back to.
 *
 * Here as well as in the tray because this is where the wish to keep something
 * arrives: on looking at a route that is going to take a week. Once kept, the
 * same spot leads to the list, which is the only other thing worth doing with
 * a path that is already saved.
 */
function SavePath({
  params,
  index,
  data,
}: {
  params: BreedParams
  index: SaveIndex
  data: Refdata | undefined
}) {
  const paths = usePathsStore((s) => s.paths)
  const setTray = useUiStore((s) => s.setTray)
  const current = useMemo(() => canonicalPath(params, index), [params, index])
  const saved = current && paths.find((p) => p.qs === current.qs)
  // Arriving at a saved path by any road — Back, a pasted link, clicking the
  // same things again — makes it the one being worked on, so that the next
  // change is offered as an update to *it* and not to whichever was opened last.
  const setActive = usePathsStore((s) => s.setActive)
  const savedId = saved?.id
  useEffect(() => {
    if (savedId) setActive(savedId)
  }, [savedId, setActive])
  if (!current) return null

  return (
    <div className="mx-auto mb-3 flex max-w-3xl items-center justify-end gap-2">
      {saved && (
        <span className="label min-w-0 truncate">saved as {saved.name}</span>
      )}
      <Button
        size="sm"
        onClick={() =>
          saved
            ? setTray({ open: true, tab: 'paths' })
            : saveCurrentPath(params, index, data)
        }
        title={
          saved
            ? 'Open the tray’s list of saved paths'
            : 'Keep this target, its passives and whose pals to use, to come back to'
        }
      >
        {saved ? 'Saved paths' : 'Save path'}
      </Button>
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
  search,
  ticks,
  onTick,
  routeIndex,
  onRoute,
  onDropNoSpares,
}: {
  plan: BreedingPlan
  player: Player | undefined
  stock: Stock
  text: SpeciesText
  passives: PassiveText
  owner: OwnerText
  search: PassiveSearch
  /** The saved path's ticked steps. Absent when this is not a saved path. */
  ticks: readonly string[] | undefined
  onTick: (key: string, done: boolean) => void
  routeIndex: number
  onRoute: (i: number) => void
  onDropNoSpares: () => void
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
        <CardTrigger card={{ kind: 'species', id: plan.target }} focusable>
          <GameIcon
            path={text.icon(plan.target)}
            name={plan.target}
            elementName={text.element(plan.target)}
            size={56}
          />
        </CardTrigger>
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
                      title={
                        plan.wanted?.length
                          ? 'Hatches to expect, not eggs that have to go right. Most will not carry the passives you asked for.'
                          : 'Hatches to expect, not eggs that have to go right. The extra ones are for getting the sex a later step needs.'
                      }
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
            {player &&
              (stock.includedGuild ? (
                <span className="label normal-case">
                  from all of {guildLabel(stock)}’s pals
                </span>
              ) : (
                <CardTrigger
                  card={{ kind: 'player', uid: player.playerUid }}
                  focusable
                  className="label normal-case"
                >
                  from {player.name}’s pals
                </CardTrigger>
              ))}
          </div>
        </div>
      </header>

      <PassiveHeader
        plan={plan}
        stock={stock}
        passives={passives}
        search={search}
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
            ticks={ticks}
            onTick={onTick}
          />
        </>
      ) : (
        <NoRoute
          plan={plan}
          stock={stock}
          text={text}
          onDropNoSpares={onDropNoSpares}
        />
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
  search,
}: {
  plan: BreedingPlan
  stock: Stock
  passives: PassiveText
  search: PassiveSearch
}) {
  const { pending, failed, stopped } = search
  const missing = plan.missingPassives ?? []
  const ignored = plan.ignoredPassives ?? []
  /** What the search actually planned for, as against what was asked. */
  const planned = plan.wanted ?? []
  // Only a search long enough to have been noticed is worth timing out loud.
  const took =
    search.ms !== undefined && search.ms >= 1000
      ? `${(search.ms / 1000).toFixed(1)} s`
      : undefined
  const truncated = plan.truncated === true
  if (
    !pending &&
    !failed &&
    !stopped &&
    !truncated &&
    took === undefined &&
    missing.length === 0 &&
    ignored.length === 0
  ) {
    return null
  }

  const names = (ids: string[]) => ids.map((id) => passives.name(id)).join(', ')

  return (
    <Panel
      padded
      className="space-y-1.5 text-[11px] leading-relaxed text-[var(--color-muted)]"
    >
      {pending && (
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1">
            Working out a route that carries those passives. Four of them can
            take ten seconds or so — the plan below is the species route until
            it lands.
          </p>
          <Button size="sm" onClick={search.cancel}>
            Cancel
          </Button>
        </div>
      )}
      {stopped && (
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1">
            The passive search was cancelled, so this is the species route only.
          </p>
          <Button size="sm" onClick={search.retry}>
            Search again
          </Button>
        </div>
      )}
      {/* Said here rather than at the foot of the page: it qualifies the route
          on screen, and a qualification three paragraphs below what it
          qualifies is one nobody reads. */}
      {truncated && (
        <p className="text-[var(--color-gold)]">
          This search hit its budget before it had looked everywhere, so a
          better route than this one may exist.
        </p>
      )}
      {took !== undefined && !pending && (
        <p>
          The passive search took {took}. It is kept, so coming back is instant.
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
          {/* Where each one actually comes from, derived from upstream's own
              flags rather than typed in. This is the difference between "go and
              grind" and "grinding cannot work" — a mutation-only passive will
              never appear on an ordinary hatch however many you sit through. */}
          <ul className="space-y-1">
            {missing.map((id) => (
              <li key={id}>
                <span className="text-[var(--color-gold)]">
                  {passives.name(id)}
                </span>
                {passives.origin(id) ? <> — {passives.origin(id)}</> : null}
              </li>
            ))}
          </ul>
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
  onDropNoSpares,
}: {
  plan: BreedingPlan
  stock: Stock
  text: SpeciesText
  onDropNoSpares: () => void
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
        <>
          <p className="text-[var(--color-muted)]">
            {text.name(plan.target)} is reachable and something in this pool
            carries every passive still being planned for — but no route{' '}
            {plan.noSpares
              ? 'lands them all on one pal with nothing else alongside'
              : 'lands them all together'}{' '}
            inside <span className="num">{MAX_EXPECTED_EGGS}</span> expected
            hatches, which is where a plan stops being advice. Asking for fewer
            at once, or finding a cleaner carrier, is the way in: every
            unrelated passive on a parent competes for the child’s four slots.
            {!plan.noSpares && <PoolHint stock={stock} />}
          </p>
          {/* The trade, priced. Demanding a clean result costs two to seven
              times as much, and whether a free slot is worth that is not a
              decision this can make for anyone — so it shows the number and
              offers the switch rather than choosing. */}
          {plan.relaxed && (
            <p className="text-[var(--color-muted)]">
              Dropping “and nothing else” gets there in{' '}
              <span className="num">{plan.relaxed.eggs}</span>{' '}
              {plan.relaxed.eggs === 1 ? 'egg' : 'eggs'} and about{' '}
              <span className="num">
                {Math.round(plan.relaxed.expectedEggs)}
              </span>{' '}
              hatches, finishing with a slot already spoken for.{' '}
              <Button size="sm" tone="signal" onClick={onDropNoSpares}>
                plan it without
              </Button>
            </p>
          )}
        </>
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
  onPool,
}: {
  stock: Stock
  owner: OwnerText
  reachable: number | undefined
  total: number | undefined
  onToggleUnknown: () => void
  onPool: (next: Partial<BreedParams>) => void
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
      {stock.guild && (
        <PoolPicker stock={stock} owner={owner} onPool={onPool} />
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
  filter,
  onFilter,
  selected,
  onPick,
  text,
}: {
  index: SaveIndex
  table: BreedingTable | undefined
  reach: Reach | undefined
  filter: SpeciesFilter
  onFilter: (next: SpeciesFilter) => void
  selected: string
  onPick: (id: string) => void
  text: SpeciesText
}) {
  const { data } = useRefdataStore()

  const all = useMemo(() => {
    const ids = table
      ? [...table.rank.keys()]
      : // Degraded: whatever this world contains, which is short but honest.
        [...new Set(index.pals.map((p) => p.characterId.toLowerCase()))]
    return ids.map((id) => ({
      id,
      name: text.name(id),
      // Absent `zukan` sorts last rather than being dropped, as the paldex
      // grid does — a species with no paldex slot is still breedable.
      zukan: data?.species[id]?.zukan ?? Number.MAX_SAFE_INTEGER,
      elements: text.elements(id),
      depth: reach?.depth.get(id),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, reach, data, index.pals])
  const rows = filterSpecies(all, filter)
  const check = 'gap-2 text-xs text-[var(--color-muted)]'

  return (
    <>
      <div className="space-y-2 px-4 pb-3">
        <ElementToggles
          size={18}
          value={filter.elements}
          onChange={(elements) => onFilter({ ...filter, elements })}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <Checkbox
            checked={filter.reachable}
            onChange={(reachable) => onFilter({ ...filter, reachable })}
            label="reachable"
            className={check}
          />
          <Checkbox
            checked={filter.unowned}
            onChange={(unowned) => onFilter({ ...filter, unowned })}
            label="not held"
            className={check}
          />
          <Checkbox
            checked={filter.sort === 'gen'}
            onChange={(on) =>
              onFilter({ ...filter, sort: on ? 'gen' : 'paldex' })
            }
            label="nearest first"
            className={check}
          />
        </div>
        {(filter.query.trim() !== '' || speciesFiltered(filter)) && (
          <p className="text-[11px] text-[var(--color-muted)]">
            {count(rows.length)} of {count(all.length)} species
          </p>
        )}
      </div>
      <SpeciesRows
        rows={rows}
        selected={selected}
        onPick={onPick}
        text={text}
      />
    </>
  )
}

function SpeciesRows({
  rows,
  selected,
  onPick,
  text,
}: {
  rows: SpeciesRow[]
  selected: string
  onPick: (id: string) => void
  text: SpeciesText
}) {
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
          card={{ kind: 'species', id: r.id }}
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
function Footnote({ stock, plan }: { stock: Stock; plan?: BreedingPlan }) {
  return (
    <section className="border-t border-[var(--color-line-faint)] pt-4 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <p>
        {stock.countedOwn === stock.counted ? (
          <>
            Counted {count(stock.counted)} pals across{' '}
            {count(stock.bySpecies.size)} species that this player owns. Nobody
            else’s are counted.
          </>
        ) : (
          <>
            Counted {count(stock.counted)} pals across{' '}
            {count(stock.bySpecies.size)} species — {count(stock.countedOwn)}{' '}
            this player’s, {count(stock.countedBorrowed)} from{' '}
            {stock.includedGuild
              ? `all of ${guildLabel(stock)}`
              : `${count(stock.includedMembers.size)} pooled ${stock.includedMembers.size === 1 ? 'guildmate' : 'guildmates'}`}
            , and {count(stock.countedUnowned)} owned by nobody. A route through
            someone else’s pal needs them to put it in the pen.
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
        {stock.includedBase
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
        A pair is a male and a female, and a hatch is taken as an even coin flip
        between them. So an egg that has to come out one particular sex, to pair
        with a pal you hold in one sex only or with another you are breeding,
        counts as two hatches where it would be one; and an egg that is then
        paired with its own kind counts as three, the first and two more on
        average for the other sex.
        {plan?.genderEggs
          ? ` That is ${count(Math.round(plan.genderEggs))} of this plan’s hatches.`
          : ''}{' '}
        The route itself is still the one with the fewest eggs; sex only changes
        the estimate. Breeding does not consume the parents. Eggs already
        sitting in storage are items rather than pals, and are not counted.
      </p>
      <p className="mt-2">
        This plan is worked out from the save as you loaded it, and breeding
        changes what you hold. A hatch that comes out better than the step asked
        for can make later steps unnecessary — so save and reload after each
        generation, and the route will shorten around what you actually got.
        Between loads, a saved path lets you tick each step off as you hatch it;
        a tick is dropped once a newer save no longer has that step.
      </p>
      <p className="mt-2">
        “IVs to expect” is the average a step’s hatches come to, worked down
        from the pals each step names. It is a model: a child is taken to
        inherit one, two or three of its IVs with weights of three, two and one,
        each from either parent with an even chance, and to roll the rest fresh
        from 0 to 100. Hatch a step more than once and keep the best, and you
        will beat it.
      </p>
      {plan?.wanted && plan.wanted.length > 0 && (
        <p className="mt-2">
          A child’s passives are drawn from its parents’ combined list, and how
          many it takes is a roll. Those odds are not in the save, and not in
          the game’s own exported tables either — they are community reverse
          engineering, so read “≈{Math.round(plan.expectedEggs ?? 0)} hatches”
          as an order of magnitude rather than a promise. It is the pessimistic
          end: the two parents’ other passives are assumed not to overlap, a
          random fill is never counted as one you wanted, and breeding cakes are
          not modelled at all — each of which makes the real thing a little
          kinder than the number.
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
