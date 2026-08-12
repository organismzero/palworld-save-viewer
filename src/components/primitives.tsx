/**
 * The small set of components that carry the visual identity.
 *
 * Design rules these encode, so they do not have to be re-derived at each call
 * site: depth is a hairline, a 1px inset top highlight and four corner ticks,
 * never a drop shadow; `--color-signal` is the only UI accent and
 * `--color-select` the only selection fill; the nine element hues are data
 * colours and never chrome; every number is monospaced with tabular figures;
 * radii are 0–3px, so nothing here is a rounded card.
 */

import type { CSSProperties, ReactNode } from 'react'

import { element, passiveTier } from '../lib/color.ts'
import { cn } from '../lib/utils.ts'
import { count } from '../lib/format.ts'

/**
 * The game's menu panel: translucent glass, a hairline edge, a diagonal sheen
 * and four corner ticks.
 *
 * `padded` defaults to off because most call sites here predate it and set their
 * own padding. The ticks and sheen are drawn by CSS pseudo-elements rather than
 * child nodes, so a `divide-y` className still divides the caller's own children
 * and not the decoration — see `.corner-ticks` in index.css.
 */
export function Panel({
  className,
  children,
  /** Pale strip across the top of the panel: "Filter", "Contents", "Party". */
  title,
  /** Right-aligned content inside that strip. */
  action,
  ticks = true,
  sheen = true,
  /** Opaque body, for a surface with nothing behind it worth showing through. */
  solid = false,
  /** Apply the standard 16px body padding. */
  padded = false,
  style,
}: {
  className?: string
  children?: ReactNode
  title?: string
  action?: ReactNode
  ticks?: boolean
  sheen?: boolean
  solid?: boolean
  padded?: boolean
  style?: CSSProperties
}) {
  return (
    <div
      style={style}
      className={cn(
        'relative isolate rounded-panel border border-[var(--color-line)] shadow-[var(--edge-panel)]',
        solid
          ? 'bg-[var(--color-panel-solid)]'
          : 'bg-[var(--color-panel)] backdrop-blur-panel backdrop-saturate-[1.15]',
        sheen && 'panel-sheen',
        ticks && 'corner-ticks',
        padded && title === undefined && 'p-[var(--panel-pad)]',
        className,
      )}
    >
      {title !== undefined && <PanelTitleBar title={title} action={action} />}
      {title !== undefined ? (
        <div className={cn(padded && 'p-[var(--panel-pad)]')}>{children}</div>
      ) : (
        children
      )}
    </div>
  )
}

/** The pale strip that names a panel. Inset from the frame, as the game sets it. */
export function PanelTitleBar({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <div className="relative mx-1.5 mt-1.5 flex h-[30px] items-center gap-2 bg-[image:var(--surface-title-bar)] px-3 text-[var(--color-text)] [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">
      <span className="min-w-0 truncate font-semibold">{title}</span>
      {action && <span className="ml-auto flex gap-1">{action}</span>}
    </div>
  )
}

/**
 * The wide, thin, letterspaced title the game sets in the corner of a
 * full-screen menu. Low-contrast on purpose: it names the screen rather than
 * shouting at you. Uppercase is applied in CSS, so the copy stays sentence case.
 */
export function ScreenTitle({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <h1
      className={cn(
        'font-display text-[38px] leading-none font-[200] tracking-title text-[rgb(238_246_249/0.82)] uppercase [text-shadow:0_2px_18px_rgb(0_0_0/0.6)] sm:text-title',
        className,
      )}
    >
      {children}
    </h1>
  )
}

/** The footer strip of key prompts every game screen ends with. */
export function PromptBar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-x-5 gap-y-1 px-4 py-2 text-sm',
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
    <div className="raised-edge border border-[var(--color-line)] bg-[rgb(10_24_33/0.65)] px-4 py-3">
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

