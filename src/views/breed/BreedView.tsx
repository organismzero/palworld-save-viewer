/**
 * Breeding paths, from one player's own pals.
 *
 * ## The question this answers, exactly
 *
 * "What do *I* pair to get that?" — where "I" is one player, and their palbox is
 * the only stock on the table. A route through a guildmate's pal is not one this
 * player can walk, so `buildStock` reads `palsByOwner` and nothing wider.
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
import type { Player, SaveIndex } from '../../domain/types.ts'
import { count } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'
import { useUiStore } from '../../store/uiStore.ts'
import { useViewParams } from '../../app/viewParams.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import {
  Panel,
  Pill,
  RawId,
  SectionHeading,
  StatTile,
} from '../../components/primitives.tsx'
import { PlanSteps } from './PlanSteps.tsx'
import { speciesText, type SpeciesText } from './speciesText.ts'
import { BREED_DEFAULTS, breedCodec, type BreedParams } from './params.ts'

export function BreedView({ index }: { index: SaveIndex }) {
  const { data, ensure } = useRefdataStore()
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
      }),
    [index, table, ownerUid, params.assumeUnknownGender],
  )
  // The expensive one, and the reason for the memo split.
  const reach = useMemo(
    () => (table ? reachFrom(stock, table) : undefined),
    [table, stock],
  )
  const plan = useMemo(
    () =>
      params.target
        ? planFor(table, reach, stock, params.target, params.route)
        : undefined,
    [table, reach, stock, params.target, params.route],
  )

  // Reference data loaded, but its breeding section did not. That fetch is the
  // one allowed to fail on its own, so this is a real state rather than a guard.
  const noBreedingData = data !== undefined && table === undefined

  return (
    <div className="flex h-[calc(100dvh-3.25rem)]">
      <aside className="w-64 shrink-0 space-y-5 overflow-y-auto border-r border-[var(--color-line)]/60 p-4">
        <div>
          <div className="label mb-2">whose pals</div>
          <select
            value={ownerUid ?? ''}
            onChange={(e) => patch({ playerUid: e.target.value, route: undefined })} // prettier-ignore
            className="w-full rounded-[6px] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-signal)]"
          >
            {index.players.map((p) => (
              <option key={p.playerUid} value={p.playerUid}>
                {p.name} —{' '}
                {count(index.palsByOwner.get(p.playerUid)?.length ?? 0)} pals
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
            Only this player’s pals are used. Guildmates’ pals are not counted.
          </p>
        </div>

        <StockPanel
          stock={stock}
          reachable={reach?.depth.size}
          total={table?.rank.size}
          onToggleUnknown={() =>
            patch({ assumeUnknownGender: !params.assumeUnknownGender })
          }
        />
      </aside>

      <aside className="w-72 shrink-0 overflow-hidden border-r border-[var(--color-line)]/60">
        <div className="p-4 pb-2">
          <div className="label mb-2">what to breed</div>
          <input
            value={params.query}
            onChange={(e) => patch({ query: e.target.value })}
            placeholder="Search species"
            className="w-full rounded-[6px] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-signal)]"
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
          <Missing what="Pick a species on the left to see how to breed it from this player’s pals." />
        ) : !plan ? null : (
          <PlanPane
            plan={plan}
            player={player}
            stock={stock}
            text={text}
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
  routeIndex,
  onRoute,
}: {
  plan: BreedingPlan
  player: Player | undefined
  stock: Stock
  text: SpeciesText
  routeIndex: number
  onRoute: (i: number) => void
}) {
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
          <h2 className="font-display text-2xl leading-tight">
            {text.name(plan.target)}
          </h2>
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
              </>
            )}
            {plan.ownedTarget.length > 0 && (
              <Pill tone="good">
                already have {count(plan.ownedTarget.length)}
              </Pill>
            )}
            {player && (
              <span className="label normal-case">
                from {player.name}’s pals
              </span>
            )}
          </div>
        </div>
      </header>

      {plan.status === 'plan' ? (
        <>
          {plan.options.length > 1 && (
            <section>
              <div className="label mb-2">
                starting pair — {plan.options.length} routes tie for shortest
              </div>
              <div className="flex flex-wrap gap-1.5">
                {plan.options.map((o, i) => (
                  <button
                    key={`${o.a}|${o.b}`}
                    type="button"
                    onClick={() => onRoute(i)}
                    aria-current={i === routeIndex ? 'true' : undefined}
                    className={cn(
                      'rounded-[6px] border px-2.5 py-1 text-xs transition-colors',
                      i === routeIndex
                        ? 'border-[var(--color-signal)] text-[var(--color-text)]'
                        : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-muted)]',
                    )}
                  >
                    {text.name(o.a)} × {text.name(o.b)}
                  </button>
                ))}
              </div>
            </section>
          )}
          <PlanSteps plan={plan} text={text} />
        </>
      ) : (
        <NoRoute plan={plan} stock={stock} text={text} />
      )}

      <Footnote stock={stock} />
    </div>
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
      <Panel className="px-4 py-3 text-sm text-[var(--color-muted)]">
        The reference data has no species called <RawId>{plan.target}</RawId>,
        so there is nothing to plan. A link from a different version of the data
        would land here.
      </Panel>
    )
  }

  return (
    <Panel className="space-y-3 px-4 py-3 text-sm">
      {plan.reason === 'no-stock' && (
        <p className="text-[var(--color-muted)]">
          {stock.counted === 0
            ? 'This player owns no pals that the breeding data recognises, so there is nothing to start from.'
            : 'None of this player’s pals can form a legal pair — every species they hold is one gender only.'}
          {stock.singleGender.length > 0 && (
            <>
              {' '}
              {count(stock.singleGender.length)} of their species are
              single-gender.
            </>
          )}
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
        </>
      )}

      {plan.reason === 'nothing-produces-it' && (
        <p className="text-[var(--color-muted)]">
          Nothing this player can reach pairs into {text.name(plan.target)}.
          Catching a species further along the ladder is the way in.
        </p>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------
   Rails
   ------------------------------------------------------------------------- */

