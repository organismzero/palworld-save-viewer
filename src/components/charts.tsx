/**
 * Hand-rolled SVG charts.
 *
 * No chart library, on purpose. These are four simple shapes, and every chart
 * library brings its own opinions about type, colour, grid lines and tooltips
 * that then have to be fought back out to match the design system. Sixty lines
 * of `<path>` costs less than that argument and renders identically in every
 * browser.
 *
 * Shared rules: values are the only thing that carries colour, axes are
 * hairlines, and every chart degrades to something readable at any width.
 */

import { useEffect, useRef, useState } from 'react'

import { count } from '../lib/format.ts'
import { cn } from '../lib/utils.ts'

/* -------------------------------------------------------------------------
   Count-up
   ------------------------------------------------------------------------- */

/**
 * A number that animates from zero on mount.
 *
 * Uses `requestAnimationFrame` directly rather than a spring library: the
 * whole behaviour is one eased interpolation, and this way the dashboard costs
 * nothing to load. `prefers-reduced-motion` is honoured by jumping straight to
 * the value — checked at mount, which is when the animation would start.
 */
export function CountUp({
  value,
  duration = 400,
  delay = 0,
  format = count,
}: {
  value: number
  duration?: number
  delay?: number
  format?: (n: number) => string
}) {
  // Read once, at mount. Someone who has asked for less motion gets the final
  // number rendered directly rather than animated-then-corrected, so the
  // animated value is never even consulted.
  const [reduced] = useState(
    () =>
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [animated, setAnimated] = useState(0)
  const frame = useRef(0)

  useEffect(() => {
    if (reduced) return

    let start = 0
    const timer = setTimeout(() => {
      const step = (now: number) => {
        start ||= now
        const t = Math.min(1, (now - start) / duration)
        // easeOutCubic — fast off the mark, settles rather than stops.
        setAnimated(Math.round(value * (1 - (1 - t) ** 3)))
        if (t < 1) frame.current = requestAnimationFrame(step)
      }
      frame.current = requestAnimationFrame(step)
    }, delay)

    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame.current)
    }
  }, [value, duration, delay, reduced])

  return <>{format(reduced ? value : animated)}</>
}

/* -------------------------------------------------------------------------
   Ring
   ------------------------------------------------------------------------- */

