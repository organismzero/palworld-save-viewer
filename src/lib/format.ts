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

/**
 * A save's own clock reading, rendered without claiming to know the instant.
 *
 * Palworld writes a save's `Timestamp`, and a pal's `OwnedTime`, as a **naive
 * wall clock**, not UTC. (A player's `LastOnlineDateTime` is the exception: it
 * *is* UTC — see below.) Measured:
 * an autosave whose folder the server named `2026.08.11-15.31.41` carries ticks
 * that `ticksToDate` renders as `15:31:41Z` — the digits agree, so the game wrote
 * whatever its own clock said with no zone attached.
 *
 * A save records no timezone, so the *instant* is genuinely unknown and any
 * "3 hours ago" derived from one is wrong by the server's offset — on a UTC+10
 * host, by ten hours, which reads as a save written in the future. So this
 * formats the reading rather than the moment, and callers should say whose clock
 * it is.
 *
 * Differences between two tick values are unaffected, because both sit in the
 * same unknown frame — "caught nine days before this save was written" needs no
 * timezone and is exact. That is what {@link beforeSave} is for.
 *
 * ## The one that is UTC
 *
 * `LastOnlineDateTime` in a player's save is a real instant. Measured on two
 * servers: on a host whose clock is UTC, each player's captures begin at their
 * last-online value; on a host ten hours ahead there are none for exactly ten
 * hours after it, and then they begin. So `relativeTime` is right for last
 * online and wrong for caught, and the two must never be subtracted from each
 * other — the answer is off by the host's offset.
 */
export function saveClock(ticks: number | undefined): string | undefined {
  const d = ticksToDate(ticks)
  if (!d) return undefined
  // UTC getters, deliberately: `ticksToDate` put the wall-clock digits in the
  // UTC slots, so reading them back out recovers exactly what the game wrote.
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  )
}

/**
 * A wall-clock reading as ISO 8601 with no zone, for export: the digits the
 * game wrote, and no `Z` claiming they are UTC.
 */
export function saveClockIso(ticks: number | undefined): string | undefined {
  return ticksToDate(ticks)?.toISOString().slice(0, 19)
}

/**
 * How long before the save was written something happened, in words.
 *
 * Both readings come off the same host clock, so their difference is exact
 * where either one against `Date.now()` would be wrong by that host's offset.
 * Falls back to the bare reading when the save's own time is not known.
 */
export function beforeSave(
  ticks: number | undefined,
  savedAtTicks: number | undefined,
): string {
  const then = ticksToDate(ticks)
  if (!then) return '—'
  const saved = ticksToDate(savedAtTicks)
  if (!saved) return saveClock(ticks) ?? '—'
  const diff = saved.getTime() - then.getTime()
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) {
      const n = Math.round(diff / ms)
      return `${n} ${unit}${n === 1 ? '' : 's'} before the save`
    }
  }
  return 'just before the save'
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
