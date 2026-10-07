import type { SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { WORK_TYPES } from '../../lib/color.ts'
import { count } from '../../lib/format.ts'
import { GameIcon } from '../GameIcon.tsx'
import { CardFrame, CardSection } from './CardFrame.tsx'

/**
 * A work suitability: how many of this world's pals can do it and how well,
 * and which species do it best.
 *
 * Levels are the species' base plus each pal's own bonus, the same sum the
 * guild's coverage chart uses. Without reference data there are no base
 * levels, so only the bonuses would count — a misleading near-zero — and the
 * card says nothing about the roster rather than that.
 */
export function WorkCard({
  id,
  data,
  index,
}: {
  id: string
  data: Refdata | undefined
  index: SaveIndex
}) {
  const ref = data?.work.find((w) => w.id === id)
  const display =
    ref?.display ?? WORK_TYPES.find((w) => w.id === id)?.display ?? id

  // Pals at each level, highest first.
  const byLevel = new Map<number, number>()
  if (data) {
    for (const pal of index.pals) {
      const base = data.species[pal.characterId.toLowerCase()]?.work?.[id] ?? 0
      const level = base + (pal.workSuitabilityBonus[id] ?? 0)
      if (level > 0) byLevel.set(level, (byLevel.get(level) ?? 0) + 1)
    }
  }
  const levels = [...byLevel].sort((a, b) => b[0] - a[0])
  const total = levels.reduce((n, [, c]) => n + c, 0)

  const best = data
    ? Object.values(data.species)
        .filter((s) => (s.work?.[id] ?? 0) > 0 && s.zukan !== undefined)
        .sort(
          (a, b) =>
            (b.work?.[id] ?? 0) - (a.work?.[id] ?? 0) ||
            (a.zukan ?? 0) - (b.zukan ?? 0),
        )
        .slice(0, 3)
    : []

  return (
    <CardFrame
      icon={
        ref?.icon ? (
          <GameIcon eager path={ref.icon} name={display} size={40} />
        ) : undefined
      }
      title={display}
      sub="Work suitability"
    >
      {data && (
        <CardSection label="This world's pals">
          {total === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">
              None of them can do this.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {levels.map(([level, n]) => (
                <span key={level}>
                  <span className="num text-[var(--color-signal)]">
                    Lv {level}
                  </span>{' '}
                  <span className="num text-[var(--color-muted)]">
                    ×{count(n)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </CardSection>
      )}
      {best.length > 0 && (
        <CardSection label="Best at it">
          <ul className="flex flex-col gap-1 text-xs">
            {best.map((s) => (
              <li key={s.name} className="flex items-center gap-2">
                <GameIcon
                  eager
                  path={s.icon}
                  name={s.name}
                  elementName={s.element1}
                  size={22}
                />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="num text-[var(--color-signal)]">
                  Lv {s.work?.[id]}
                </span>
              </li>
            ))}
          </ul>
        </CardSection>
      )}
    </CardFrame>
  )
}
