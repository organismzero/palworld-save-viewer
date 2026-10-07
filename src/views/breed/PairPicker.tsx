/**
 * Two parent slots and the pool to fill them from.
 *
 * The pool is the Breed rail's stock, so the player picker, guild pooling and
 * the unknown-gender switch all mean here what they mean for a plan. A pal that
 * cannot pair with the parent already chosen is marked, not hidden: hiding it
 * would read as "you do not have one", which is a different and wrong answer.
 */

import { useMemo, useState } from 'react'

import type { Stock } from '../../domain/breeding.ts'
import { ivTotal } from '../../domain/index.ts'
import { pairProblem, type PairProblem } from '../../domain/pairOutcomes.ts'
import { palName } from '../../domain/palText.ts'
import type { Pal } from '../../domain/types.ts'
import { cn } from '../../lib/utils.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { Pill } from '../../components/primitives.tsx'
import { ListRow, TextInput } from '../../components/controls.tsx'
import type { OwnerText } from './ownerText.ts'
import type { PassiveText } from './passiveText.ts'
import type { SpeciesText } from './speciesText.ts'

type Slot = 'a' | 'b'

/**
 * A mark on the gender glyph rather than a pill: a pill on a 288px rail
 * truncates the pal's name to its first letter, and the name is the point.
 */
const PROBLEM_TONE: Record<PairProblem, string> = {
  'same-pal': 'text-[var(--color-muted)]',
  'same-gender': 'text-[var(--color-danger)]',
  'unknown-gender': 'text-[var(--color-gold)]',
}

export function PairPicker({
  stock,
  a,
  b,
  assumeUnknownGender,
  text,
  passives,
  owner,
  onPick,
}: {
  stock: Stock
  a?: Pal
  b?: Pal
  assumeUnknownGender: boolean
  text: SpeciesText
  passives: PassiveText
  owner: OwnerText
  onPick: (slot: Slot, pal: Pal | undefined) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<Slot>(a && !b ? 'b' : 'a')

  // Every pal in the pool once. With the unknown-gender switch on, `buildStock`
  // files those pals under male or female *as well as* under unknown, so the
  // three arrays overlap and have to be deduped.
  const pals = useMemo(() => {
    const seen = new Map<string, Pal>()
    for (const entry of stock.bySpecies.values()) {
      for (const pal of [...entry.male, ...entry.female, ...entry.unknown]) {
        seen.set(pal.instanceId, pal)
      }
    }
    return [...seen.values()]
  }, [stock])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pals
      .map((pal) => {
        const id = pal.characterId.toLowerCase()
        return { pal, id, name: palName(pal, { name: text.name(id) }) }
      })
      .filter(
        ({ pal, id, name }) =>
          !q ||
          name.toLowerCase().includes(q) ||
          text.name(id).toLowerCase().includes(q) ||
          pal.passives.some((p) =>
            passives.name(p.toLowerCase()).toLowerCase().includes(q),
          ),
      )
      .sort(
        (x, y) =>
          text.name(x.id).localeCompare(text.name(y.id)) ||
          ivTotal(y.pal) - ivTotal(x.pal) ||
          y.pal.level - x.pal.level,
      )
  }, [pals, query, text, passives])

  // Checked against whichever parent is *not* being filled, since that is the
  // one the new pick has to go with.
  const other = active === 'a' ? b : a

  const pick = (pal: Pal) => {
    onPick(active, pal)
    const otherFilled = active === 'a' ? b : a
    if (!otherFilled) setActive(active === 'a' ? 'b' : 'a')
  }

  return (
    <>
      <div className="space-y-2 p-4 pb-3">
        <span className="label block">parents</span>
        {(['a', 'b'] as const).map((slot) => (
          <SlotTile
            key={slot}
            slot={slot}
            pal={slot === 'a' ? a : b}
            active={active === slot}
            text={text}
            onActivate={() => setActive(slot)}
            onClear={() => {
              onPick(slot, undefined)
              setActive(slot)
            }}
          />
        ))}
        <TextInput
          label="find a pal"
          value={query}
          onChange={setQuery}
          placeholder="Species, nickname or passive"
          className="pt-2"
        />
        {other && (
          <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
            Dimmed pals cannot pair with parent {active === 'a' ? 'B' : 'A'}:{' '}
            <span className="text-[var(--color-danger)]">red</span> is the same
            gender
            {!assumeUnknownGender && (
              <>
                , <span className="text-[var(--color-gold)]">?</span> is not
                recorded
              </>
            )}
            .
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {rows.map(({ pal, id, name }) => {
          const problem = other
            ? pairProblem(other, pal, assumeUnknownGender)
            : undefined
          const who = owner.badge(pal)
          const chosen =
            pal.instanceId === a?.instanceId || pal.instanceId === b?.instanceId
          return (
            <ListRow
              key={pal.instanceId}
              selected={chosen}
              onClick={() => pick(pal)}
              card={{ kind: 'pal', pal }}
              className={cn(problem && !chosen && 'opacity-50')}
            >
              <GameIcon
                path={text.icon(id)}
                name={id}
                elementName={text.element(id)}
                size={26}
              />
              <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
              {who && <Pill tone="warn">{who.name}</Pill>}
              <span
                className={cn(
                  'num w-5 shrink-0 text-center text-[11px]',
                  problem && !chosen
                    ? PROBLEM_TONE[problem]
                    : 'text-[var(--color-muted)]',
                )}
              >
                {pal.gender === 'Male'
                  ? '♂'
                  : pal.gender === 'Female'
                    ? '♀'
                    : '?'}
              </span>
              <span className="num w-8 shrink-0 text-right text-[11px] text-[var(--color-muted)]">
                lv{pal.level}
              </span>
            </ListRow>
          )
        })}
        {rows.length === 0 && (
          <p className="px-2 py-3 text-xs text-[var(--color-muted)]">
            {pals.length === 0
              ? 'No pals in this pool.'
              : 'Nothing matches that.'}
          </p>
        )}
      </div>
    </>
  )
}

function SlotTile({
  slot,
  pal,
  active,
  text,
  onActivate,
  onClear,
}: {
  slot: Slot
  pal?: Pal
  active: boolean
  text: SpeciesText
  onActivate: () => void
  onClear: () => void
}) {
  const id = pal?.characterId.toLowerCase()
  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-control border px-2',
        active
          ? 'border-[var(--color-signal)]'
          : 'border-[var(--color-line-strong)]',
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        aria-pressed={active}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
      >
        <span className="label w-3 shrink-0">{slot}</span>
        {pal && id ? (
          <>
            <GameIcon
              path={text.icon(id)}
              name={id}
              elementName={text.element(id)}
              size={24}
            />
            <span className="min-w-0 flex-1 truncate">
              {palName(pal, { name: text.name(id) })}
            </span>
            <span className="num shrink-0 text-[11px] text-[var(--color-muted)]">
              {pal.gender === 'Male'
                ? '♂'
                : pal.gender === 'Female'
                  ? '♀'
                  : '?'}{' '}
              lv{pal.level}
            </span>
          </>
        ) : (
          <span className="text-xs text-[var(--color-muted)]">
            {active ? 'Pick one from the list below' : 'Empty'}
          </span>
        )}
      </button>
      {pal && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear parent ${slot.toUpperCase()}`}
          className="shrink-0 px-1 text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          ×
        </button>
      )}
    </div>
  )
}
