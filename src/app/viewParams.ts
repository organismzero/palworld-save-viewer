/**
 * View state in the URL hash, without a router.
 *
 * ## The one-writer rule
 *
 * `useHashSync` in `AppShell` is the only thing that assigns to
 * `location.hash`. Views never touch it. They publish a serialised query string
 * into `uiStore.viewParams` and the shell folds that into the hash on the next
 * commit — which is what stops N views racing one address bar.
 *
 * ## Serialising by hand
 *
 * `URLSearchParams.toString()` percent-encodes `,` to `%2C`, which turns a
 * perfectly readable `el=fire,water` into noise, and it offers no ordering
 * guarantee — so an unchanged view could still produce a different string and
 * trigger a pointless history write. Both matter more here than the handful of
 * escaping rules being reimplemented.
 *
 * ## Short ids
 *
 * A GUID is 32 hex characters and three of them would make the hash
 * unreadable. Only the first 8 go in, resolved back by prefix. For player UIDs
 * that is exact — Palworld's player GUIDs are `d4c3b2a1-0000-…`, so everything
 * after the first block is padding. For pal instance ids it is a real 32-bit
 * prefix, where a birthday collision at 5,000 pals is around 0.3%; an ambiguous
 * prefix resolves to *nothing* rather than to a guess, and the view says so.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Guid } from '../domain/types.ts'
import { useUiStore, type ViewId } from '../store/uiStore.ts'

/**
 * How a view's state becomes query params and back.
 *
 * `encode` returns **only** entries that differ from the defaults, so an
 * untouched view contributes nothing and `#/pals` stays clean.
 */
export interface ParamCodec<T> {
  encode: (value: T, defaults: T) => Record<string, string>
  decode: (raw: URLSearchParams, defaults: T) => T
}

/** `#/pals?q=x&el=fire` → `{ view: 'pals', qs: 'q=x&el=fire' }`. */
export function parseHash(hash: string): { view?: string; qs: string } {
  const raw = hash.replace(/^#\/?/, '')
  const q = raw.indexOf('?')
  if (q === -1) return { view: raw || undefined, qs: '' }
  return { view: raw.slice(0, q) || undefined, qs: raw.slice(q + 1) }
}

/**
 * Entries to a query string, in a stable key order.
 *
 * Only the characters that would actually break a hash fragment are escaped —
 * `&`, `=`, `#`, `%` and whitespace. `,` is left alone on purpose; it is legal
 * in a fragment and it is what makes a multi-select param readable.
 */
export function serialiseParams(entries: Record<string, string>): string {
  return Object.keys(entries)
    .sort()
    .filter((k) => entries[k] !== '')
    .map((k) => `${k}=${escapeValue(entries[k]!)}`)
    .join('&')
}

function escapeValue(v: string): string {
  return v.replace(/[&=#%\s]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`) // prettier-ignore
}

/** First 8 hex characters of a normalised GUID. */
export function shortId(id: Guid): string {
  return id.replace(/-/g, '').slice(0, 8).toLowerCase()
}

/**
 * A short id back to the full one, or nothing.
 *
 * Ambiguity resolves to `undefined`, never to the first match — selecting the
 * wrong pal is a worse failure than selecting none, and the caller can say "not
 * in this save" either way.
 */
export function resolveShortId(
  short: string | undefined,
  ids: Iterable<Guid>,
): Guid | undefined {
  if (!short) return undefined
  const needle = short.toLowerCase()
  let found: Guid | undefined
  for (const id of ids) {
    if (!id.toLowerCase().startsWith(needle)) continue
    if (found) return undefined
    found = id
  }
  return found
}

/* -------------------------------------------------------------------------
   The hook
   ------------------------------------------------------------------------- */

export type Updater<T> = T | ((prev: T) => T)

/**
 * View-local state that mirrors itself into the hash.
 *
 * A drop-in for `useState` from the view's point of view. Three things it does
 * that a plain `useState` cannot:
 *
 * 1. **Seeds from the hash on mount**, so a shared link arrives with its
 *    filters applied.
 * 2. **Lets `seed` win over the hash.** A ⌘K jump is intent expressed *now*;
 *    the hash is history. After the view consumes the focus its resulting
 *    state is published, which is what makes a jump linkable in turn.
 * 3. **Re-decodes on a browser navigation**, keyed on `paramsEpoch` rather
 *    than on the string, because a lossy round-trip would make a string compare
 *    quietly wrong.
 *
 * `codec` is read through a ref rather than as a dependency: it is built over
 * the save index for prefix resolution, so its identity changes on every player
 * merge, and re-decoding there would stomp whatever the user has clicked since.
 */
export function useViewParams<T extends object>(
  view: ViewId,
  defaults: T,
  codec: ParamCodec<T>,
  seed?: () => Partial<T> | undefined,
): [T, (next: Updater<T>) => void] {
  // Held in a ref and refreshed in an effect rather than assigned during
  // render. The initial value is already the right one for the mount decode,
  // and every later decode happens inside an effect that runs after this.
  const codecRef = useRef(codec)
  useEffect(() => {
    codecRef.current = codec
  })

  const publishParams = useUiStore((s) => s.publishParams)
  const epoch = useUiStore((s) => s.paramsEpoch)

  const [value, setValue] = useState<T>(() => {
    // `codec` directly, not the ref: this runs once, on mount, and the
    // mount-time codec is exactly the right one.
    const fromHash = codec.decode(
      new URLSearchParams(useUiStore.getState().viewParams[view] ?? ''),
      defaults,
    )
    const fromSeed = seed?.()
    return fromSeed ? { ...fromHash, ...fromSeed } : fromHash
  })

  // Publish on every change, including the first: a jump-seeded view has state
  // the hash does not know about yet, and that is exactly what makes the jump
  // shareable.
  useEffect(() => {
    publishParams(
      view,
      serialiseParams(codecRef.current.encode(value, defaults)),
    )
    // `defaults` is a literal at the call site and would be a new object every
    // render; the value is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, view, publishParams])

  const firstEpoch = useRef(epoch)
  useEffect(() => {
    if (epoch === firstEpoch.current) return
    setValue(
      codecRef.current.decode(
        new URLSearchParams(useUiStore.getState().viewParams[view] ?? ''),
        defaults,
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, view])

  const set = useCallback((next: Updater<T>) => {
    setValue((prev) =>
      typeof next === 'function' ? (next as (p: T) => T)(prev) : next,
    )
  }, [])

  return [value, set]
}

/* -------------------------------------------------------------------------
   Codec helpers — the four shapes the views actually use
   ------------------------------------------------------------------------- */

/**
 * A numeric param, or the default.
 *
 * The null check is not redundant: `Number(null)` is `0`, not `NaN`, so an
 * absent `lvl` would come back as a minimum level of 0 rather than 1 — a filter
 * silently different from the default it claims to be.
 */
export function num(raw: URLSearchParams, key: string, fallback: number) {
  const s = raw.get(key)
  if (s === null || s === '') return fallback
  const v = Number(s)
  return Number.isFinite(v) ? v : fallback
}

export function str(raw: URLSearchParams, key: string, fallback: string) {
  return raw.get(key) ?? fallback
}

export function bool(raw: URLSearchParams, key: string, fallback: boolean) {
  const v = raw.get(key)
  return v === null ? fallback : v === '1'
}

/** A comma-separated set, sorted on the way out so the URL is stable. */
export function list(raw: URLSearchParams, key: string): string[] {
  const v = raw.get(key)
  return v ? v.split(',').filter(Boolean) : []
}

export function encodeList(values: Iterable<string>): string {
  return [...values].sort().join(',')
}