/** A label/value pair on a hairline baseline — the detail-panel workhorse. */
export function Field({
  label,
  value,
  title,
  className,
}: {
  label: string
  value: ReactNode
  title?: string
  className?: string
}) {
  return (
    <div
      title={title}
      className={cn(
        'flex items-baseline justify-between gap-3 border-b border-[var(--color-line-faint)] py-1.5',
        className,
      )}
    >
      <span className="label shrink-0">{label}</span>
      <span className="num text-right">{value}</span>
    </div>
  )
}

/** One or two element pips. Colour is the *only* thing these encode. */
export function ElementBadge({
  name,
  size = 14,
  showLabel,
}: {
  name: string | undefined
  size?: number
  showLabel?: boolean
}) {
  const el = element(name)
  if (!el) return null
  const pip = (
    <span
      title={el.display}
      aria-label={el.display}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: el.oklch,
        boxShadow: `0 0 ${size / 2}px color-mix(in oklch, ${el.oklch} 50%, transparent)`,
      }}
    />
  )
  if (!showLabel) return pip
  return (
    <span className="inline-flex items-center gap-1.5">
      {pip}
      <span className="text-xs text-[var(--color-muted)]">{el.display}</span>
    </span>
  )
}

/**
 * The HUD bar: a sunken well, a flat fill, and the value printed inside it.
 *
 * Squared rather than pill-shaped — the game only rounds a meter that floats
 * over the world. Only ever handed a `max` the save actually records: a pal's HP
 * has no maximum anywhere in the format, so pal cards print a number instead of
 * a bar. Structures record `hpCurrent`/`hpMax`, and a player's XP has a real
 * denominator once the levelling curve has loaded.
 */
