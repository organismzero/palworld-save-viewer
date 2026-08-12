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
import { compact, count } from '../lib/format.ts'
import { cn } from '../lib/utils.ts'

/**
 * The common → legendary ramp.
 *
 * Rarity 0 gets no frame at all: most of what fills a chest is rarity 0, and
 * giving it a colour would make every grid a wall of noise. A handful of items
 * carry rarity 5 or a sentinel 99, which clamp to the top of the ramp.
 */
const RARITY = [
  { name: 'common', color: undefined },
  { name: 'uncommon', color: 'var(--color-rarity-uncommon)' },
  { name: 'rare', color: 'var(--color-rarity-rare)' },
  { name: 'epic', color: 'var(--color-rarity-epic)' },
  { name: 'legendary', color: 'var(--color-rarity-legendary)' },
] as const

function rarityOf(rarity: number | undefined): (typeof RARITY)[number] {
  const i = Math.max(0, Math.min(RARITY.length - 1, Math.round(rarity ?? 0)))
  return RARITY[i] ?? RARITY[0]
}

export interface SlotContents {
  stack: ItemStack
  info?: ItemInfo
  dynamic?: DynamicItem
  /**
   * `dynamic.passives` resolved to display names.
   *
   * Resolved by the caller rather than here: this component is deliberately
   * store-free, and the caller already holds the reference data. Falls back to
   * the raw asset ids when reference data is unavailable.
   */
  passiveNames?: string[]
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

  if (!contents) {
    return (
      <div
        aria-hidden
        className="rounded-[4px] border border-dashed border-[var(--color-line-faint)]"
        style={{ width: size, height: size }}
      />
    )
  }

  const { stack, info, dynamic, passiveNames } = contents
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
      title={tooltipText(name, info, dynamic, stack, passiveNames)}
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

/**
 * The native `title` tooltip.
 *
 * The browser's own rather than a styled hover card: it is keyboard-reachable,
 * never clipped by a scroll container, and free. A custom one would have to
 * re-earn all three.
 */
function tooltipText(
  name: string,
  info: ItemInfo | undefined,
  dynamic: DynamicItem | undefined,
  stack: ItemStack,
  passiveNames?: string[],
): string {
  const lines = [`${name} ×${count(stack.count)}`]
  const type = [info?.typeA, info?.typeB].filter(Boolean).join(' · ')
  if (type) lines.push(type)
  if (info?.weight) lines.push(`${info.weight} wt each`)
  if (dynamic?.durability !== undefined) {
    lines.push(
      info?.durability
        ? `durability ${Math.round(dynamic.durability)} / ${info.durability}`
        : `durability ${Math.round(dynamic.durability)}`,
    )
  }
  if (dynamic?.ammo) lines.push(`${dynamic.ammo} rounds loaded`)
  // Prefer resolved names; raw asset ids are the degraded fallback.
  for (const p of passiveNames ?? dynamic?.passives ?? []) lines.push(`+ ${p}`)
  if (info?.description) lines.push('', info.description.replace(/\r/g, ''))
  return lines.join('\n')
}
