/**
 * The save's own health, one click from anywhere.
 *
 * `stats.warnings` is the format canary this whole parser was built around —
 * a Palworld patch that moves a field shows up here as a dangling-reference
 * count long before anyone notices a half-empty screen. Burying it at the
 * bottom of the summary page wastes that, so it gets a permanent indicator in
 * the header: quiet and grey when everything resolved, amber with a count when
 * it did not.
 */

import { useEffect, useRef, useState } from 'react'

import type { SaveIndex } from '../domain/types.ts'
import { bytes, count, relativeTime } from '../lib/format.ts'
import { useSaveStore } from '../store/saveStore.ts'
import { cn } from '../lib/utils.ts'

export function Diagnostics({ index }: { index: SaveIndex }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { fileName, fileBytes, timings, playerFiles, localData, restoredFrom } =
    useSaveStore()
  const s = index.stats

  // A popover that only closes via its own button is a trap on touch.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The client save is parsed on its own path, so its warnings never reach
  // `stats.warnings`. They are the same kind of canary and belong in the same
  // list, or a format change in `LocalData` would land silently.
  const warnings = [...s.warnings, ...(localData?.warnings ?? [])]
  const total = warnings.reduce((n, w) => n + w.count, 0)
  const partial = s.playerDetails < s.playersInLevel
  const attention = warnings.length > 0 || partial

  // The badge has to say which of the two things it is flagging. Showing "ok"
  // in amber because player saves are missing reads as a contradiction, and
  // teaches people to ignore the colour.
  const badge = warnings.length > 0 ? count(total) : partial ? 'partial' : 'ok'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={
          warnings.length > 0
            ? `Save diagnostics — ${warnings.length} warnings`
            : partial
              ? `Save diagnostics — ${s.playersInLevel - s.playerDetails} player saves missing`
              : 'Save diagnostics — no warnings'
        }
        className={cn(
          'flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-xs transition-colors',
          attention
            ? 'border-[oklch(0.80_0.15_85)]/50 text-[oklch(0.85_0.14_85)]'
            : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-signal)]',
        )}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: attention
              ? 'oklch(0.80 0.15 85)'
              : 'oklch(0.78 0.16 150)',
          }}
        />
        <span className="num">{badge}</span>
      </button>

      {open && (
        <div className="raised-edge absolute top-full right-0 z-40 mt-2 w-80 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <div className="label mb-2">save diagnostics</div>

          <dl className="space-y-1 text-xs">
            <Row label="file" value={fileName ?? '—'} />
            <Row label="size" value={fileBytes ? bytes(fileBytes) : '—'} />
            {index.meta.engineVersion && (
              <Row label="engine" value={index.meta.engineVersion} />
            )}
            <Row
              label="player saves"
              value={`${s.playerDetails} of ${s.playersInLevel}`}
            />
            {/* Wraps rather than truncates: the three figures together are
                the point, and half of them is worse than a second line. */}
            <Row
              label="containers"
              wrap
              value={`${count(s.attributedExact)} exact · ${count(
                s.attributedInferred,
              )} inferred · ${count(s.unattributedContainers)} unknown`}
            />
            {/* A restored session was never parsed, so it has no timings.
                Saying so beats dropping the row, which reads as a bug. */}
            {restoredFrom !== undefined ? (
              <Row
                label="session"
                value={`restored · saved ${relativeTime(new Date(restoredFrom))}`}
              />
            ) : (
              timings && (
                <Row
                  label="parsed in"
                  value={`${Object.values(timings)
                    .reduce((a, b) => a + b, 0)
                    .toFixed(0)} ms`}
                />
              )
            )}
          </dl>

          <div className="mt-3 border-t border-[var(--color-line)]/40 pt-3">
            {warnings.length === 0 ? (
              <p className="text-xs text-[oklch(0.78_0.16_150)]">
                Every cross-reference in this save resolved.
              </p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {warnings.map((w) => (
                  <li key={w.kind + w.detail}>
                    <span className="num text-[oklch(0.85_0.14_85)]">
                      {count(w.count)}×
                    </span>{' '}
                    {w.detail}
                    <div className="num text-[10px] text-[var(--color-muted)]/70">
                      {w.kind}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {Object.values(playerFiles).some((f) => f.status === 'rejected') && (
            <div className="mt-3 border-t border-[var(--color-line)]/40 pt-3">
              <div className="label mb-1.5">rejected files</div>
              <ul className="space-y-1 text-[11px] text-[var(--color-muted)]">
                {Object.values(playerFiles)
                  .filter((f) => f.status === 'rejected')
                  .map((f) => (
                    <li key={f.fileName}>
                      <span className="num">{f.fileName}</span>
                      {f.reason ? ` — ${f.reason}` : ''}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  wrap,
}: {
  label: string
  value: string
  wrap?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label shrink-0">{label}</dt>
      <dd
        className={cn(
          'num text-right text-[var(--color-muted)]',
          wrap ? 'min-w-0' : 'truncate',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
