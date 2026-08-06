/**
 * The small set of components that carry the visual identity.
 *
 * Design rules these encode, so they do not have to be re-derived at each call
 * site: depth comes from hairlines and a 1px inner top highlight, never from
 * drop shadows or glass; `--color-signal` is the only UI accent; the nine
 * element hues are data colours and never chrome; every number is monospaced
 * with tabular figures.
 */

import type { ReactNode } from 'react'

import { element, passiveTier } from '../lib/color.ts'
import { cn } from '../lib/utils.ts'
import { count } from '../lib/format.ts'

export function Panel({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'raised-edge rounded-[10px] border border-[var(--color-line)]/60 bg-[var(--color-surface)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SectionHeading({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="label">{title}</h2>
        {hint && (
          <span className="text-xs text-[var(--color-muted)]">{hint}</span>
        )}
      </div>
      {action}
    </div>
  )
}

export function StatTile({
  label,
  value,
  accent,
  hint,
}: {
  label: string
  value: number | string
  accent?: boolean
  hint?: string
}) {
  return (
    <div className="raised-edge bg-[var(--color-surface)] px-4 py-3">
      <div
        className={cn(
          'num text-2xl leading-none',
          accent && 'text-[var(--color-signal)]',
        )}
      >
        {typeof value === 'number' ? count(value) : value}
      </div>
      <div className="label mt-1.5">{label}</div>
      {hint && (
        <div className="mt-1 text-[11px] text-[var(--color-muted)]">{hint}</div>
      )}
    </div>
  )
}

/** One or two element pips. Colour is the *only* thing these encode. */
export function ElementBadge({
  name,
  size = 14,
}: {
  name: string | undefined
  size?: number
}) {
  const el = element(name)
  if (!el) return null
  return (
    <span
      title={el.display}
      aria-label={el.display}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: el.oklch,
        boxShadow: `0 0 ${size / 2}px color-mix(in oklch, ${el.oklch} 45%, transparent)`,
      }}
    />
  )
}

/**
 * Three stacked bars for HP / Attack / Defense, 0–100.
 *
 * A row of bars is scannable across a grid of a thousand cards in a way
 * "17/13/20" never is. Notches sit at 70 and 90, the thresholds people
 * actually care about.
 */
export function IVBar({
  hp,
  attack,
  defense,
  width = 64,
}: {
  hp?: number
  attack?: number
  defense?: number
  width?: number
}) {
  const rows: [string, number | undefined][] = [
    ['HP', hp],
    ['ATK', attack],
    ['DEF', defense],
  ]
  return (
    <div className="flex flex-col gap-[3px]" style={{ width }}>
      {rows.map(([label, v]) => (
        <div
          key={label}
          title={`${label} ${v ?? '—'}`}
          className="relative h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-line)]/70"
        >
          {v !== undefined && (
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${v}%`, background: ivColor(v) }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function ivColor(v: number): string {
  if (v >= 90) return 'oklch(0.78 0.16 150)'
  if (v >= 70) return 'oklch(0.80 0.15 85)'
  if (v >= 40) return 'oklch(0.72 0.12 60)'
  return 'oklch(0.62 0.10 28)'
}

/**
 * A passive skill chip, coloured by its numeric **rank** rather than its name.
 * Ranks run −3…9 in real data; negatives are detrimental traits.
 */
export function PassiveChip({ name, rank }: { name: string; rank?: number }) {
  const tier = passiveTier(rank)
  const styles: Record<typeof tier, string> = {
    detrimental:
      'border-[oklch(0.62_0.14_28)]/50 text-[oklch(0.72_0.12_28)] bg-[oklch(0.62_0.14_28)]/10',
    common: 'border-[var(--color-line)] text-[var(--color-muted)]',
    good: 'border-[var(--color-signal)]/40 text-[var(--color-signal)] bg-[var(--color-signal)]/10',
    legendary:
      'border-[oklch(0.80_0.15_85)]/60 text-[oklch(0.85_0.14_85)] bg-[oklch(0.80_0.15_85)]/10',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-wide',
        styles[tier],
      )}
    >
      {tier === 'detrimental' && <span aria-hidden>▾</span>}
      {name}
    </span>
  )
}

/** Universal fallback when an icon is missing — 50 of 753 pals have none. */
export function MonogramTile({
  name,
  elementName,
  size = 36,
}: {
  name: string
  elementName?: string
  size?: number
}) {
  const el = element(elementName)
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[6px] border border-[var(--color-line)] font-mono uppercase"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.3,
        background: el
          ? `color-mix(in oklch, ${el.oklch} 14%, transparent)`
          : 'var(--color-raised)',
        color: el?.oklch ?? 'var(--color-muted)',
      }}
    >
      {name.slice(0, 2)}
    </div>
  )
}

/** An unresolved raw asset id — dimmed and spaced so it reads as "unresolved". */
export function RawId({ children }: { children: ReactNode }) {
  return (
    <span className="num tracking-wide text-[var(--color-muted)]/70">
      {children}
    </span>
  )
}

export type PillTone = 'neutral' | 'signal' | 'good' | 'warn'

export function Pill({
  children,
  tone = 'neutral',
  /**
   * Hover text. A pill is often the only thing on screen naming a concept —
   * `★2`, `officer`, `inferred` — and the label alone rarely explains it.
   */
  title,
}: {
  children: ReactNode
  tone?: PillTone
  title?: string
}) {
  const tones: Record<PillTone, string> = {
    neutral: 'border-[var(--color-line)] text-[var(--color-muted)]',
    signal: 'border-[var(--color-signal)]/40 text-[var(--color-signal)]',
    good: 'border-[oklch(0.78_0.16_150)]/40 text-[oklch(0.78_0.16_150)]',
    warn: 'border-[oklch(0.80_0.15_85)]/40 text-[oklch(0.80_0.15_85)]',
  }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-wider uppercase',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

/** A live "connected" dot. Only ever shown for the one true online signal. */
export function OnlineDot() {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[oklch(0.78_0.16_150)] opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[oklch(0.78_0.16_150)]" />
    </span>
  )
}

export function Table({
  head,
  rows,
  align,
}: {
  head: ReactNode[]
  rows: ReactNode[][]
  /** Columns rendered in the mono/numeric voice. Defaults to all but the first. */
  align?: (i: number) => boolean
}) {
  const isNum = align ?? ((i: number) => i > 0)
  return (
    <div className="overflow-x-auto rounded-[10px] border border-[var(--color-line)]/60">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line)]/60">
            {head.map((h, i) => (
              <th key={i} className="label px-4 py-2.5 text-left font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[var(--color-line)]/40 transition-colors last:border-0 hover:bg-[var(--color-raised)]/40"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    'px-4 py-2',
                    isNum(j) && 'num text-[var(--color-muted)]',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
