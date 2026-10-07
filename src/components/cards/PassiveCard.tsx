import type { Refdata } from '../../refdata/refdata.ts'
import { passiveTier, type PassiveTier } from '../../lib/color.ts'
import { passiveText } from '../../views/breed/passiveText.ts'
import { effectText } from '../../views/builds/buildsText.ts'
import { CardFrame, CardNote, CardSection, CardText } from './CardFrame.tsx'

/** The same four tones `PassiveChip` uses, so a card matches its chip. */
const TIER_ACCENT: Record<PassiveTier, string> = {
  detrimental: 'var(--color-danger)',
  common: 'var(--color-line-strong)',
  good: 'var(--color-signal)',
  legendary: 'var(--color-gold)',
}

const TIER_LABEL: Record<PassiveTier, string> = {
  detrimental: 'Detrimental',
  common: 'Passive skill',
  good: 'Passive skill',
  legendary: 'Legendary passive',
}

/**
 * A passive: what it does, in the game's words and then in its numbers, and
 * where one comes from. With no reference data it is only the raw id, which
 * is still more than a truncated chip shows.
 */
export function PassiveCard({
  id,
  note,
  data,
}: {
  id: string
  note?: string
  data: Refdata | undefined
}) {
  const key = id.toLowerCase()
  const info = data?.passives[key]
  const text = passiveText(data)
  const tier = passiveTier(info?.rank)
  const effects = info?.effects ?? []
  const origin = text.origin(key)

  return (
    <CardFrame
      title={info?.name ?? id}
      sub={info ? `${TIER_LABEL[tier]} · rank ${info.rank}` : 'Passive skill'}
      accent={TIER_ACCENT[tier]}
    >
      {note && <CardNote>{note}</CardNote>}
      {info?.description && <CardText>{info.description}</CardText>}
      {effects.length > 0 && (
        <CardSection label="Effect">
          <ul className="num flex flex-col gap-0.5 text-xs">
            {effects.map((e, i) => (
              <li key={i}>{effectText(e)}</li>
            ))}
          </ul>
        </CardSection>
      )}
      {origin && (
        <CardSection label="Where from">
          <p className="text-xs leading-normal text-[var(--color-muted)]">
            {origin}
          </p>
        </CardSection>
      )}
    </CardFrame>
  )
}