function StockPanel({
  stock,
  reachable,
  total,
  onToggleUnknown,
}: {
  stock: Stock
  reachable: number | undefined
  total: number | undefined
  onToggleUnknown: () => void
}) {
  return (
    <div className="space-y-3">
      <SectionHeading title="their stock" />
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
      <Panel className="divide-y divide-[var(--color-line)]/40 text-xs">
        <Row label="pals counted" value={count(stock.counted)} />
        <Row label="species held" value={count(stock.bySpecies.size)} />
        <Row label="single gender" value={count(stock.singleGender.length)} />
        {stock.skippedUnknownSpecies > 0 && (
          <Row
            label="species not in data"
            value={count(stock.skippedUnknownSpecies)}
          />
        )}
      </Panel>

      {stock.skippedNoGender > 0 && (
        <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={stock.assumedUnknownGender}
            onChange={onToggleUnknown}
            className="mt-0.5 accent-[var(--color-signal)]"
          />
          <span>
            Count the {count(stock.skippedNoGender)} pals whose gender this save
            does not record, splitting them evenly. Off by default — it invents
            data.
          </span>
        </label>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <span className="label">{label}</span>
      <span className="num text-[var(--color-muted)]">{value}</span>
    </div>
  )
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
    <div className="h-[calc(100%-5.5rem)] overflow-y-auto px-2 pb-4">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r.id)}
          aria-current={r.id === selected ? 'true' : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors',
            r.id === selected
              ? 'bg-[var(--color-raised)]'
              : 'hover:bg-[var(--color-raised)]/50',
          )}
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
        </button>
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
 * Three of these four sentences describe a way the plan could be optimistic,
 * and a player who does not know them would read a two-generation route as two
 * eggs rather than as "at least two, probably more".
 */
function Footnote({ stock }: { stock: Stock }) {
  return (
    <section className="border-t border-[var(--color-line)]/40 pt-4 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <p>
        Counted {count(stock.counted)} pals across {count(stock.bySpecies.size)}{' '}
        species that this player owns. Guildmates’ pals are never counted.
        {stock.skippedNoGender > 0 && (
          <>
            {' '}
            {count(stock.skippedNoGender)} of their pals have no gender recorded
            and{' '}
            {stock.assumedUnknownGender
              ? 'were counted anyway, at your request'
              : 'were left out'}
            .
          </>
        )}
        {stock.unownedInWorld > 0 && (
          <>
            {' '}
            {count(stock.unownedInWorld)} pals in this world have no recorded
            owner, so they count for nobody.
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
