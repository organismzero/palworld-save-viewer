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

import { posToMap } from '../../domain/coords.ts'
import type { Base, Guid, Structure } from '../../domain/types.ts'

/** World units per map unit — the overworld scale constant. */
const WORLD_PER_MAP = 725

const SIZE = 260

export function BasePlan({
  base,
  structures,
  selectedId,
  onSelect,
  chestIds,
}: {
  base: Base
  structures: Structure[]
  selectedId?: Guid
  onSelect: (id: Guid) => void
  /** Structures that hold a container, drawn in the storage accent. */
  chestIds: Set<Guid>
}) {
  const origin = posToMap(base.pos)
  if (!origin) return null

  const radius = base.areaRange / WORLD_PER_MAP

  const points = structures.flatMap((s) => {
    const at = posToMap(s.pos)
    // A structure in the World Tree's coordinate space cannot be plotted
    // against an overworld base; skipping beats drawing it in the wrong place.
    if (!at || at.map !== origin.map) return []
    return [{ s, dx: at.mx - origin.mx, dy: -(at.my - origin.my) }]
  })

  // Fit whatever is actually there — buildings routinely sit outside the
  // camp's nominal radius, and cropping them would be a lie about the base.
  const extent = Math.max(
    radius * 1.05,
    ...points.map((p) => Math.max(Math.abs(p.dx), Math.abs(p.dy)) * 1.05),
  )
  const scale = SIZE / 2 / extent

  return (
    <svg
      viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
      width="100%"
      role="img"
      aria-label={`Plan of ${structures.length} structures around the base`}
      className="block aspect-square w-full"
    >
      <circle
        r={radius * scale}
        fill="oklch(0.82 0.12 205 / 0.05)"
        stroke="oklch(0.82 0.12 205 / 0.35)"
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

      {points.map(({ s, dx, dy }) => {
        const isSelected = s.instanceId === selectedId
        const isChest = chestIds.has(s.instanceId)
        return (
          <circle
            key={s.instanceId}
            cx={dx * scale}
            cy={dy * scale}
            r={isSelected ? 4 : isChest ? 2.4 : 1.6}
            fill={
              isSelected
                ? 'var(--color-signal)'
                : isChest
                  ? 'oklch(0.80 0.15 85)'
                  : 'var(--color-muted)'
            }
            opacity={isSelected || isChest ? 1 : 0.55}
            className="cursor-pointer"
            onClick={() => onSelect(s.instanceId)}
          >
            <title>{s.mapObjectId}</title>
          </circle>
        )
      })}

      {/* The palbox sits at the base origin by definition. */}
      <circle
        r={2.5}
        fill="none"
        stroke="oklch(0.82 0.12 205)"
        strokeWidth={1.2}
      />
    </svg>
  )
}
