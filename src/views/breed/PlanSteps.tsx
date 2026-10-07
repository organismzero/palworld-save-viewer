/**
 * A breeding plan, rendered. Presentation only.
 *
 * Two views of the same thing, because they answer different questions. The
 * numbered list is what somebody actually *does* — put these two in a pen, then
 * these two — and a shared intermediate is one line in it because it is one egg.
 * The tree underneath shows the shape, where that same intermediate appears
 * twice, because a diagram that quietly collapsed it would misdescribe the
 * dependency.
 *
 * A parent the selected player does not own is badged with whose it is, because
 * "borrow a Chikipi" and "borrow Dave's Chikipi" are different amounts of work —
 * one is a shopping list, the other is a conversation.
 */

import type {
  BreedNode,
  BreedStep,
  BreedingPlan,
  GenderDemand,
} from '../../domain/breeding.ts'
import { MAX_SLOTS } from '../../domain/passives.ts'
import { palName } from '../../domain/palText.ts'
import { cn } from '../../lib/utils.ts'
import { Checkbox } from '../../components/controls.tsx'
import { GameIcon } from '../../components/GameIcon.tsx'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
import { Jump } from '../../components/Jump.tsx'
import {
  IVBar,
  Panel,
  PassiveChip,
  Pill,
} from '../../components/primitives.tsx'
import { stepKey } from './savedPaths.ts'
import type { SpeciesText } from './speciesText.ts'
import type { PassiveText } from './passiveText.ts'
import { borrowSummary, type OwnerText } from './ownerText.ts'

export function PlanSteps({
  plan,
  text,
  passives,
  owner,
  ticks,
  onTick,
}: {
  plan: BreedingPlan
  text: SpeciesText
  passives: PassiveText
  owner: OwnerText
  /**
   * Steps ticked off by hand, by {@link stepKey}. Absent when the plan is not a
   * saved path — a tick has to be kept somewhere, and that is where.
   */
  ticks?: readonly string[]
  onTick?: (key: string, done: boolean) => void
}) {
  return (
    <div className="space-y-6">
      <section>
        <div className="label mb-2">
          what to do — {plan.steps.length}{' '}
          {plan.steps.length === 1 ? 'egg' : 'eggs'}
          {plan.expectedEggs !== undefined &&
            plan.expectedEggs > plan.steps.length + 0.5 && (
              <> · ≈{Math.round(plan.expectedEggs)} hatches</>
            )}
          {plan.borrowed.length > 0 && <> · {borrowSummary(plan.borrowed)}</>}
        </div>
        <div className="space-y-2">
          {plan.steps.map((step) => (
            <StepRow
              key={step.n}
              step={step}
              text={text}
              passives={passives}
              owner={owner}
              isTarget={step.n === plan.steps.length}
              ticked={ticks?.includes(stepKey(step))}
              onTick={
                ticks && onTick
                  ? (done) => onTick(stepKey(step), done)
                  : undefined
              }
            />
          ))}
        </div>
      </section>

      {plan.tree && (
        <section>
          <div className="label mb-2">the shape of it</div>
          <Panel padded className="overflow-x-auto">
            <TreeNode node={plan.tree} text={text} depth={0} />
          </Panel>
        </section>
      )}
    </div>
  )
}

