/**
 * What two chosen pals hatch, best for a purpose first.
 *
 * The child's species is one answer and goes in the header. What varies from
 * egg to egg is the passives, so the body is a ranked list of those, each with
 * its own chance and the chance of it *or anything better*. The second number
 * is the useful one: nobody breeds for exactly one outcome, they breed until
 * something good enough hatches.
 */

import { StoredPill } from '../../components/StoredPill.tsx'
import { useMemo, useState } from 'react'

import type { BreedingTable } from '../../domain/breeding.ts'
import {
  PAIR_PURPOSES,
  pairChild,
  pairOutcomes,
  pairProblem,
  pairSpec,
  rankPairOutcomes,
  type RankedOutcome,
} from '../../domain/pairOutcomes.ts'
import { palName } from '../../domain/palText.ts'
import { ivForecast, type IvForecast } from '../../domain/ivForecast.ts'
import type { GoalId } from '../../domain/recommend.ts'
import type { Pal } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
import { PassiveChip, Pill, StatTile } from '../../components/primitives.tsx'
import { Button, SelectControl } from '../../components/controls.tsx'
import type { OwnerText } from './ownerText.ts'
import type { PassiveText } from './passiveText.ts'
import type { SpeciesText } from './speciesText.ts'

/** Rows shown before the list folds. Past this the odds are slivers. */
const FOLD = 12

export function PairPane({
  a,
  b,
  table,
  data,
  purpose,
  onPurpose,
  assumeUnknownGender,
  text,
  passives,
  owner,
}: {
  a: Pal
  b: Pal
  table: BreedingTable
  data: Refdata | undefined
  purpose: GoalId
  onPurpose: (goal: GoalId) => void
  assumeUnknownGender: boolean
  text: SpeciesText
  passives: PassiveText
  owner: OwnerText
}) {
  const [all, setAll] = useState(false)

  const child = pairChild(table, a.characterId, b.characterId)
  const problem = pairProblem(a, b, assumeUnknownGender)
  const ranked = useMemo(
    () =>
      rankPairOutcomes(
        pairOutcomes(a, b),
        data?.passives ?? {},
        pairSpec(purpose),
      ),
    [a, b, data, purpose],
  )
  const blocked = problem === 'same-pal' || problem === 'same-gender'
  const ivs = useMemo(() => ivForecast(a, b), [a, b])

  const best = ranked[0]
  const helps = ranked
    .filter((r) => r.score > 0)
    .reduce((s, r) => s + r.prob, 0)
  const shown = all ? ranked : ranked.slice(0, FOLD)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-start gap-4">
        {child.child ? (
          <CardTrigger card={{ kind: 'species', id: child.child }} focusable>
            <GameIcon
              path={text.icon(child.child)}
              name={child.child}
              elementName={text.element(child.child)}
              size={56}
            />
          </CardTrigger>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl leading-tight">
            {child.child ? text.name(child.child) : 'No known child'}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <Parent pal={a} text={text} owner={owner} />
            <span className="text-[var(--color-muted)]">×</span>
            <Parent pal={b} text={text} owner={owner} />
            {child.unique && (
              <Pill
                tone="signal"
                title="A special combination: this pair makes this child whatever their ranks say."
              >
                special combo
              </Pill>
            )}
          </div>
        </div>
        <SelectControl
          label="ranked for"
          value={purpose}
          onChange={(v) => onPurpose(v as GoalId)}
          options={PAIR_PURPOSES.map((p) => ({ value: p.id, label: p.label }))}
          className="w-44 shrink-0"
        />
      </header>

      {problem && (
        <p className="border border-[var(--color-gold)]/50 bg-[var(--color-gold)]/10 px-4 py-3 text-sm text-[var(--color-gold)]">
          {problemText(problem, a, b, text)}
        </p>
      )}

      {!blocked && best && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatTile
              label="best outcome"
              value={chance(best.prob)}
              accent
              hint={eggs(best.prob)}
            />
            <StatTile
              label="helps at all"
              value={chance(helps)}
              hint={
                helps > 0
                  ? eggs(helps)
                  : 'Neither parent carries anything that helps here.'
              }
            />
            <StatTile
              label="outcomes"
              value={ranked.length}
              hint="Distinct sets of inherited passives."
            />
          </div>

          {!data && (
            <p className="text-xs text-[var(--color-muted)]">
              Reference data is not loaded, so passives cannot be scored and the
              order below is by chance alone.
            </p>
          )}

          <section>
            <div className="label mb-1.5 grid grid-cols-[1fr_3.5rem_4rem_5rem_4.5rem] gap-3 px-1">
              <span>inherits</span>
              <span className="text-right">score</span>
              <span className="text-right">chance</span>
              <span
                className="text-right"
                title="The chance of this outcome or any ranked above it"
              >
                or better
              </span>
              <span
                className="text-right"
                title="Hatches to expect before one this good or better"
              >
                hatches
              </span>
            </div>
            {shown.map((r) => (
              <OutcomeRow
                key={r.inherited.join(',') || '-'}
                row={r}
                passives={passives}
              />
            ))}
            {ranked.length > FOLD && (
              <div className="mt-3">
                <Button size="sm" onClick={() => setAll(!all)}>
                  {all
                    ? `Show the top ${FOLD}`
                    : `Show all ${ranked.length} outcomes`}
                </Button>
              </div>
            )}
          </section>
        </>
      )}

      {!blocked && ivs && <IvSection ivs={ivs} />}

      <Footnote />
    </div>
  )
}

