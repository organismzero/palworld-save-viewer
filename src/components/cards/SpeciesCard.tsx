import type { Refdata } from '../../refdata/refdata.ts'
import { GameIcon } from '../GameIcon.tsx'
import { Field } from '../primitives.tsx'
import { CardFrame, CardNote, CardSection } from './CardFrame.tsx'
import { ElementTags, PartnerSkill, WorkLevels } from './cardParts.tsx'

/**
 * A species, for the places that name one without meaning any particular pal:
 * the Paldex, breeding targets and parents, the Builds pickers. What it is,
 * what it does for you, and what it is good for at a base.
 */
export function SpeciesCard({
  id,
  note,
  data,
}: {
  id: string
  note?: string
  data: Refdata | undefined
}) {
  const info = data?.species[id.toLowerCase()]
  const stats = info?.stats

  return (
    <CardFrame
      icon={
        <GameIcon
          eager
          path={info?.icon}
          name={id}
          elementName={info?.element1}
          size={48}
        />
      }
      title={info?.name ?? id}
      sub={info?.zukan ? `Paldex No. ${info.zukan}` : 'Species'}
    >
      {note && <CardNote>{note}</CardNote>}
      <ElementTags info={info} data={data} />
      <PartnerSkill info={info} />
      <WorkLevels info={info} data={data} />
      {stats && (
        <CardSection label="Base stats">
          <div className="grid grid-cols-2 gap-x-4 text-xs">
            <Field label="HP" value={stats.hp} />
            <Field label="Attack" value={stats.attack} />
            <Field label="Defense" value={stats.defense} />
            <Field label="Work speed" value={stats.craftSpeed} />
            <Field label="Food" value={stats.food} />
            {info?.rarity !== undefined && (
              <Field label="Rarity" value={info.rarity} />
            )}
          </div>
        </CardSection>
      )}
    </CardFrame>
  )
}
