import type { Pal, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { ivTotal } from '../../domain/index.ts'
import { palName } from '../../domain/palText.ts'
import { GameIcon } from '../GameIcon.tsx'
import { PassiveChip, Pill } from '../primitives.tsx'
import { effectText } from '../../views/builds/buildsText.ts'
import { CardFrame, CardSection } from './CardFrame.tsx'
import { ElementTags, PartnerSkill, WorkLevels } from './cardParts.tsx'

/**
 * One pal: what it is, how well it rolled, and what it carries.
 *
 * Ordered the way `palTooltip` orders its text, which is the order someone
 * scanning a collection asks the questions in. With `data` absent — degraded
 * mode, or the summary's deliberately raw lists — it still has the level, the
 * rolls and the raw passive ids, which is everything the save itself says.
 */
export function PalCard({
  pal,
  data,
  index,
}: {
  pal: Pal
  data: Refdata | undefined
  index: SaveIndex
}) {
  const info = data?.species[pal.characterId.toLowerCase()]
  const name = palName(pal, info)
  const species = info?.name ?? pal.characterId
  const owner = pal.ownerPlayerUid
    ? index.playerByUid.get(pal.ownerPlayerUid)?.name
    : undefined

  return (
    <CardFrame
      icon={
        <GameIcon
          eager
          path={info?.icon}
          name={pal.characterId}
          elementName={info?.element1}
          size={48}
        />
      }
      title={name}
      sub={[species !== name && species, owner].filter(Boolean).join(' · ')}
      aside={
        <span className="num text-[var(--color-stamina)]">Lv.{pal.level}</span>
      }
      accent={
        pal.isBoss
          ? 'var(--color-danger)'
          : pal.isRare
            ? 'var(--color-gold)'
            : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ElementTags info={info} data={data} />
        <span className="ml-auto flex gap-1">
          {pal.gender && (
            <Pill>{pal.gender === 'Male' ? '♂ male' : '♀ female'}</Pill>
          )}
          {pal.isBoss && <Pill tone="danger">alpha</Pill>}
          {pal.isRare && <Pill tone="warn">rare</Pill>}
          {pal.rank > 0 && <Pill>★{pal.rank}</Pill>}
        </span>
      </div>

      <CardSection label="Individual values" hint={`${ivTotal(pal)} / 300`}>
        <div className="flex flex-col gap-1">
          <IvRow label="HP" value={pal.ivHp} />
          <IvRow label="Attack" value={pal.ivAttack} />
          <IvRow label="Defense" value={pal.ivDefense} />
        </div>
      </CardSection>

      {pal.passives.length > 0 && (
        <CardSection label="Passive skills">
          <ul className="flex flex-col gap-1">
            {pal.passives.map((asset) => {
              const p = data?.passives[asset.toLowerCase()]
              const effects = p?.effects?.map(effectText).join(', ')
              return (
                // Wraps rather than truncates: the chip is the name, and a
                // squeezed "WORK SLA…" answers nothing.
                <li
                  key={asset}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                >
                  <PassiveChip name={p?.name ?? asset} rank={p?.rank} />
                  {effects && (
                    <span className="num text-[11px] text-[var(--color-muted)]">
                      {effects}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </CardSection>
      )}

      <PartnerSkill info={info} />
      <WorkLevels info={info} data={data} bonus={pal.workSuitabilityBonus} />

      {pal.sickness && (
        <p className="text-xs text-[var(--color-danger)]">
          Sick: {pal.sickness}
        </p>
      )}
    </CardFrame>
  )
}

/** A rolled stat, 0–100: the bar for scanning, the number for comparing. */
function IvRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="label w-14 shrink-0">{label}</span>
      <span className="relative h-1 flex-1 overflow-hidden bg-[var(--color-line)]">
        <span
          className="absolute inset-y-0 left-0 bg-[var(--color-signal)]"
          style={{ width: `${value ?? 0}%` }}
        />
      </span>
      <span className="num w-7 text-right">{value ?? 0}</span>
    </div>
  )
}
