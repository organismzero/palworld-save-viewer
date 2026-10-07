/**
 * The paldex grid. Its data comes from `paldex.ts`; this is presentation only.
 */

import { useState } from 'react'

import { filterPaldex, type PaldexCell, type PaldexView } from './paldex.ts'
import { useHoverCard } from '../../components/cards/hoverCard.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { Checkbox, TextInput } from '../../components/controls.tsx'
import { Meter, Pill } from '../../components/primitives.tsx'
import { count, percent } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'

export function PaldexGrid({
  view,
  onOwned,
  breedHref,
}: {
  view: PaldexView
  /** Open the Pals tab on this player's pals of a species. */
  onOwned: (cell: PaldexCell) => void
  /** A link that plans breeding a species, or nothing when it cannot be. */
  breedHref: (cell: PaldexCell) => string | undefined
}) {
  const [query, setQuery] = useState('')
  const [missing, setMissing] = useState(false)
  const [breedable, setBreedable] = useState(false)

  if (view.cells.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        No species data — reference data is unavailable and this player owns no
        pals in the level save.
      </p>
    )
  }

  const shown = filterPaldex(view.cells, { query, missing, breedable })
  const numbered = shown.filter((c) => c.counted)
  const extras = shown.filter((c) => !c.counted)
  const canBreed = view.cells.some((c) => (c.generations ?? 0) > 0)
  const check = 'gap-2 text-xs text-[var(--color-muted)]'

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-2xl leading-none">
          {count(view.caught)}
          <span className="text-[var(--color-muted)]">
            /{count(view.total)}
          </span>
        </span>
        {view.total > 0 && (
          <span className="label">{percent(view.caught / view.total)}</span>
        )}
        <Pill
          tone={view.basis === 'ever-caught' ? 'good' : 'warn'}
          title={
            view.basis === 'ever-caught'
              ? 'From this player’s save: every species they have ever caught, whether or not they still hold it.'
              : 'Derived from the level save: species this player holds right now. Not completion — anything released or traded away is missing. Add their player save for the real figure.'
          }
        >
          {view.basis === 'ever-caught' ? 'ever caught' : 'owned now'}
        </Pill>
      </div>

      {view.basis === 'owned-now' && (
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          This is what they hold now, not what they have caught. Drop their{' '}
          <span className="num">Players/</span> save for real paldex progress.
        </p>
      )}

      {/* Held now, in both cases: the save records an alpha or a lucky pal on
          the pal itself, never as something once caught. */}
      {view.total > 0 && (
        <dl className="mb-4 space-y-1.5">
          <SubBar label="alpha held" n={view.alpha} of={view.total} />
          <SubBar label="lucky held" n={view.lucky} of={view.total} />
        </dl>
      )}

      <div className="mb-3 space-y-2">
        <TextInput
          value={query}
          onChange={setQuery}
          aria-label="Find a species in the paldex"
          placeholder="Find a species…"
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <Checkbox
            checked={missing}
            onChange={setMissing}
            label="missing only"
            className={check}
          />
          {/* Without a breeding table there is nothing this could show. */}
          {canBreed && (
            <Checkbox
              checked={breedable}
              onChange={setBreedable}
              label="breedable only"
              className={check}
            />
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No species matches.</p>
      ) : (
        <>
          <Cells cells={numbered} onOwned={onOwned} breedHref={breedHref} />
          {extras.length > 0 && (
            <>
              <div
                className="label mt-4 mb-2"
                title="Crossover and variant species the paldex has no slot for. Shown because this player has them; not part of the count above."
              >
                no paldex number
                <span className="ml-2 normal-case">
                  {count(extras.length)} · not counted
                </span>
              </div>
              <Cells cells={extras} onOwned={onOwned} breedHref={breedHref} />
            </>
          )}
          {canBreed && (
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
              A number on a cell is how many generations of breeding it is from
              the pals this player holds; the cell opens that plan. A cell they
              hold opens those pals.
            </p>
          )}
        </>
      )}
    </>
  )
}

function SubBar({ label, n, of }: { label: string; n: number; of: number }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="label w-20 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1">
        <Meter value={n} max={of} tone="xp" height={4} showValue={false} />
      </dd>
      <dd className="num w-16 shrink-0 text-right text-xs text-[var(--color-muted)]">
        {count(n)}/{count(of)}
      </dd>
    </div>
  )
}

function Cells({
  cells,
  onOwned,
  breedHref,
}: {
  cells: PaldexCell[]
  onOwned: (cell: PaldexCell) => void
  breedHref: (cell: PaldexCell) => string | undefined
}) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {cells.map((c) => (
        <Cell
          key={c.id}
          cell={c}
          onOwned={onOwned}
          href={c.owned > 0 ? undefined : breedHref(c)}
        />
      ))}
    </div>
  )
}

/**
 * One species.
 *
 * What a cell does follows from what the player can do about it: one they hold
 * opens those pals, one they can breed opens the plan for it, and one that is
 * neither does nothing and is not a tab stop. All three keep the hover card.
 */
function Cell({
  cell: c,
  onOwned,
  href,
}: {
  cell: PaldexCell
  onOwned: (cell: PaldexCell) => void
  href: string | undefined
}) {
  const hover = useHoverCard({ kind: 'species', id: c.id, note: cellNote(c) })
  const className = cn(
    'relative flex aspect-square items-center justify-center rounded-slot border transition-colors',
    c.caught
      ? 'border-[var(--color-line)] bg-[rgb(3_9_13/0.75)] shadow-[var(--edge-sunken)]'
      : 'border-transparent',
    // A ring rather than a tint: lucky pals are a property of the
    // pal, and tinting the cell would collide with element colour.
    c.lucky && 'border-[var(--color-signal)] shadow-[var(--glow-signal)]',
    (c.owned > 0 || href) && 'hover:border-[var(--color-signal)]',
  )
  const body = (
    <>
      {/* The art is dimmed, not the cell, so the badge on a missing species
          stays readable. */}
      <span className={cn(!c.caught && 'opacity-20 grayscale')}>
        <GameIcon path={c.icon} name={c.name} size={34} />
      </span>
      {c.alpha && (
        <span
          aria-hidden
          className="absolute top-0 right-0.5 text-[11px] leading-none text-[var(--color-signal)]"
        >
          ▲
        </span>
      )}
      {href && (
        <span
          aria-hidden
          className="num absolute right-0.5 bottom-0 text-[11px] leading-none text-[var(--color-gold)]"
        >
          {c.generations}
        </span>
      )}
    </>
  )

  if (c.owned > 0) {
    return (
      <button
        type="button"
        {...hover}
        aria-label={`${c.name}: ${cellNote(c)}. Show these pals.`}
        onClick={() => onOwned(c)}
        className={className}
      >
        {body}
      </button>
    )
  }
  if (href) {
    return (
      <a
        href={href}
        {...hover}
        aria-label={`${c.name}: ${cellNote(c)}. Plan breeding it.`}
        className={className}
      >
        {body}
      </a>
    )
  }
  return (
    <div {...hover} className={className}>
      {body}
    </div>
  )
}

/** What this player has of the species, for the top of its card. */
function cellNote(c: PaldexCell): string {
  const parts = [
    c.caught ? (c.owned ? `${count(c.owned)} owned` : 'Caught') : 'Not caught',
    c.alpha && 'holds an alpha',
    c.lucky && 'holds a lucky one',
    c.owned === 0 &&
      c.generations !== undefined &&
      c.generations > 0 &&
      `${c.generations} ${c.generations === 1 ? 'generation' : 'generations'} of breeding away`,
  ]
  return parts.filter(Boolean).join(' · ')
}
