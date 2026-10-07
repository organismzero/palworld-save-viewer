/**
 * The one place the app says its game data did not arrive.
 *
 * `degraded` is a designed state, and each view used to word it for itself:
 * the Map had a pill, Guild a footnote, Pals a line that only appeared beside
 * an element filter, and Bases nothing at all — so the same raw ids were
 * explained on one tab and unexplained on the next. This is rendered once, by
 * the shell, above whichever view is open. Views keep only what is theirs to
 * say: the particular thing that is missing because of it.
 *
 * Two failures share the status. The names and tables can fail, or they can
 * arrive and the map art after them fail; the second leaves every tab but the
 * Map exactly as it should be, so it is only mentioned there.
 */

import { useRefdataStore } from '../store/refdataStore.ts'
import { Button } from './controls.tsx'
import { Pill } from './primitives.tsx'

export function RefdataNote({ onMap }: { onMap: boolean }) {
  const status = useRefdataStore((s) => s.status)
  const hasData = useRefdataStore((s) => s.data !== undefined)
  const ensure = useRefdataStore((s) => s.ensure)

  if (status !== 'degraded') return null
  if (hasData && !onMap) return null

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-panel-solid)] px-4 py-1.5"
    >
      <Pill tone="warn">{hasData ? 'no map art' : 'no game data'}</Pill>
      <span className="min-w-0 flex-1 text-sm text-[var(--color-muted)]">
        {hasData
          ? 'The map art could not be loaded, so this is a coordinate grid. Positions are exact.'
          : 'Game data could not be loaded, so names are raw asset ids, the map is a coordinate grid, and anything worked out from game data is missing. Everything read from your save is exact.'}
      </span>
      <Button size="sm" onClick={() => void ensure(true)}>
        Retry
      </Button>
    </div>
  )
}
