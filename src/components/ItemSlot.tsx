/**
 * The game-style inventory cell.
 *
 * Deliberately square, deliberately bordered, deliberately rendered even when
 * empty — an inventory grid's *shape* is information, and a list of only the
 * occupied slots throws that away.
 *
 * Rarity is carried by the frame rather than by a label, which is how the game
 * does it and what lets a full chest be read at a glance.
 */

import type { DynamicItem, ItemStack } from '../domain/types.ts'
import type { ItemInfo } from '../refdata/refdata.ts'
import { GameIcon } from './GameIcon.tsx'
import { useHoverCard } from './cards/hoverCard.ts'
import { compact } from '../lib/format.ts'
import { rarityOf } from '../lib/rarity.ts'
import { cn } from '../lib/utils.ts'

export interface SlotContents {
  stack: ItemStack
  info?: ItemInfo
  dynamic?: DynamicItem
}

export function ItemSlot({
  contents,
  size = 52,
  selected,
  onClick,
}: {
  contents?: SlotContents
  size?: number
  selected?: boolean
  onClick?: () => void
}) {
  const frame = rarityOf(contents?.info?.rarity)
  const hover = useHoverCard(
    contents && {
      kind: 'item',
      staticId: contents.stack.staticId,
      count: contents.stack.count,
      dynamicId: contents.stack.dynamicLocalId,
    },
  )

  if (!contents) {
    return (
      <div
        aria-hidden
        className="rounded-slot border border-dashed border-[var(--color-line-faint)]"
        style={{ width: size, height: size }}
      />
    )
  }

  const { stack, info, dynamic } = contents
  const name = info?.name ?? stack.staticId
  // Durability is only meaningful against the item's full value; without the
  // reference data there is no denominator and so no bar.
  const wear =
    dynamic?.durability !== undefined && info?.durability
      ? Math.max(0, Math.min(1, dynamic.durability / info.durability))
      : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      {...hover}
      aria-label={`${name} ×${stack.count}`}
      style={{
        width: size,
        height: size,
        borderColor: selected
          ? 'var(--color-signal)'
          : (frame.color ?? 'var(--color-line)'),
        // A sunken well behind the art, with the rarity glow rising from the
        // bottom edge as the game lights its cells.
        background: frame.color
          ? `radial-gradient(120% 120% at 50% 120%, color-mix(in oklch, ${frame.color} 22%, transparent), transparent 70%), rgb(3 9 13 / 0.75)`
          : 'rgb(3 9 13 / 0.75)',
      }}
      className={cn(
        // Hover raises the border and never moves the cell: a grid of 300 slots
        // that jumps under the cursor is unusable, and the design system's own
        // rule is that hover changes colour rather than position.
        'relative shrink-0 overflow-hidden rounded-slot border shadow-[var(--edge-sunken)] transition-colors',
        !selected && 'hover:border-[var(--color-signal)]',
        selected && 'shadow-[var(--glow-signal)]',
      )}
    >
      <span className="flex h-full w-full items-center justify-center p-1">
        <GameIcon path={info?.icon} name={name} size={size - 12} />
      </span>

      {stack.count > 1 && (
        <span className="num absolute right-1 bottom-0.5 text-[11px] leading-none text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
          {compact(stack.count)}
        </span>
      )}

      {wear !== undefined && (
        <span className="absolute inset-x-[3px] top-[3px] h-[2px] overflow-hidden bg-black/55">
          <span
            className="block h-full"
            style={{ width: `${wear * 100}%`, background: wearColor(wear) }}
          />
        </span>
      )}

      {dynamic && dynamic.passives.length > 0 && (
        <span
          aria-hidden
          className="absolute top-[3px] left-[3px] h-1.5 w-1.5 rounded-full bg-[var(--color-signal)]"
        />
      )}
    </button>
  )
}

/** Wear genuinely is a good / warning / bad scale, so it keeps status colour. */
function wearColor(fraction: number): string {
  if (fraction > 0.5) return 'var(--color-hp)'
  if (fraction > 0.2) return 'var(--color-stamina)'
  return 'var(--color-danger)'
}
