import type { Pal } from '../domain/types.ts'
import { storedText } from '../domain/palState.ts'
import { Pill } from './primitives.tsx'

/**
 * Marks a pal that is in its owner's Dimensional Pal Storage.
 *
 * Renders nothing for any other pal, so it can sit in every row unconditionally.
 * It exists because such a pal is not where a plan's other parents are: it has
 * to be taken out of storage before it can go in a pen, and the page and slot
 * to take it from are on the hover.
 */
export function StoredPill({
  pal,
  short = false,
}: {
  pal: Pal
  /** One word, for a list row too narrow to give up the pal's name for it. */
  short?: boolean
}) {
  const where = storedText(pal)
  if (!where) return null
  return (
    <Pill title={`${where}. Take it out before it can be used.`}>
      {short ? 'stored' : 'dim. storage'}
    </Pill>
  )
}
