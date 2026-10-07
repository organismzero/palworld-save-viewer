import type { ReactNode } from 'react'

import { useHoverCard, type CardDescriptor } from './hoverCard.ts'

/**
 * `useHoverCard` as an element, for triggers rendered inside a `.map` where a
 * hook cannot be called.
 */
export function CardTrigger({
  card,
  as: Tag = 'span',
  className,
  focusable,
  children,
}: {
  card: CardDescriptor | undefined
  as?: 'span' | 'li' | 'div'
  className?: string
  /** In the tab order. Not inside anything already focusable. */
  focusable?: boolean
  children: ReactNode
}) {
  const trigger = useHoverCard(card)
  return (
    <Tag
      {...trigger}
      tabIndex={focusable && card ? 0 : undefined}
      className={className}
    >
      {children}
    </Tag>
  )
}
