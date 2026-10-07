/**
 * The hover card's frame: the game's item-tooltip layout on this app's panel.
 *
 * A solid panel rather than glass, because a card floats over whatever it was
 * summoned from — a busy grid, the map — and blurred detail behind small text
 * costs more legibility than the glass is worth. The header rule carries the
 * one accent: a passive's tier, an alpha's danger red, a rare pal's gold. It is
 * chrome, so it never takes an element colour.
 */

import type { ReactNode } from 'react'

import { Panel } from '../primitives.tsx'

export function CardFrame({
  icon,
  title,
  sub,
  aside,
  accent,
  children,
}: {
  icon?: ReactNode
  title: ReactNode
  /** Micro label under the title: species, tier, Paldex number. */
  sub?: ReactNode
  /** Top-right of the header: level, rank. */
  aside?: ReactNode
  /** Colour of the rule under the header. Defaults to a strong hairline. */
  accent?: string
  children?: ReactNode
}) {
  return (
    <Panel solid sheen={false} className="w-[300px] max-w-[calc(100vw-16px)]">
      <div
        className="flex items-center gap-3 border-b-2 px-3 pt-3 pb-2.5"
        style={{ borderBottomColor: accent ?? 'var(--color-line-strong)' }}
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base leading-tight font-semibold">
            {title}
          </div>
          {sub && <div className="label mt-1 truncate">{sub}</div>}
        </div>
        {aside && <div className="shrink-0 self-start">{aside}</div>}
      </div>
      {children && (
        <div className="flex flex-col gap-3 px-3 pt-2.5 pb-3 text-sm">
          {children}
        </div>
      )}
    </Panel>
  )
}

/** A labelled block inside a card. */
export function CardSection({
  label,
  hint,
  children,
}: {
  label: string
  /** Muted aside on the label line, e.g. "at Lv 1". */
  hint?: string
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="label">{label}</h3>
        {hint && (
          <span className="text-[11px] text-[var(--color-faint)]">{hint}</span>
        )}
      </div>
      {children}
    </section>
  )
}

/** Descriptive prose, as the game sets it under a tooltip's header. */
export function CardText({ children }: { children: ReactNode }) {
  return (
    <p className="line-clamp-5 leading-normal whitespace-pre-line text-[var(--color-muted)]">
      {children}
    </p>
  )
}

/** A contextual line from the caller — what this thing means *here*. */
export function CardNote({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-[var(--color-signal)] pl-2 text-xs leading-normal text-[var(--color-text)]">
      {children}
    </p>
  )
}
