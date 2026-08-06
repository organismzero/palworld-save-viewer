/** Ticks between 0001-01-01 and the Unix epoch, in .NET's 100ns units. */
const TICKS_AT_UNIX_EPOCH = 621355968000000000

/**
 * Converts a .NET `FDateTime` tick count to a `Date`.
 *
 * Used for a pal's `OwnedTime`. Note that present-day tick values (~6.4e17)
 * sit past `Number.MAX_SAFE_INTEGER`, so they arrive from `JSON.parse` already
 * rounded — accurate to a few microseconds, which is fine for display but
 * means ticks must never be compared for equality or used as an identity.
 *
 * Returns `undefined` rather than an Invalid Date for absent or nonsense input.
 */
export function ticksToDate(ticks: number | undefined): Date | undefined {
  if (ticks === undefined || !Number.isFinite(ticks)) return undefined
  const ms = (ticks - TICKS_AT_UNIX_EPOCH) / 10_000
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

export function relativeTime(date: Date | undefined, now = Date.now()): string {
  if (!date) return '—'
  const diff = date.getTime() - now
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms)
      return RELATIVE.format(Math.round(diff / ms), unit)
  }
  return 'just now'
}

const NUMBER = new Intl.NumberFormat()

export function count(n: number | undefined): string {
  return n === undefined ? '—' : NUMBER.format(n)
}

/** Compact form for large counts, e.g. `1.2M`. */
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact' })

export function compact(n: number | undefined): string {
  return n === undefined ? '—' : COMPACT.format(n)
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
