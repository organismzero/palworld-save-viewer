/**
 * A named thing that takes you to where it lives.
 *
 * The app has always known how to do this — `jump()` switches view and hands
 * the destination a one-shot focus — but only the command palette called it.
 * So a pal's owner, a step's parent, a player's base were all names you had to
 * read, remember and go and find again on another tab.
 *
 * Composes with the hover card: most of these names already raise one, and a
 * link that cost you the card would be a poor trade. Hover and focus still show
 * it; a click or Enter navigates.
 */

import type { ReactNode } from 'react'

import { formatMapPos, posToMap } from '../domain/coords.ts'
import type { Vec3 } from '../domain/types.ts'
import { cn } from '../lib/utils.ts'
import { useUiStore, type Focus, type ViewId } from '../store/uiStore.ts'
import { useHoverCard, type CardDescriptor } from './cards/hoverCard.ts'

export function Jump({
  view,
  focus,
  card,
  title,
  quiet,
  className,
  children,
}: {
  view: ViewId
  focus: Focus
  card?: CardDescriptor
  /** Where this goes, for when the name alone does not say. */
  title?: string
  /**
   * Keep the text its own colour and let the arrow alone say "link".
   *
   * For a name inside a list row, where a column of cyan names would make the
   * one accent colour mean nothing.
   */
  quiet?: boolean
  className?: string
  children: ReactNode
}) {
  const jump = useUiStore((s) => s.jump)
  const trigger = useHoverCard(card)
  return (
    <button
      type="button"
      {...trigger}
      title={title}
      // Stopped: several of these sit inside a row that is itself clickable.
      onClick={(e) => {
        e.stopPropagation()
        jump(view, focus)
      }}
      className={cn(
        'group/jump inline-flex max-w-full min-w-0 items-baseline gap-1 text-left',
        !quiet && 'text-[var(--color-signal)]',
        className,
      )}
    >
      {typeof children === 'string' ? (
        <span className="min-w-0 truncate group-hover/jump:underline">
          {children}
        </span>
      ) : (
        children
      )}
      <span
        aria-hidden
        className={cn(
          'shrink-0 text-[var(--color-signal)]',
          quiet && 'opacity-60 group-hover/jump:opacity-100',
        )}
      >
        →
      </span>
    </button>
  )
}

/**
 * A position that opens the map on whatever is standing there.
 *
 * Only for a position the map can show. The World Tree has a coordinate space
 * and an image of its own, which this app does not draw, so something up there
 * gets its coordinates and a word saying where they are — a link would open the
 * map only for it to answer that the thing is not on it.
 */
export function MapJump({
  id,
  pos,
  className,
}: {
  /** What the map knows the thing by: a pal, player or marker id. */
  id: string
  pos: Vec3 | undefined
  className?: string
}) {
  const at = posToMap(pos)
  if (!at) return <>—</>
  if (at.map !== 'overworld') {
    return (
      <span
        className={className}
        title="In the World Tree, which has its own map and is not drawn here"
      >
        {formatMapPos(at)} · World Tree
      </span>
    )
  }
  return (
    <Jump
      view="map"
      focus={{ kind: 'map', id }}
      title="Show on the map"
      className={className}
    >
      {formatMapPos(at)}
    </Jump>
  )
}
