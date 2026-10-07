import type { Guid, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { count as formatCount } from '../../lib/format.ts'
import { rarityOf } from '../../lib/rarity.ts'
import { GameIcon } from '../GameIcon.tsx'
import { Field, Meter, PassiveChip } from '../primitives.tsx'
import { CardFrame, CardNote, CardSection, CardText } from './CardFrame.tsx'

/**
 * An item, as the game's inventory tooltip lays one out: art and name ruled in
 * its rarity colour, what kind of thing it is, what it weighs, then the
 * per-instance detail a weapon or armour piece carries — wear, rounds loaded,
 * passives — and the flavour text last.
 *
 * With no reference data it is the raw id, the count and whatever the save
 * itself records about the instance, which is still the whole of what the save
 * says.
 */
export function ItemCard({
  staticId,
  count,
  dynamicId,
  places,
  data,
  index,
}: {
  staticId: string
  count?: number
  dynamicId?: Guid
  places?: number
  data: Refdata | undefined
  index: SaveIndex
}) {
  const info = data?.items[staticId.toLowerCase()]
  const dynamic = dynamicId ? index.dynamicItemById.get(dynamicId) : undefined
  const rarity = rarityOf(info?.rarity)
  const type = [info?.typeA, info?.typeB].filter(Boolean).join(' · ')

  return (
    <CardFrame
      icon={
        <GameIcon
          eager
          path={info?.icon}
          name={info?.name ?? staticId}
          size={48}
        />
      }
      title={info?.name ?? staticId}
      sub={[type, info && info.rarity > 0 && rarity.name]
        .filter(Boolean)
        .join(' · ')}
      aside={
        count !== undefined && count > 1 ? (
          <span className="num text-sm">×{formatCount(count)}</span>
        ) : undefined
      }
      accent={rarity.color}
    >
      {places !== undefined && places > 1 && (
        <CardNote>Held in {formatCount(places)} places.</CardNote>
      )}

      {info && (
        <div className="grid grid-cols-2 gap-x-4 text-xs">
          {info.weight > 0 && <Field label="Weight" value={info.weight} />}
          {info.maxStack > 1 && <Field label="Stack" value={info.maxStack} />}
          {info.weight > 0 && count !== undefined && count > 1 && (
            <Field
              label="Total wt"
              value={formatCount(Math.round(info.weight * count * 10) / 10)}
            />
          )}
          {info.magazine && <Field label="Magazine" value={info.magazine} />}
        </div>
      )}

      {dynamic?.durability !== undefined &&
        (info?.durability ? (
          <Meter
            label="Durability"
            value={Math.round(dynamic.durability)}
            max={info.durability}
            tone={dynamic.durability / info.durability > 0.2 ? 'hp' : 'danger'}
            height={14}
          />
        ) : (
          // No denominator without reference data, so no bar — a number that
          // does not pretend to be a fraction.
          <Field label="Durability" value={Math.round(dynamic.durability)} />
        ))}

      {dynamic?.ammo !== undefined && dynamic.ammo > 0 && (
        <Field
          label="Loaded"
          value={
            info?.magazine
              ? `${dynamic.ammo} / ${info.magazine}`
              : `${dynamic.ammo} rounds`
          }
        />
      )}

      {dynamic && dynamic.passives.length > 0 && (
        <CardSection label="Passives">
          <div className="flex flex-wrap gap-1">
            {dynamic.passives.map((asset) => {
              const p = data?.passives[asset.toLowerCase()]
              return (
                <PassiveChip
                  key={asset}
                  name={p?.name ?? asset}
                  rank={p?.rank}
                />
              )
            })}
          </div>
        </CardSection>
      )}

      {info?.description && (
        <CardText>{info.description.replace(/\r/g, '')}</CardText>
      )}
    </CardFrame>
  )
}