function StepRow({
  step,
  text,
  passives,
  owner,
  isTarget,
  ticked,
  onTick,
}: {
  step: BreedStep
  text: SpeciesText
  passives: PassiveText
  owner: OwnerText
  /** The last step is the one that makes the thing you asked for. */
  isTarget: boolean
  ticked?: boolean
  /** Absent when there is nowhere to keep a tick. */
  onTick?: (done: boolean) => void
}) {
  // A held pal that meets the step is done whatever was ticked: the save
  // outranks the checkbox.
  const met = step.progress?.meets === true
  return (
    <Panel padded className={cn('py-2.5', (ticked || met) && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="num shrink-0 text-xs text-[var(--color-muted)]">
          {step.n}
        </span>
        <ParentChip
          node={step.a}
          text={text}
          passives={passives}
          owner={owner}
        />
        <span className="shrink-0 text-[var(--color-muted)]">×</span>
        <ParentChip
          node={step.b}
          text={text}
          passives={passives}
          owner={owner}
        />
        <span className="shrink-0 text-[var(--color-muted)]">→</span>
        <CardTrigger
          card={{ kind: 'species', id: step.species }}
          focusable
          className="flex shrink-0 items-center gap-2"
        >
          <GameIcon
            path={text.icon(step.species)}
            name={step.species}
            elementName={text.element(step.species)}
            size={24}
          />
          <span className="text-sm">{text.name(step.species)}</span>
        </CardTrigger>
        {step.carries?.map((id) => (
          <PassiveChip
            key={id}
            id={id}
            focusable
            name={passives.name(id)}
            rank={passives.rank(id)}
          />
        ))}
        <RoomFor step={step} isTarget={isTarget} />
        {step.gender && (
          <Pill tone="warn" title={genderTitle(step.gender, text)}>
            {genderLabel(step.gender)}
          </Pill>
        )}
        {onTick && (
          <Checkbox
            checked={ticked === true || met}
            disabled={met}
            onChange={onTick}
            className="ml-auto gap-2 text-xs text-[var(--color-muted)]"
            label={met ? 'held' : 'done'}
          />
        )}
      </div>
      {/* Only where the hatch is not a formality. A step whose parents can
          only produce what it needs is an ordinary egg and reads better without
          a 100% beside it — but a step that carries nothing and still has to be
          re-rolled for a *clean* result is not ordinary, and says so. */}
      {step.chance !== undefined && step.chance < 0.995 ? (
        <div className="mt-1.5 pl-6 text-[11px] text-[var(--color-muted)]">
          <span className="num">
            {(step.chance! * 100).toFixed(step.chance! < 0.01 ? 2 : 0)}%
          </span>{' '}
          a hatch, so ≈
          <span className="num">{Math.round(1 / step.chance)}</span> of them
          {step.gender && (
            <>
              , and ≈
              <span className="num">{Math.round(step.expectedEggs!)}</span> to
              get {genderGoal(step.gender)}
            </>
          )}{' '}
          — out of a pool of <span className="num">{step.pool}</span> passives
          between the two parents.
        </div>
      ) : (
        // An egg with nothing to land still has a sex, and that can cost.
        step.gender && (
          <div className="mt-1.5 pl-6 text-[11px] text-[var(--color-muted)]">
            ≈<span className="num">{Math.round(step.expectedEggs!)}</span>{' '}
            hatches to get {genderGoal(step.gender)}.
          </div>
        )
      )}
      <Progress
        step={step}
        text={text}
        passives={passives}
        isTarget={isTarget}
      />
    </Panel>
  )
}

/**
 * What you are already holding towards this step.
 *
 * The plan describes eggs that do not exist yet, and without this there was no
 * way to relate one to a pal that does — a hatch three passives into a
 * four-passive plan read exactly like a hatch that missed.
 *
 * ## Why this says nothing about the plan being out of date
 *
 * An earlier version read a pal carrying more than the step asked for as proof
 * that the save was stale, and told people to reload. It was wrong twice over,
 * and reliably wrong on a freshly loaded save.
 *
 * Carrying *extra wanted passives* is not the same as being good enough. A pal
 * with everything the step needs and one passive too many cannot stand in for
 * it: the spare fills a slot the next generation needs, which is the whole
 * reason steps carry a junk ceiling. The planner has already weighed it — on the
 * reported save, breeding a clean intermediate and pairing that was 10.8
 * expected hatches against 16.7 for using the held pal directly.
 *
 * And a pal that genuinely *meets* a step cannot coexist with it, because
 * `isDominated` in `domain/passiveBreeding.ts` prunes a bred state whenever a
 * settled one has a superset mask, no more junk and no greater cost — exactly
 * that pal. The search handles the case by construction, so there is nothing to
 * infer from it and no advice to give.
 *
 * What is knowable is why the pal does not serve *this* step, so that is what
 * this says. Silent until there is something to say: a step nobody has started
 * is the ordinary case, and a line on every row would bury the ones that matter.
 */
function Progress({
  step,
  text,
  passives,
  isTarget,
}: {
  step: BreedStep
  text: SpeciesText
  passives: PassiveText
  isTarget: boolean
}) {
  const at = step.progress
  if (!at) return null

  const short = (id: string) => (
    <PassiveChip
      key={id}
      id={id}
      focusable
      name={passives.name(id)}
      rank={passives.rank(id)}
    />
  )
  const name = (id: string) => passives.name(id)
  const lacks = (step.carries ?? []).filter((id) => !at.has.includes(id))
  const spare = step.junk ?? MAX_SLOTS
  const tooMany = at.junk > spare

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-[11px] text-[var(--color-muted)]">
      <span>{lacks.length === 0 ? 'you already have' : 'closest so far'}:</span>
      <span className="truncate">
        {palName(at.pal, { name: text.name(step.species) })}
      </span>
      {[...at.has, ...at.beyond].map(short)}
      {at.junk > 0 && (
        <span className="num" title="Its other passives.">
          +{at.junk}
        </span>
      )}

      {at.meets && isTarget ? (
        <span>— this plan is for breeding another.</span>
      ) : (
        <span>
          {'— '}
          {lacks.length > 0 && <>still needs {lacks.map(name).join(' and ')}</>}
          {lacks.length > 0 && tooMany && ', and '}
          {/* The reported case, and the answer to "why is the plan not
              shorter?". The pal has everything asked for and one passive too
              many, so it cannot stand in — the route breeds a cleaner one
              instead, which is cheaper than living with the spare. */}
          {tooMany && (
            <>
              this step needs one with{' '}
              {spare === 0 ? 'nothing spare' : `no more than ${spare} spare`},
              so the route breeds a cleaner one
            </>
          )}
          {/* Unreachable, per the dominance argument above, and pinned by a
              test. Neutral rather than absent, because a blank line here would
              be worse than a dull one. */}
          {lacks.length === 0 && !tooMany && <>already enough for this step</>}
          {'.'}
          {at.beyond.length > 0 && (
            <> It also has {at.beyond.map(name).join(' and ')}.</>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * How much else this egg may come out carrying.
 *
 * The number the plan was always computing and never showing, which made the one
 * moment it matters unreadable: you hatch something with the two passives you
 * wanted *and* two you did not, and nothing on screen says whether that is a
 * pass or a miss. It is usually a miss, and an expensive one — a pal's four
 * slots are shared, so two spare passives on a parent dilute every draw beneath
 * it. Against a four-passive target, pairing two clean carriers is one hatch in
 * ten; doing it with two spares apiece is one in seven hundred.
 *
 * Silent where the constraint is not real: a step with slots to spare is not
 * asking anything of you, and a pill saying so on every row would bury the ones
 * that are.
 */
function RoomFor({ step, isTarget }: { step: BreedStep; isTarget: boolean }) {
  if (step.carries === undefined || step.junk === undefined) return null
  const spare = MAX_SLOTS - step.carries.length

  if (step.junk >= spare) {
    // Nothing constrains the spares. On an intermediate that is not worth a
    // pill — the ceiling is simply loose, and the search has priced whatever it
    // ends up carrying. On the pal you are *keeping* it is worth saying out
    // loud, because silence reads as "no information" rather than "does not
    // matter", and a hatch with everything you asked for plus one you did not
    // looks like a miss. It is not: nothing is bred from this one.
    return isTarget && spare > 0 ? (
      <Pill
        tone="good"
        title="Nothing is bred from this one, so passives you did not ask for cost you nothing. An egg carrying everything listed here is finished, whatever else came with it."
      >
        spares don’t matter
      </Pill>
    ) : null
  }

  return step.junk === 0 ? (
    <Pill
      tone="warn"
      title="This egg has to come out carrying nothing but what is listed. Anything else fills a slot the next generation needs, and a pal that hatches with spares is worth throwing back rather than breeding on."
    >
      nothing else
    </Pill>
  ) : (
    <Pill
      title={`Up to ${step.junk} other ${step.junk === 1 ? 'passive is' : 'passives are'} tolerable here. More than that and the next generation cannot draw what it needs.`}
    >
      +{step.junk} at most
    </Pill>
  )
}

/**
 * One side of a pair.
 *
 * An owned parent names the actual pal, with its level and IVs, because *which*
 * one you use is the difference between a good child and a merely correct one.
 * A derived parent points back at the step that makes it rather than repeating
 * its whole subtree.
 */
function ParentChip({
  node,
  text,
  passives,
  owner,
}: {
  node: BreedNode
  text: SpeciesText
  passives: PassiveText
  owner: OwnerText
}) {
  if (node.kind === 'bred') {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <CardTrigger
          card={{ kind: 'species', id: node.species }}
          focusable
          className="flex min-w-0 items-center gap-1.5"
        >
          <GameIcon
            path={text.icon(node.species)}
            name={node.species}
            elementName={text.element(node.species)}
            size={22}
          />
          <span className="truncate text-sm">{text.name(node.species)}</span>
        </CardTrigger>
        <Pill tone="signal">from {node.step}</Pill>
      </span>
    )
  }

  const pick = node.use
  const who = pick ? owner.badge(pick) : undefined

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {/* The pal to fetch when there is one, so its level, rolls and other
          passives are a hover away; otherwise just the species. */}
      {pick ? (
        <Jump
          view="pals"
          focus={{
            kind: 'pal',
            id: pick.instanceId,
            label: palName(pick, { name: text.name(node.species) }),
          }}
          card={{ kind: 'pal', pal: pick }}
          title="Open this pal in Pals"
          quiet
          className="items-center gap-1.5"
        >
          <GameIcon
            path={text.icon(node.species)}
            name={node.species}
            elementName={text.element(node.species)}
            size={22}
          />
          <span className="truncate text-sm">
            {pick
              ? palName(pick, { name: text.name(node.species) })
              : text.name(node.species)}
          </span>
        </Jump>
      ) : (
        <CardTrigger
          card={{ kind: 'species', id: node.species }}
          focusable
          className="flex min-w-0 items-center gap-1.5"
        >
          <GameIcon
            path={text.icon(node.species)}
            name={node.species}
            elementName={text.element(node.species)}
            size={22}
          />
          <span className="truncate text-sm">
            {pick
              ? palName(pick, { name: text.name(node.species) })
              : text.name(node.species)}
          </span>
        </CardTrigger>
      )}
      {node.gender && (
        <Pill title="Which side of this pair it has to be">
          {node.gender === 'Male' ? '♂' : '♀'}
        </Pill>
      )}
      {/* `warn`, not `signal`: a borrowed parent is an obstacle, the same
          category as "needs both genders". `signal` in this file means an
          informational back-reference. */}
      {who &&
        (who.unowned || !pick?.ownerPlayerUid ? (
          <Pill
            tone="warn"
            title="No player owns this pal — it is a base worker in shared storage, so any member can fetch it."
          >
            {who.name}
          </Pill>
        ) : (
          // The owner's card, carrying why they are named here.
          <Jump
            view="guild"
            focus={{ kind: 'player', id: pick.ownerPlayerUid }}
            card={{
              kind: 'player',
              uid: pick.ownerPlayerUid,
              note: `This pal belongs to ${who.name}. You will need them to put it in the pen.`,
            }}
            title="Open this player in Guild"
            quiet
          >
            <Pill tone="warn">{who.name}</Pill>
          </Jump>
        ))}
      {pick && (
        <>
          <span className="num shrink-0 text-[11px] text-[var(--color-muted)]">
            lv{pick.level}
          </span>
          <IVBar
            hp={pick.ivHp}
            attack={pick.ivAttack}
            defense={pick.ivDefense}
            width={34}
          />
        </>
      )}
      {/* Why *this* pal and not the better one beside it. Without this the
          advice to fetch a 30-IV Chikipi over a 300-IV one reads as a bug. */}
      {node.carries?.map((id) => (
        <PassiveChip
          key={id}
          id={id}
          focusable
          name={passives.name(id)}
          rank={passives.rank(id)}
        />
      ))}
      {node.junk !== undefined && node.junk > 0 && (
        <span
          className="num shrink-0 text-[11px] text-[var(--color-muted)]"
          title="Other passives on this pal. They compete for the child's slots, which is why a cleaner pal can be worth fetching."
        >
          +{node.junk}
        </span>
      )}
      {node.count > 1 && (
        <span className="num shrink-0 text-[11px] text-[var(--color-muted)]">
          of {node.count}
        </span>
      )}
    </span>
  )
}

/** Indented rather than drawn: the depth is never more than a handful. */
function TreeNode({
  node,
  text,
  depth,
}: {
  node: BreedNode
  text: SpeciesText
  depth: number
}) {
  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 18 }}>
      <div className="flex items-center gap-2 py-0.5 whitespace-nowrap">
        {depth > 0 && <span className="num text-[var(--color-muted)]">└</span>}
        <CardTrigger
          card={{ kind: 'species', id: node.species }}
          className="flex items-center gap-2"
        >
          <GameIcon
            path={text.icon(node.species)}
            name={node.species}
            elementName={text.element(node.species)}
            size={20}
          />
          <span className="text-xs">{text.name(node.species)}</span>
        </CardTrigger>
        {node.kind === 'owned' ? (
          <Pill tone="good">owned</Pill>
        ) : (
          <Pill tone="signal">step {node.step}</Pill>
        )}
      </div>
      {node.kind === 'bred' && (
        <>
          <TreeNode node={node.a} text={text} depth={depth + 1} />
          <TreeNode node={node.b} text={text} depth={depth + 1} />
        </>
      )}
    </div>
  )
}

/** "♂ ×2", "♂ and ♀ ×3": what the egg has to be, and what that multiplies. */
function genderLabel(g: GenderDemand): string {
  const what =
    g.why === 'self'
      ? 'one of each sex'
      : g.why === 'single'
        ? `must be ${g.must === 'Male' ? 'male' : 'female'}`
        : 'must be the other sex'
  return `${what} · ×${g.factor}`
}

/** The same, as the end of "≈6 hatches to get …". */
function genderGoal(g: GenderDemand): string {
  return g.why === 'self'
    ? 'a male and a female'
    : g.why === 'single'
      ? `a ${g.must === 'Male' ? 'male' : 'female'}`
      : 'the sex its partner is not'
}

function genderTitle(g: GenderDemand, text: SpeciesText): string {
  const partner = text.name(g.partner)
  if (g.why === 'self') {
    return `Step ${g.forStep} pairs this with another of itself, so it has to be hatched until you hold a male and a female: one hatch, then two more on average for the other sex.`
  }
  if (g.why === 'single') {
    return `Step ${g.forStep} pairs this with your ${partner}, and the only ${partner} to hand is ${g.must === 'Male' ? 'female' : 'male'}. Half of hatches come out the sex needed, so two on average.`
  }
  return `Step ${g.forStep} pairs this with ${partner}, which is bred too. One of the two has to be re-hatched until they differ in sex, and this is the cheaper one: two on average.`
}
