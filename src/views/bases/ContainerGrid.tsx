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

import {
  containerContents,
  slotGridSize,
  slotsByIndex,
  wearFraction,
} from '../../domain/bases.ts'
import type { Container, ItemStack, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { ItemSlot, type SlotContents } from '../../components/ItemSlot.tsx'
import { wearColor } from '../../lib/color.ts'
import { CardTrigger } from '../../components/cards/CardTrigger.tsx'
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

          <ItemList container={container} index={index} />
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
  }
}

/**
 * The same contents as a table: merged by item, because one material fills many
 * slots, except for a stack with wear, a magazine or passives of its own.
 *
 * The condition and ammo columns appear only when something in the container
 * has one, so a chest of ore is still two columns wide.
 */
function ItemList({
  container,
  index,
}: {
  container: Container
  index: SaveIndex
}) {
  const { data } = useRefdataStore()
  if (container.slots.length === 0) return null

  const rows = containerContents(index, container)
  const kinds = new Set(rows.map((r) => r.staticId)).size
  const anyWear = rows.some((r) => r.dynamic?.durability !== undefined)
  const anyAmmo = rows.some((r) => r.dynamic?.ammo)

  return (
    <div className="min-w-[220px] flex-1">
      <div className="label mb-2 flex items-baseline gap-3">
        <span className="flex-1">
          contents <span className="ml-2 normal-case">{kinds} kinds</span>
        </span>
        {anyWear && <span className="w-20 text-right">condition</span>}
        {anyAmmo && <span className="w-14 text-right">ammo</span>}
        <span className="w-16 text-right">count</span>
      </div>
      <div className="divide-y divide-[var(--color-line-faint)] border-y border-[var(--color-line-faint)]">
        {rows.map((row) => {
          const info = data?.items[row.staticId.toLowerCase()]
          const d = row.dynamic
          const wear = wearFraction(d, info?.durability)
          return (
            <CardTrigger
              key={d?.localId ?? row.staticId}
              as="div"
              card={{
                kind: 'item',
                staticId: row.staticId,
                count: row.count,
                dynamicId: d?.localId,
              }}
              focusable
              className="flex items-baseline gap-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {info?.name ?? row.staticId}
              </span>
              {anyWear && (
                <span
                  className="num w-20 shrink-0 text-right"
                  style={{
                    color:
                      wear === undefined
                        ? 'var(--color-muted)'
                        : wearColor(wear),
                  }}
                  title={
                    d?.durability === undefined
                      ? undefined
                      : info?.durability
                        ? `${Math.round(d.durability)} of ${info.durability} durability`
                        : 'Durability left. The full value needs reference data.'
                  }
                >
                  {wear !== undefined
                    ? `${Math.round(wear * 100)}%`
                    : d?.durability !== undefined
                      ? Math.round(d.durability)
                      : ''}
                </span>
              )}
              {anyAmmo && (
                <span className="num w-14 shrink-0 text-right text-[var(--color-muted)]">
                  {d?.ammo
                    ? info?.magazine
                      ? `${d.ammo}/${info.magazine}`
                      : d.ammo
                    : ''}
                </span>
              )}
              <span className="num w-16 shrink-0 text-right text-[var(--color-muted)]">
                {count(row.count)}
              </span>
            </CardTrigger>
          )
        })}
      </div>
    </div>
  )
}
