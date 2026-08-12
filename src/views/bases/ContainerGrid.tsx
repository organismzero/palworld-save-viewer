/**
 * The right-hand pane: one container, rendered as the game renders it.
 */

import { slotGridSize, slotsByIndex } from '../../domain/bases.ts'
import type { Container, ItemStack, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { ItemSlot, type SlotContents } from '../../components/ItemSlot.tsx'
import { Panel, Pill } from '../../components/primitives.tsx'
import { count } from '../../lib/format.ts'
import { cn } from '../../lib/utils.ts'
import { useRefdataStore } from '../../store/refdataStore.ts'

const COLUMNS = 6

export function ContainerGrid({
  container,
  index,
  title,
  subtitle,
  onClose,
  /**
   * The capacity caveat. On by default, because a lone grid needs it — but a
   * caller stacking several grids should say it once above them rather than
   * repeat the same paragraph six times.
   */
  note = true,
}: {
  container: Container
  index: SaveIndex
  title: string
  subtitle?: string
  onClose?: () => void
  note?: boolean
}) {
  const { data } = useRefdataStore()

  const occupied = slotsByIndex(container.slots)
  const size = slotGridSize(container.slots, COLUMNS)
  const items = container.slots.reduce((sum, s) => sum + s.count, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-display text-lg leading-tight">
            {title}
          </div>
          {subtitle && <div className="label mt-1 truncate">{subtitle}</div>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <Pill tone={container.confidence === 'exact' ? 'good' : 'neutral'}>
          {container.confidence}
        </Pill>
        <span className="label">
          {container.slots.length} stacks · {count(items)} items
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {container.slots.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            This container is empty.
          </p>
        ) : (
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: size }, (_, i) => (
              <ItemSlot
                key={i}
                size={52}
                contents={contentsFor(occupied.get(i), index, data)}
              />
            ))}
          </div>
        )}

        {/* The one thing about this view that is a guess, said plainly. */}
        {note && <CapacityNote className="mt-3" />}

        <ItemList container={container} />
      </div>
    </div>
  )
}

/** Why an inventory grid's empty cells are not a capacity. */
export function CapacityNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'text-[11px] leading-relaxed text-[var(--color-muted)]',
        className,
      )}
    >
      Saves record only the slots that hold something, so the empty cells below
      the last item are a floor on a container’s real size, not its capacity.
      Gaps between items are real.
    </p>
  )
}

function contentsFor(
  stack: ItemStack | undefined,
  index: SaveIndex,
  data: Refdata | undefined,
): SlotContents | undefined {
  if (!stack) return undefined
  const dynamic = stack.dynamicLocalId
    ? index.dynamicItemById.get(stack.dynamicLocalId)
    : undefined
  return {
    stack,
    info: data?.items[stack.staticId.toLowerCase()],
    dynamic,
    // Resolved here rather than in `ItemSlot`, which is deliberately
    // store-free. An item's passives are the per-instance detail worth
    // hovering for, and raw ids like `PAL_ALLAttack_down1` said nothing.
    passiveNames: dynamic?.passives.map(
      (a) => data?.passives[a.toLowerCase()]?.name ?? a,
    ),
  }
}

/**
 * The same contents as a list.
 *
 * The grid answers "what does this look like"; the list answers "how much of
 * what is in here", which is the question someone hunting for materials
 * actually has. Both are cheap, so both are shown.
 */
function ItemList({ container }: { container: Container }) {
  const { data } = useRefdataStore()
  if (container.slots.length === 0) return null

  // Merged by item, because the same material commonly occupies several slots.
  const merged = new Map<string, number>()
  for (const slot of container.slots) {
    merged.set(slot.staticId, (merged.get(slot.staticId) ?? 0) + slot.count)
  }

  return (
    <Panel className="mt-4 divide-y divide-[var(--color-line-faint)]">
      {[...merged]
        .sort((a, b) => b[1] - a[1])
        .map(([staticId, n]) => {
          const info = data?.items[staticId.toLowerCase()]
          return (
            <div
              key={staticId}
              className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs"
            >
              <span className="truncate">{info?.name ?? staticId}</span>
              <span className="num shrink-0 text-[var(--color-muted)]">
                {count(n)}
              </span>
            </div>
          )
        })}
    </Panel>
  )
}