const STAT_LABEL = { hp: 'HP', attack: 'Attack', defense: 'Defense' } as const

/**
 * What the egg's IVs are likely to be.
 *
 * A separate section from the passive outcomes, and after them, because it is a
 * weaker claim: the passive rule has two arrays and a disassembly behind it,
 * this has one array and a couple of hundred recorded hatches. It says so.
 */
function IvSection({ ivs }: { ivs: IvForecast }) {
  return (
    <section>
      <div className="label mb-1.5 grid grid-cols-[1fr_4rem_4rem_5rem_6.5rem] gap-3 px-1">
        <span>
          IVs <span className="ml-2 normal-case">a model, see below</span>
        </span>
        <span className="text-right">first</span>
        <span className="text-right">second</span>
        <span className="text-right" title="The average over many hatches">
          expect
        </span>
        <span
          className="text-right"
          title="The chance a hatch is at least as good as the better parent in this stat"
        >
          the better one
        </span>
      </div>
      {ivs.stats.map((s) => (
        <div
          key={s.stat}
          className="grid grid-cols-[1fr_4rem_4rem_5rem_6.5rem] items-center gap-3 border-t border-[var(--color-line-faint)] px-1 py-2 text-sm"
        >
          <span>{STAT_LABEL[s.stat]}</span>
          <span className="num text-right text-[var(--color-muted)]">
            {s.a}
          </span>
          <span className="num text-right text-[var(--color-muted)]">
            {s.b}
          </span>
          <span className="num text-right">≈{Math.round(s.expected)}</span>
          <span className="num text-right">{chance(s.pBest)}</span>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_4rem_4rem_5rem_6.5rem] items-center gap-3 border-t border-[var(--color-line)] px-1 py-2 text-sm">
        <span>All three</span>
        <span />
        <span />
        <span className="num text-right">≈{Math.round(ivs.expectedTotal)}</span>
        <span className="num text-right" title={eggs(ivs.pAllBest)}>
          {chance(ivs.pAllBest)}
        </span>
      </div>
    </section>
  )
}

function Parent({
  pal,
  text,
  owner,
}: {
  pal: Pal
  text: SpeciesText
  owner: OwnerText
}) {
  const id = pal.characterId.toLowerCase()
  const who = owner.badge(pal)
  return (
    <CardTrigger
      card={{ kind: 'pal', pal }}
      focusable
      className="inline-flex items-center gap-1.5"
    >
      <GameIcon
        path={text.icon(id)}
        name={id}
        elementName={text.element(id)}
        size={22}
      />
      <span>{palName(pal, { name: text.name(id) })}</span>
      <span className="num text-[11px] text-[var(--color-muted)]">
        {pal.gender === 'Male' ? '♂' : pal.gender === 'Female' ? '♀' : '?'}
      </span>
      {who && <Pill tone="warn">{who.name}</Pill>}
      <StoredPill pal={pal} />
    </CardTrigger>
  )
}

function OutcomeRow({
  row,
  passives,
}: {
  row: RankedOutcome
  passives: PassiveText
}) {
  // How many random fills to expect alongside, as the likeliest count.
  const fills = row.randomDist
    .map((p, n) => ({ n, p }))
    .filter((x) => x.n > 0 && x.p > 0)
  return (
    <div className="grid grid-cols-[1fr_3.5rem_4rem_5rem_4.5rem] items-center gap-3 border-t border-[var(--color-line-faint)] px-1 py-2 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {row.inherited.length === 0 && (
          <span className="text-xs text-[var(--color-muted)]">
            nothing from the parents
          </span>
        )}
        {row.inherited.map((id) => {
          const counted = row.counted.get(id)
          const good = counted?.some((c) => c.good)
          const bad = counted?.some((c) => !c.good)
          return (
            <span key={id} className={counted ? undefined : 'opacity-50'}>
              <PassiveChip
                id={id}
                focusable
                name={passives.name(id)}
                rank={passives.rank(id)}
                note={
                  good && !bad
                    ? 'Helps here.'
                    : bad && !good
                      ? 'Works against this.'
                      : good && bad
                        ? 'Cuts both ways here.'
                        : 'No effect here.'
                }
              />
            </span>
          )
        })}
        {fills.length > 0 && (
          <span
            className="text-[11px] text-[var(--color-muted)]"
            title={fills
              .map((f) => `${chance(f.p)} chance of ${f.n} random`)
              .join(', ')}
          >
            + random fill {chance(1 - row.pClean / row.prob)}
          </span>
        )}
      </div>
      <span
        className={
          'num text-right ' +
          (row.score > 0
            ? 'text-[var(--color-hp)]'
            : row.score < 0
              ? 'text-[var(--color-danger)]'
              : 'text-[var(--color-muted)]')
        }
      >
        {row.score > 0 ? `+${row.score}` : row.score}
      </span>
      <span className="num text-right">{chance(row.prob)}</span>
      <span className="num text-right">{chance(row.atLeast)}</span>
      <span className="num text-right text-[var(--color-muted)]">
        {row.atLeast >= 1
          ? '1'
          : `≈${Math.max(1, Math.round(1 / row.atLeast))}`}
      </span>
    </div>
  )
}

