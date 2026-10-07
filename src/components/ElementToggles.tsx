/**
 * A row of colour-only element filters.
 *
 * Shared by every list that narrows by element, so a pip means the same and
 * behaves the same on the Pals grid, the Breed species list, the pair picker
 * and the Builds opponent list.
 */

import { ELEMENTS, type ElementDef } from '../lib/color.ts'
import { cn } from '../lib/utils.ts'
import { useHoverCard } from './cards/hoverCard.ts'

export function ElementToggles({
  value,
  onChange,
  size = 22,
}: {
  /** Element names that are on. Empty means no filter. */
  value: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  size?: number
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ELEMENTS.map((el) => (
        <ElementToggle
          key={el.name}
          el={el}
          size={size}
          on={value.has(el.name)}
          onToggle={() => {
            const next = new Set(value)
            if (next.has(el.name)) next.delete(el.name)
            else next.add(el.name)
            onChange(next)
          }}
        />
      ))}
    </div>
  )
}

/** One colour-only element filter, whose hover card names the element. */
function ElementToggle({
  el,
  on,
  size,
  onToggle,
}: {
  el: ElementDef
  on: boolean
  size: number
  onToggle: () => void
}) {
  const hover = useHoverCard({ kind: 'element', name: el.name })
  return (
    <button
      type="button"
      {...hover}
      // Colour-only toggles: the card shows the name to the eye, but the
      // accessible name has to be explicit — and `aria-pressed` is the only
      // thing carrying on/off, since visually that is a scale and an opacity
      // change.
      aria-label={el.display}
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        'rounded-full border transition-all',
        on
          ? 'border-[var(--color-signal)] shadow-[var(--glow-signal)]'
          : 'border-[var(--color-line)] opacity-40',
      )}
      style={{ background: el.oklch, width: size, height: size }}
    />
  )
}
