/**
 * The paldex grid. Its data comes from `paldex.ts`; this is presentation only.
 */

import type { PaldexView } from './paldex.ts'
import { GameIcon } from '../../components/GameIcon.tsx'
import { Pill } from '../../components/primitives.tsx'
import { count, percent } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'

export function PaldexGrid({ view }: { view: PaldexView }) {
  if (view.total === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        No species data — reference data is unavailable and this player owns no
        pals in the level save.
      </p>
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-2xl">
          {count(view.caught)}
          <span className="text-[var(--color-muted)]">
            /{count(view.total)}
          </span>
        </span>
        <span className="label">{percent(view.caught / view.total)}</span>
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

      <div className="grid grid-cols-6 gap-1">
        {view.cells.map((c) => (
          <div
            key={c.id}
            title={`${c.name}${c.owned ? ` · ${c.owned} owned` : ''}${
              c.caught ? '' : ' · not caught'
            }`}
            className={cn(
              'relative flex aspect-square items-center justify-center rounded-[4px] border',
              c.caught
                ? 'border-[var(--color-line)]'
                : 'border-transparent opacity-20 grayscale',
              // A ring rather than a tint: lucky pals are a property of the
              // pal, and tinting the cell would collide with element colour.
              c.lucky && 'ring-1 ring-[var(--color-signal)]',
            )}
          >
            <GameIcon path={c.icon} name={c.name} size={34} />
            {c.alpha && (
              <span
                aria-hidden
                className="absolute top-0 right-0.5 text-[9px] leading-none text-[var(--color-signal)]"
              >
                ▲
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
