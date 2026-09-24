import type { Refdata } from '../../refdata/refdata.ts'
import { element } from '../../lib/color.ts'
import { Field, Pill } from '../primitives.tsx'
import { CardFrame, CardNote, CardText } from './CardFrame.tsx'
import { ElementTag } from './cardParts.tsx'

/**
 * An active skill: its element, how hard it hits, how often, and the game's
 * own description of it.
 *
 * `id` is the `EPalWazaID` tail as the save stores it, in any case — reference
 * data keys skills lowercased. With no reference data the card is the raw id,
 * which is still better than the drawer's old habit of printing only that.
 */
export function SkillCard({
  id,
  note,
  data,
}: {
  id: string
  note?: string
  data: Refdata | undefined
}) {
  const key = id.toLowerCase()
  const info = data?.skills[key]
  const el = element(info?.element)
  // `Unique_` skills belong to one species and cannot be taught to another.
  const unique = key.startsWith('unique_')

  return (
    <CardFrame
      title={info?.name ?? id}
      sub={['Active skill', el?.display].filter(Boolean).join(' · ')}
      aside={unique ? <Pill tone="warn">unique</Pill> : undefined}
    >
      {note && <CardNote>{note}</CardNote>}
      {info && (
        <>
          <div className="flex items-center gap-3">
            <ElementTag name={info.element} data={data} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 text-xs">
            <Field label="Power" value={info.power} />
            <Field label="Cooldown" value={`${info.cooldown}s`} />
          </div>
        </>
      )}
      {info?.description && <CardText>{info.description}</CardText>}
      {unique && (
        <p className="text-xs text-[var(--color-muted)]">
          Belongs to one species; no other pal can learn it.
        </p>
      )}
    </CardFrame>
  )
}
