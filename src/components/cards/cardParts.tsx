/**
 * Pieces the pal and species cards share.
 */

import type { MountKind, Refdata, SpeciesInfo } from '../../refdata/refdata.ts'
import { element, WORK_TYPES } from '../../lib/color.ts'
import { GameIcon } from '../GameIcon.tsx'
import { ElementBadge } from '../primitives.tsx'
import { CardSection, CardText } from './CardFrame.tsx'

/**
 * An element by name, with the game's own icon when it has loaded.
 *
 * The icon is paired with the name rather than standing in for it: Dragon and
 * Earth are close in hue, and colour must never be the only channel.
 */
export function ElementTag({
  name,
  data,
}: {
  name: string | undefined
  data: Refdata | undefined
}) {
  const el = element(name)
  if (!el) return null
  const icon = data?.elements?.[el.name.toLowerCase()]?.icon
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {icon ? (
        <GameIcon
          eager
          path={icon}
          name={el.display}
          elementName={el.name}
          size={16}
        />
      ) : (
        <ElementBadge name={el.name} size={10} card={false} />
      )}
      <span style={{ color: el.oklch }}>{el.display}</span>
    </span>
  )
}

export function ElementTags({
  info,
  data,
}: {
  info: SpeciesInfo | undefined
  data: Refdata | undefined
}) {
  if (!element(info?.element1) && !element(info?.element2)) return null
  return (
    <div className="flex flex-wrap gap-3">
      <ElementTag name={info?.element1} data={data} />
      <ElementTag name={info?.element2} data={data} />
    </div>
  )
}

const MOUNT: Record<MountKind, string> = {
  flying: 'Flying mount',
  water: 'Water mount',
  ground: 'Ground mount',
  glider: 'Changes your glider',
}

/** Partner skill name and, where the data allows it, what it does. */
export function PartnerSkill({ info }: { info: SpeciesInfo | undefined }) {
  if (!info?.partnerSkill) return null
  return (
    <CardSection
      label="Partner skill"
      hint={info.partnerSkillText ? 'values at Lv 1' : undefined}
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span className="font-semibold text-[var(--color-signal)]">
          {info.partnerSkill}
        </span>
        {info.mount && (
          <span className="label ml-auto">{MOUNT[info.mount]}</span>
        )}
      </div>
      {info.partnerSkillText && <CardText>{info.partnerSkillText}</CardText>}
    </CardSection>
  )
}

/**
 * Work suitability as the game prints it: icon, then level.
 *
 * `bonus` is a pal's own additions on top of its species, from
 * `workSuitabilityBonus`; it is folded into the level and marked with a gold
 * plus so a boosted level is not mistaken for the species'.
 */
export function WorkLevels({
  info,
  data,
  bonus,
}: {
  info: SpeciesInfo | undefined
  data: Refdata | undefined
  bonus?: Record<string, number>
}) {
  const rows = WORK_TYPES.flatMap((w) => {
    const base = info?.work?.[w.id] ?? 0
    const extra = bonus?.[w.id] ?? 0
    if (base + extra <= 0) return []
    const ref = data?.work.find((t) => t.id === w.id)
    return [
      {
        ...w,
        display: ref?.display ?? w.display,
        icon: ref?.icon,
        base,
        extra,
      },
    ]
  })
  if (rows.length === 0) return null
  return (
    <CardSection label="Work suitability">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {rows.map((w) => (
          <li key={w.id} className="flex items-center gap-1.5">
            {w.icon && (
              <GameIcon eager path={w.icon} name={w.display} size={18} />
            )}
            <span className="min-w-0 truncate">{w.display}</span>
            <span className="num ml-auto text-[var(--color-signal)]">
              {w.base + w.extra}
              {w.extra > 0 && (
                <span className="text-[var(--color-gold)]">+</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </CardSection>
  )
}
