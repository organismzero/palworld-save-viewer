/**
 * One container, rendered as the game renders it: the cells on the left, and
 * what is in them as a table on the right.
 *
 * Both, rather than one or the other, because they answer different questions.
 * The grid answers "what does this look like" — the *shape* of a container is
 * information, which is why the empty cells are drawn at all. The table answers
 * "how much of what is in here", which is what somebody hunting for materials
 * actually has. Side by side is the design system's own layout for this pane.
 */

import { slotGridSize, slotsByIndex } from '../../domain/bases.ts'
import type { Container, ItemStack, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { ItemSlot, type SlotContents } from '../../components/ItemSlot.tsx'
import { Pill } from '../../components/primitives.tsx'
import { IconButton } from '../../components/controls.tsx'
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
  /** Omit when the caller's own header already names this container. */
  title?: string
  subtitle?: string
  onClose?: () => void
  note?: boolean
}) {
  const { data } = useRefdataStore()

  const occupied = slotsByIndex(container.slots)
  const size = slotGridSize(container.slots, COLUMNS)
  const items = container.slots.reduce((sum, s) => sum + s.count, 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0">
          {title !== undefined && (
            <div className="truncate text-lg leading-tight">{title}</div>
          )}
          <div
            className={cn(
              'label flex flex-wrap items-center gap-x-2 gap-y-1',
              title !== undefined && 'mt-1.5',
            )}
          >
            <Pill tone={container.confidence === 'exact' ? 'good' : 'neutral'}>
              {container.confidence}
            </Pill>
            <span>
              {container.slots.length} stacks · {count(items)} items
            </span>
            {subtitle && <span className="truncate">· {subtitle}</span>}
          </div>
        </div>
        {onClose && (
          <IconButton label="Close" tone="ghost" size={24} onClick={onClose}>
            ×
          </IconButton>
        )}
      </div>

      {container.slots.length === 0 ? (
        <p className="p-4 text-sm text-[var(--color-muted)]">
          This container is empty.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-wrap items-start gap-6 overflow-y-auto p-4">
          <div className="shrink-0">
            <div
              className="grid gap-[var(--slot-gap)]"
              style={{
                gridTemplateColumns: `repeat(${COLUMNS}, var(--slot-size))`,
              }}
            >
              {Array.from({ length: size }, (_, i) => (
                <ItemSlot
                  key={i}
                  contents={contentsFor(occupied.get(i), index, data)}
                />
              ))}
            </div>
            {/* The one thing about this view that is a guess, said plainly. */}
            {note && <CapacityNote className="mt-3 max-w-[340px]" />}
          </div>

          <ItemList container={container} />
        </div>
      )}
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

/** The same contents, merged by item, because one material fills many slots. */
function ItemList({ container }: { container: Container }) {
  const { data } = useRefdataStore()
  if (container.slots.length === 0) return null

  const merged = new Map<string, number>()
  for (const slot of container.slots) {
    merged.set(slot.staticId, (merged.get(slot.staticId) ?? 0) + slot.count)
  }

  return (
    <div className="min-w-[220px] flex-1">
      <div className="label mb-2">
        contents <span className="ml-2 normal-case">{merged.size} kinds</span>
      </div>
      <div className="divide-y divide-[var(--color-line-faint)] border-y border-[var(--color-line-faint)]">
        {[...merged]
          .sort((a, b) => b[1] - a[1])
          .map(([staticId, n]) => {
            const info = data?.items[staticId.toLowerCase()]
            return (
              <div
                key={staticId}
                className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
              >
                <span className="truncate">{info?.name ?? staticId}</span>
                <span className="num shrink-0 text-[var(--color-muted)]">
                  {count(n)}
                </span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
