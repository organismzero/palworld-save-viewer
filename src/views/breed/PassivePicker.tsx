/**
 * Which passives the route has to deliver.
 *
 * ## Why it lives with the target and not with the stock
 *
 * The view's own rule: "the selectors are the query and the plan is the result",
 * and a passive is part of *what to breed*, not of whose pals to breed it from.
 * So it sits in the middle rail under the species search, and the two together
 * are the question.
 *
 * ## Why every passive is offered, including the ones nobody has
 *
 * Each row carries how many pals in the current pool hold it, `none` included.
 * Hiding the unowned ones would turn an honest failure — "nothing you can reach
 * has Legend, go and catch one" — into a mysterious absence from a list, and the
 * player would never learn why the passive they wanted was not on offer.
 *
 * There is no multi-select in this app, so this is built from the two patterns
 * that already exist: the typeahead overlay of the Bases view's item search, and
 * the toggle row of the Pals view's element pips.
 */

import { useMemo, useState } from 'react'

import { count } from '../../lib/format.ts'
import { Panel, PassiveChip, SectionHeading } from '../../components/primitives.tsx'
import { IconButton, TextInput } from '../../components/controls.tsx'
import { MAX_SLOTS } from '../../domain/passives.ts'
import type { PassiveText } from './passiveText.ts'

export function PassivePicker({
  selected,
  carriers,
  text,
  degraded,
  onChange,
}: {
  selected: string[]
  /** Lowercased passive id → pals in the current pool holding it. */
  carriers: Map<string, number>
  text: PassiveText
  /** Reference data never arrived, so there are no names to offer. */
  degraded: boolean
  onChange: (next: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const full = selected.length >= MAX_SLOTS

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return text
      .all()
      .filter(
        (p) =>
          !selected.includes(p.id) &&
          (p.id.includes(q) || p.name.toLowerCase().includes(q)),
      )
      .sort(
        (a, b) =>
          // Ones you can actually breed with first — the list is long, and a
          // passive nobody holds is a different kind of answer.
          (carriers.get(b.id) ?? 0 ? 1 : 0) - (carriers.get(a.id) ?? 0 ? 1 : 0) ||
          b.rank - a.rank ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 40)
  }, [query, selected, carriers, text])

  return (
    <div className="relative space-y-2">
      <SectionHeading title="carrying" />

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="flex items-center gap-1">
              <PassiveChip name={text.name(id)} rank={text.rank(id)} />
              <IconButton
                label={`Stop targeting ${text.name(id)}`}
                size={18}
                onClick={() => onChange(selected.filter((s) => s !== id))}
              >
                ×
              </IconButton>
            </span>
          ))}
        </div>
      )}

      {degraded ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
          Passive names could not be loaded, so there is no list to choose from.
          A link that already names some still plans for them.
        </p>
      ) : full ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
          Four is the limit — a pal has four passive slots, so a fifth could
          never arrive.
        </p>
      ) : (
        <TextInput
          value={query}
          onChange={setQuery}
          aria-label="Find a passive to target"
          placeholder={
            selected.length === 0 ? 'Any passives too?' : 'And another…'
          }
        />
      )}

      {query.trim() !== '' && !full && (
        <div className="absolute top-full left-0 z-20 max-h-[50vh] w-[320px] max-w-[calc(100vw-var(--rail-width)-2rem)] overflow-y-auto">
          <Panel className="divide-y divide-[var(--color-line-faint)]">
            {hits.length === 0 ? (
              <p className="px-3 py-2.5 text-sm text-[var(--color-muted)]">
                No passive matches “{query}”.
              </p>
            ) : (
              hits.map((p) => {
                const held = carriers.get(p.id) ?? 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onChange([...selected, p.id])
                      setQuery('')
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-signal)]/[0.08]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <PassiveChip name={p.name} rank={p.rank} />
                      </span>
                      {p.id && text.description(p.id) && (
                        <span className="mt-1 block text-[11px] leading-relaxed text-[var(--color-muted)]">
                          {text.description(p.id)}
                        </span>
                      )}
                    </span>
                    {/* The whole reason the list shows what nobody has: an
                        impossible target is visible before it is picked. */}
                    <span
                      className={
                        held > 0
                          ? 'num shrink-0 text-[11px] text-[var(--color-muted)]'
                          : 'num shrink-0 text-[11px] text-[var(--color-gold)]'
                      }
                      title={
                        held > 0
                          ? 'Pals in this pool carrying it'
                          : 'Nobody in this pool carries it, so no route can deliver it'
                      }
                    >
                      {held > 0 ? count(held) : 'none'}
                    </span>
                  </button>
                )
              })
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}