export function Meter({
  value,
  max = 100,
  tone = 'hp',
  height = 16,
  showValue = true,
  label,
  className,
}: {
  value: number
  max?: number
  tone?: 'hp' | 'stamina' | 'xp' | 'select' | 'danger'
  height?: number
  /** Print `value/max` inside the bar. */
  showValue?: boolean
  /** Uppercase micro label to the left of the bar. */
  label?: string
  className?: string
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const fill: Record<NonNullable<typeof tone>, string> = {
    hp: 'var(--color-hp)',
    stamina: 'var(--color-stamina)',
    xp: 'var(--color-signal)',
    select: 'var(--color-select)',
    danger: 'var(--color-danger)',
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && <span className="label shrink-0">{label}</span>}
      <div
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="relative flex-1 overflow-hidden border border-black/60 bg-[rgb(3_9_13/0.8)] shadow-[var(--edge-sunken)]"
        style={{ height }}
      >
        <div
          className="h-full shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_-3px_6px_rgb(0_0_0/0.25)] transition-[width] duration-[var(--dur-slow)] ease-out"
          style={{ width: `${fraction * 100}%`, background: fill[tone] }}
        />
        {showValue && (
          <span className="num absolute inset-0 flex items-center px-1.5 text-[11px] text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.85)]">
            {Math.round(value)}
            <span className="opacity-65">/{max}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Three stacked bars for HP / Attack / Defense, 0–100.
 *
 * A row of bars is scannable across a grid of a thousand cards in a way
 * "17/13/20" never is. One accent and length alone: the four-step threshold ramp
 * this used to carry has gone, because a green bar beside a Grass element pip
 * reads as an element rather than as a good roll.
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
          className="relative h-[3px] w-full overflow-hidden bg-[var(--color-line)]"
        >
          {v !== undefined && (
            <div
              className="absolute inset-y-0 left-0 bg-[var(--color-signal)]"
              style={{ width: `${v}%` }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export type PillTone = 'neutral' | 'signal' | 'good' | 'warn' | 'danger'

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
  // 11px, not the 10px the design system's own pill sets: the same package
  // states an 11px floor two pages earlier, and the floor wins.
  const tones: Record<PillTone, string> = {
    neutral: 'border-[var(--color-line-strong)] text-[var(--color-muted)]',
    signal:
      'border-[var(--color-signal)]/45 bg-[var(--color-signal)]/10 text-[var(--color-signal)]',
    good: 'border-[var(--color-hp)]/45 bg-[var(--color-hp)]/10 text-[var(--color-hp)]',
    warn: 'border-[var(--color-gold)]/50 bg-[var(--color-gold)]/10 text-[var(--color-gold)]',
    danger:
      'border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
  }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-control border px-1.5 py-0.5 font-mono text-[11px] leading-none tracking-[0.08em] uppercase',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

/**
 * A passive skill chip, coloured by its numeric **rank** rather than its name.
 * Ranks run −3…9 in real data; negatives are detrimental traits.
 */
export function PassiveChip({ name, rank }: { name: string; rank?: number }) {
  const tier = passiveTier(rank)
  const tone: Record<typeof tier, PillTone> = {
    detrimental: 'danger',
    common: 'neutral',
    good: 'signal',
    legendary: 'warn',
  }
  return (
    <Pill tone={tone[tier]}>
      {tier === 'detrimental' && <span aria-hidden>▾</span>}
      {tier === 'legendary' && <span aria-hidden>▴</span>}
      {name}
    </Pill>
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
      className="flex shrink-0 items-center justify-center rounded-slot border border-[var(--color-line)] font-mono uppercase"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.3,
        background: el
          ? `color-mix(in oklch, ${el.oklch} 16%, transparent)`
          : 'rgb(255 255 255 / 0.05)',
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
    <span className="num tracking-[0.04em] text-[var(--color-muted)]/70">
      {children}
    </span>
  )
}

/** The keycap the game prints beside every prompt: [Q] Previous Tab. */
export function KeyHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="num inline-flex h-5 min-w-5 items-center justify-center rounded-control border border-[var(--color-line-strong)] bg-white/10 px-1.5 text-[11px] text-[var(--color-text)]">
      {children}
    </kbd>
  )
}

/**
 * A live "connected" dot. Only ever shown for the one true online signal.
 *
 * The slow pulse is the only looping animation in the system. It replaced a
 * `ping`, which expanded a second ring every 1.5s — louder than the one fact it
 * carries, and more work for the compositor.
 */
export function OnlineDot({ size = 8 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0 animate-pulse-dot rounded-full bg-[var(--color-hp)] opacity-60" />
      <span
        className="relative rounded-full bg-[var(--color-hp)]"
        style={{ width: size, height: size }}
      />
    </span>
  )
}

/**
 * The tabular read-out: micro-label head, monospaced data columns.
 *
 * `onRowClick` and `selectedIndex` are optional, and a table without them paints
 * no hover at all — a read-only read-out should not suggest it can be clicked.
 */
export function Table({
  head,
  rows,
  align,
  onRowClick,
  selectedIndex,
}: {
  head: ReactNode[]
  rows: ReactNode[][]
  /** Columns rendered in the mono/numeric voice. Defaults to all but the first. */
  align?: (i: number) => boolean
  onRowClick?: (i: number) => void
  selectedIndex?: number
}) {
  const isNum = align ?? ((i: number) => i > 0)
  return (
    <div className="overflow-x-auto rounded-panel border border-[var(--color-line)]">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line)]">
            {head.map((h, i) => (
              <th key={i} className="label px-4 py-2.5 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const selected = selectedIndex === i
            return (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(i) : undefined}
                className={cn(
                  'border-b border-[var(--color-line-faint)] transition-colors last:border-0',
                  selected && 'bg-[image:var(--surface-row-selected)]',
                  onRowClick && 'cursor-pointer',
                  onRowClick &&
                    !selected &&
                    'hover:bg-[var(--color-signal)]/[0.08]',
                )}
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      'px-4 py-2',
                      isNum(j) && 'num',
                      isNum(j) && !selected && 'text-[var(--color-muted)]',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
