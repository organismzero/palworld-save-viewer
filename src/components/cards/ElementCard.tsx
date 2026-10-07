import type { SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { BEATS, STRONG, WEAK } from '../../domain/typeChart.ts'
import { element } from '../../lib/color.ts'
import { count } from '../../lib/format.ts'
import { GameIcon } from '../GameIcon.tsx'
import { ElementBadge } from '../primitives.tsx'
import { CardFrame, CardSection } from './CardFrame.tsx'
import { ElementTag } from './cardParts.tsx'

/**
 * An element: what it beats, what beats it, and how many of this world's pals
 * carry it.
 *
 * The matchups are the one hand-typed table in the app (`domain/typeChart.ts`),
 * and the chart says only who beats whom — the ×2 and ×0.5 are this app's
 * assumption, which the card says, as the Builds view does.
 */
export function ElementCard({
  name,
  data,
  index,
}: {
  name: string
  data: Refdata | undefined
  index: SaveIndex
}) {
  const el = element(name)
  if (!el) {
    return <CardFrame title={name} sub="Element" />
  }
  const beats = BEATS[el.name] ?? []
  const beatenBy = Object.entries(BEATS)
    .filter(([, targets]) => targets.includes(el.name))
    .map(([attacker]) => attacker)

  // Which species carry it is reference data; without it, no honest count.
  let pals: number | undefined
  if (data) {
    pals = 0
    for (const pal of index.pals) {
      const info = data.species[pal.characterId.toLowerCase()]
      if (info?.element1 === el.name || info?.element2 === el.name) pals += 1
    }
  }
  const icon = data?.elements?.[el.name.toLowerCase()]?.icon

  return (
    <CardFrame
      icon={
        icon ? (
          <GameIcon eager path={icon} name={el.display} size={40} />
        ) : (
          <ElementBadge name={el.name} size={28} card={false} />
        )
      }
      title={<span style={{ color: el.oklch }}>{el.display}</span>}
      sub="Element"
    >
      <CardSection label={`Strong against · ×${STRONG}`}>
        {beats.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {beats.map((b) => (
              <ElementTag key={b} name={b} data={data} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-muted)]">Nothing.</p>
        )}
      </CardSection>
      <CardSection label={`Weak to · takes ×${STRONG}`}>
        {beatenBy.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {beatenBy.map((b) => (
              <ElementTag key={b} name={b} data={data} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-muted)]">Nothing.</p>
        )}
      </CardSection>
      {pals !== undefined && (
        <p className="text-xs">
          <span className="num">{count(pals)}</span>{' '}
          <span className="text-[var(--color-muted)]">
            of this world&apos;s pals are {el.display}.
          </span>
        </p>
      )}
      <p className="text-[11px] text-[var(--color-faint)]">
        The chart says who beats whom; ×{STRONG} and ×{WEAK} are this app&apos;s
        assumption.
      </p>
    </CardFrame>
  )
}
