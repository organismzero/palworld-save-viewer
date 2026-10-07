/**
 * A top-down plan of one base.
 *
 * Cheap — the coordinate transform already exists for the world map — and it
 * is the thing that turns a list of 265 structures into a place.
 *
 * **Orientation must match the world map**, or the two views disagree about
 * where north is and both become untrustworthy. So positions go through
 * `posToMap` (which includes the world→map axis swap) and then flip Y for
 * screen space, exactly as `mapToPixel` does. Plotting raw world x/y would be
 * rotated 90° and mirrored.
 */

import { useRef, useState, type KeyboardEvent } from 'react'

import { posToMap, worldToMap } from '../../domain/coords.ts'
import type { Base, Guid, Structure } from '../../domain/types.ts'

const SIZE = 260

export function BasePlan({
  base,
  structures,
  selectedId,
  onSelect,
  chestIds,
  nameOf,
  tintOf,
}: {
  base: Base
  structures: Structure[]
  selectedId?: Guid
  onSelect: (id: Guid) => void
  /** What a structure is called. The dots carry no other label. */
  nameOf: (s: Structure) => string
  /** Structures that hold a container, drawn larger. */
  chestIds: Set<Guid>
  /**
   * A colour for a structure, by whoever built it. When given, colour means the
   * builder and nothing else: storage is told by size alone, and a structure
   * with no builder is grey. The storage accent is too close to the first
   * builder's amber to share a plan with it.
   */
  tintOf?: (s: Structure) => string | undefined
}) {
  const [active, setActive] = useState<number>()
  const dots = useRef<(SVGCircleElement | null)[]>([])

  const origin = posToMap(base.pos)
  if (!origin) return null

  const radius = worldToMap(base.areaRange)

  const points = structures
    .flatMap((s) => {
      const at = posToMap(s.pos)
      // A structure in the World Tree's coordinate space cannot be plotted
      // against an overworld base; skipping beats drawing it in the wrong place.
      if (!at || at.map !== origin.map) return []
      return [{ s, dx: at.mx - origin.mx, dy: -(at.my - origin.my) }]
    })
    // Reading order, top row first, so the arrow keys sweep the plan the way
    // the eye does rather than in the order the save happened to list things.
    .sort((a, b) => a.dy - b.dy || a.dx - b.dx)

  // Fit whatever is actually there — buildings routinely sit outside the
  // camp's nominal radius, and cropping them would be a lie about the base.
  const extent = Math.max(
    radius * 1.05,
    ...points.map((p) => Math.max(Math.abs(p.dx), Math.abs(p.dy)) * 1.05),
  )
  const scale = SIZE / 2 / extent

  /**
   * One tab stop for the whole plan, and arrow keys within it.
   *
   * A base has hundreds of structures. A tab stop on each would put the rest of
   * the page that many presses away, which is a worse plan for a keyboard than
   * the one it had, where the dots could not be reached at all.
   */
  const selectedAt = points.findIndex((p) => p.s.instanceId === selectedId)
  const stop = Math.min(
    Math.max(active ?? (selectedAt === -1 ? 0 : selectedAt), 0),
    Math.max(points.length - 1, 0),
  )

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : e.key === 'Home'
            ? -stop
            : e.key === 'End'
              ? points.length - 1 - stop
              : undefined
    if (step !== undefined) {
      e.preventDefault()
      const next = Math.min(Math.max(stop + step, 0), points.length - 1)
      setActive(next)
      dots.current[next]?.focus()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const at = points[stop]
      if (!at) return
      e.preventDefault()
      onSelect(at.s.instanceId)
    }
  }

  return (
    <svg
      viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
      width="100%"
      // A group, not an image: its dots are controls, and an image's children
      // are hidden from a screen reader.
      role="group"
      aria-label={`Plan of ${structures.length} structures around the base. Arrow keys move between them, Enter selects.`}
      className="block aspect-square w-full"
      onKeyDown={onKeyDown}
    >
      <circle
        r={radius * scale}
        fill="color-mix(in oklch, var(--color-signal) 5%, transparent)"
        stroke="color-mix(in oklch, var(--color-signal) 35%, transparent)"
        strokeWidth={1}
      />
      {/* North is up, matching the world map. */}
      <line
        x1={0}
        y1={-SIZE / 2}
        x2={0}
        y2={SIZE / 2}
        stroke="var(--color-line)"
        strokeWidth={0.5}
        opacity={0.5}
      />
      <line
        x1={-SIZE / 2}
        y1={0}
        x2={SIZE / 2}
        y2={0}
        stroke="var(--color-line)"
        strokeWidth={0.5}
        opacity={0.5}
      />

      {points.map(({ s, dx, dy }, i) => {
        const isSelected = s.instanceId === selectedId
        const isChest = chestIds.has(s.instanceId)
        const name = nameOf(s)
        const tint = tintOf?.(s)
        return (
          <circle
            key={s.instanceId}
            ref={(el) => {
              dots.current[i] = el
            }}
            cx={dx * scale}
            cy={dy * scale}
            r={isSelected ? 4 : isChest ? 2.4 : 1.6}
            fill={
              isSelected
                ? 'var(--color-signal)'
                : tintOf
                  ? (tint ?? 'var(--color-muted)')
                  : isChest
                    ? 'var(--color-gold)'
                    : 'var(--color-muted)'
            }
            opacity={isSelected || isChest ? 1 : tint ? 0.8 : 0.55}
            role="button"
            aria-label={name}
            aria-pressed={isSelected}
            tabIndex={i === stop ? 0 : -1}
            // The ring is a stroke, not an outline: an outline on an SVG shape
            // draws its bounding box, a square around a 3px dot.
            className="cursor-pointer outline-none focus-visible:[stroke:var(--color-text)] focus-visible:[stroke-width:1.5px] focus-visible:opacity-100 focus-visible:[paint-order:stroke]"
            onClick={() => {
              setActive(i)
              onSelect(s.instanceId)
            }}
          >
            <title>{name}</title>
          </circle>
        )
      })}

      {/* The palbox sits at the base origin by definition. */}
      <circle
        r={2.5}
        fill="none"
        stroke="var(--color-signal)"
        strokeWidth={1.2}
      />
    </svg>
  )
}