/**
 * The same caveats the plan's footnote carries about passive odds, plus the one
 * thing this view is always asked and cannot answer.
 */
function Footnote() {
  return (
    <section className="border-t border-[var(--color-line-faint)] pt-4 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <p>
        A child’s passives are drawn from its parents’ combined list, and how
        many it takes is a roll; then up to three random ones may be added on
        top. Those odds are not in the save, and not in the game’s own exported
        tables either — they are community reverse engineering, so read them as
        a good guide rather than a promise. Which passive a random fill turns
        out to be cannot be predicted, so it is never scored. Breeding cakes,
        and implants from the Pal Surgery Table, are not modelled.
      </p>
      <p className="mt-2">
        The score adds up the percentages a purpose cares about, every point
        counted the same — the same scoring as the Builds tab. Gender is a coin
        flip. Breeding does not consume the parents.
      </p>
      <p className="mt-2">
        The IV figures are a model, and a thinner one than the passive odds. It
        takes a child to inherit one, two or three of its IVs with weights of
        three, two and one, each from either parent with an even chance, and to
        roll the rest fresh anywhere from 0 to 100. The weights are in the
        game’s files; the rest is the palcalc project’s reading of about 190
        recorded hatches, and the 0 to 100 is this app’s assumption. “The better
        one” is the chance a hatch matches or beats the better parent, by
        inheriting that value or by rolling it.
      </p>
    </section>
  )
}

function problemText(
  problem: NonNullable<ReturnType<typeof pairProblem>>,
  a: Pal,
  b: Pal,
  text: SpeciesText,
): string {
  const name = (p: Pal) => palName(p, { name: text.name(p.characterId.toLowerCase()) }) // prettier-ignore
  switch (problem) {
    case 'same-pal':
      return 'That is the same pal twice. Pick a second one.'
    case 'same-gender':
      return `Both are ${a.gender === 'Male' ? 'male' : 'female'} — breeding needs one of each.`
    case 'unknown-gender': {
      const unknown = [a, b].filter((p) => !p.gender).map(name)
      return `The save does not record the gender of ${unknown.join(' or ')}, so this pair may not be able to breed. The odds below assume it can. Tick the box on the left that counts pals with no recorded gender to stop this warning.`
    }
  }
}

/** A probability, with enough precision for the small ones to be told apart. */
function chance(p: number): string {
  if (p >= 0.9995) return '100%'
  if (p < 0.001) return '<0.1%'
  if (p < 0.1) return `${(p * 100).toFixed(1)}%`
  return `${Math.round(p * 100)}%`
}

function eggs(p: number): string {
  if (p <= 0) return 'Cannot happen.'
  const n = 1 / p
  return n < 1.5 ? 'Nearly every hatch.' : `About 1 hatch in ${Math.round(n)}.`
}
