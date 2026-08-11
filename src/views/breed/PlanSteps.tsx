/**
 * A breeding plan, rendered. Presentation only.
 *
 * Two views of the same thing, because they answer different questions. The
 * numbered list is what somebody actually *does* — put these two in a pen, then
 * these two — and a shared intermediate is one line in it because it is one egg.
 * The tree underneath shows the shape, where that same intermediate appears
 * twice, because a diagram that quietly collapsed it would misdescribe the
 * dependency.
 */

import type {
  BreedNode,
  BreedStep,
  BreedingPlan,
} from '../../domain/breeding.ts'
import { palName } from '../../domain/palText.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { IVBar, Panel, Pill } from '../../components/primitives.tsx'
import type { SpeciesText } from './speciesText.ts'

export function PlanSteps({
  plan,
  text,
}: {
  plan: BreedingPlan
  text: SpeciesText
}) {
  return (
    <div className="space-y-6">
      <section>
        <div className="label mb-2">
          what to do — {plan.steps.length}{' '}
          {plan.steps.length === 1 ? 'egg' : 'eggs'}
        </div>
        <div className="space-y-2">
          {plan.steps.map((step) => (
            <StepRow key={step.n} step={step} text={text} />
          ))}
        </div>
      </section>

      {plan.tree && (
        <section>
          <div className="label mb-2">the shape of it</div>
          <Panel className="overflow-x-auto px-3 py-3">
            <TreeNode node={plan.tree} text={text} depth={0} />
          </Panel>
        </section>
      )}
    </div>
  )
}

function StepRow({ step, text }: { step: BreedStep; text: SpeciesText }) {
  return (
    <Panel className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="num shrink-0 text-xs text-[var(--color-muted)]">
          {step.n}
        </span>
        <ParentChip node={step.a} text={text} />
        <span className="shrink-0 text-[var(--color-muted)]">×</span>
        <ParentChip node={step.b} text={text} />
        <span className="shrink-0 text-[var(--color-muted)]">→</span>
        <span className="flex shrink-0 items-center gap-2">
          <GameIcon
            path={text.icon(step.species)}
            name={step.species}
            elementName={text.element(step.species)}
            size={24}
          />
          <span className="text-sm">{text.name(step.species)}</span>
        </span>
        {step.selfPair && (
          <Pill
            tone="warn"
            title="Both parents are the same species, so you need one of each gender — expect to hatch more than one egg."
          >
            needs both genders
          </Pill>
        )}
      </div>
    </Panel>
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
function ParentChip({ node, text }: { node: BreedNode; text: SpeciesText }) {
  if (node.kind === 'bred') {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <GameIcon
          path={text.icon(node.species)}
          name={node.species}
          elementName={text.element(node.species)}
          size={22}
        />
        <span className="truncate text-sm">{text.name(node.species)}</span>
        <Pill tone="signal">from {node.step}</Pill>
      </span>
    )
  }

  const pick = node.use

  return (
    <span className="flex min-w-0 items-center gap-1.5">
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
      {node.gender && (
        <Pill title="Which side of this pair it has to be">
          {node.gender === 'Male' ? '♂' : '♀'}
        </Pill>
      )}
      {pick && (
        <>
          <span className="num shrink-0 text-[10px] text-[var(--color-muted)]">
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
      {node.count > 1 && (
        <span className="num shrink-0 text-[10px] text-[var(--color-muted)]">
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
        <GameIcon
          path={text.icon(node.species)}
          name={node.species}
          elementName={text.element(node.species)}
          size={20}
        />
        <span className="text-xs">{text.name(node.species)}</span>
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