/** A progress ring, for the base camp level. */
export function Ring({
  value,
  max,
  size = 96,
  label,
  sub,
}: {
  value: number
  max: number
  size?: number
  label?: string
  sub?: string
}) {
  const stroke = 4
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-signal)"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-xl leading-none">{label ?? value}</span>
        {sub && <span className="label mt-1">{sub}</span>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Histogram
   ------------------------------------------------------------------------- */

export function Histogram({
  bins,
  height = 120,
  color = 'var(--color-signal)',
}: {
  bins: { from: number; to: number; count: number }[]
  height?: number
  color?: string
}) {
  if (bins.length === 0) return <Empty />
  const max = Math.max(...bins.map((b) => b.count), 1)

  return (
    <div>
      <div
        className="flex items-end gap-[3px]"
        style={{ height }}
        role="img"
        aria-label={`Level distribution across ${bins.length} bands`}
      >
        {bins.map((b) => (
          <div
            key={b.from}
            title={`Level ${b.from}–${b.to}: ${count(b.count)}`}
            className="min-w-0 flex-1 transition-opacity hover:opacity-80"
            style={{
              // A one-pal band must still be visible, or the tail of the
              // distribution silently disappears.
              height: `${Math.max(2, (b.count / max) * height)}px`,
              background: color,
              opacity: 0.35 + 0.65 * (b.count / max),
            }}
          />
        ))}
      </div>
      <div className="label mt-1.5 flex justify-between">
        <span>{bins[0]?.from}</span>
        <span>{bins[bins.length - 1]?.to}</span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------
   Donut
   ------------------------------------------------------------------------- */

export function Donut({
  slices,
  size = 150,
  thickness = 22,
}: {
  slices: { display: string; color: string; count: number }[]
  size?: number
  thickness?: number
}) {
  const total = slices.reduce((n, s) => n + s.count, 0)
  if (total === 0) return <Empty />

  const r = (size - thickness) / 2

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={`Element distribution of ${count(total)} pals`}
        className="shrink-0"
      >
        {layout(slices, total).map(({ slice, from, to }) => (
          <path
            key={slice.display}
            d={arc(size / 2, size / 2, r, from, to)}
            fill="none"
            stroke={slice.color}
            strokeWidth={thickness}
          >
            <title>{`${slice.display}: ${count(slice.count)}`}</title>
          </path>
        ))}
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="num"
          fill="var(--color-text)"
          fontSize={size / 6}
        >
          {count(total)}
        </text>
      </svg>

      <ul className="min-w-0 flex-1 space-y-1">
        {slices.map((s) => (
          <li key={s.display} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: s.color }}
            />
            <span className="truncate">{s.display}</span>
            <span className="num ml-auto shrink-0 text-[var(--color-muted)]">
              {count(s.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Cumulative start/end angles, computed outside the component.
 *
 * The running total has to live somewhere; a local in a plain function is the
 * honest home for it. Accumulating into a variable captured by a JSX callback
 * would work today and break the moment the list re-renders partially.
 */
function layout<T extends { count: number; display: string; color: string }>(
  slices: T[],
  total: number,
): { slice: T; from: number; to: number }[] {
  const out: { slice: T; from: number; to: number }[] = []
  let angle = -Math.PI / 2
  for (const slice of slices) {
    const sweep = (slice.count / total) * Math.PI * 2
    out.push({ slice, from: angle, to: angle + sweep })
    angle += sweep
  }
  return out
}

/**
 * A single donut segment as a stroked arc.
 *
 * A full circle cannot be drawn as one arc — start and end coincide and the
 * renderer draws nothing — so a lone slice is emitted as two half circles.
 */
function arc(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
): string {
  if (to - from >= Math.PI * 2 - 1e-6) {
    return [
      `M ${cx} ${cy - r}`,
      `A ${r} ${r} 0 1 1 ${cx} ${cy + r}`,
      `A ${r} ${r} 0 1 1 ${cx} ${cy - r}`,
    ].join(' ')
  }
  const x1 = cx + r * Math.cos(from)
  const y1 = cy + r * Math.sin(from)
  const x2 = cx + r * Math.cos(to)
  const y2 = cy + r * Math.sin(to)
  const large = to - from > Math.PI ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

/* -------------------------------------------------------------------------
   Bars
   ------------------------------------------------------------------------- */

/** A ranked list with an inline bar. Plain DOM — this needs no SVG. */
export function BarList({
  rows,
  color = 'var(--color-signal)',
}: {
  rows: { key: string; label: string; value: number; hint?: string }[]
  color?: string
}) {
  if (rows.length === 0) return <Empty />
  const max = Math.max(...rows.map((r) => r.value), 1)

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate">{row.label}</span>
            <span className="num shrink-0 text-[var(--color-muted)]">
              {row.hint ?? count(row.value)}
            </span>
          </div>
          <div className="mt-1 h-[3px] w-full overflow-hidden bg-[var(--color-line)]">
            <div
              className="h-full"
              style={{
                width: `${(row.value / max) * 100}%`,
                background: color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------
   Radar
   ------------------------------------------------------------------------- */

export function Radar({
  axes,
  size = 200,
}: {
  axes: { label: string; value: number }[]
  size?: number
}) {
  if (axes.length < 3) return <Empty />
  const max = Math.max(...axes.map((a) => a.value), 1)
  const cx = size / 2
  const cy = size / 2
  // Labels sit outside the outer ring. They are allowed to overflow the SVG
  // box rather than being squeezed inside it — "Generating Electricity" does
  // not fit at any radius that leaves the web a usable size, and a clipped
  // label ("Gene", "sporting") is worse than one that overhangs.
  const r = size / 2 - 12

  const point = (i: number, fraction: number) => {
    const angle = (i / axes.length) * Math.PI * 2 - Math.PI / 2
    return [
      cx + r * fraction * Math.cos(angle),
      cy + r * fraction * Math.sin(angle),
    ] as const
  }

  const polygon = axes
    .map((a, i) => point(i, a.value / max).join(','))
    .join(' ')

  return (
    <svg
      width={size}
      height={size}
      role="img"
      aria-label="Work suitability coverage"
      className="mx-auto block overflow-visible"
    >
      {/* Web, at quarters. Gives the shape a scale without an axis label. */}
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={axes.map((_, i) => point(i, ring).join(',')).join(' ')}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={0.5}
          opacity={ring === 1 ? 0.9 : 0.45}
        />
      ))}
      {axes.map((a, i) => {
        const [x, y] = point(i, 1)
        return (
          <line
            key={a.label}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="var(--color-line)"
            strokeWidth={0.5}
            opacity={0.45}
          />
        )
      })}

      <polygon
        points={polygon}
        fill="color-mix(in oklch, var(--color-signal) 22%, transparent)"
        stroke="var(--color-signal)"
        strokeWidth={1.5}
      />

      {axes.map((a, i) => {
        const [x, y] = point(i, 1.1)
        return (
          <text
            key={a.label}
            x={x}
            y={y}
            textAnchor={
              Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end'
            }
            dominantBaseline="central"
            // The 11px floor's one exception. Axis labels at 11px overlap at
            // this radius, and growing the chart to fit them is a layout change
            // for another day — see docs/redesign.md, decision 10.
            fontSize={8}
            fill="var(--color-muted)"
            fontFamily="var(--font-mono)"
          >
            {/* Full name and value on hover; the axis shows the short form. */}
            <title>{`${a.label}: ${count(a.value)}`}</title>
            {shortLabel(a.label)}
          </text>
        )
      })}
    </svg>
  )
}

/**
 * First word only, for a radar axis.
 *
 * The 13 work names stay distinct under this rule — "Generating Electricity"
 * and "Medicine Production" have no collisions with anything else in the set —
 * and the full name is one hover away.
 */
function shortLabel(label: string): string {
  return label.split(' ')[0] ?? label
}

function Empty() {
  return (
    <p className={cn('label py-6 text-center')}>not enough data to chart</p>
  )
}
