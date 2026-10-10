import { speciesOf } from '../../domain/names.ts'
import type { EggContents, Guid, SaveIndex } from '../../domain/types.ts'
import type { Refdata } from '../../refdata/refdata.ts'
import { count as formatCount } from '../../lib/format.ts'
import { rarityOf } from '../../lib/rarity.ts'
import { GameIcon } from '../GameIcon.tsx'
import { Field, IVBar, KeyHint, Meter, PassiveChip } from '../primitives.tsx'
import { CardFrame, CardNote, CardSection, CardText } from './CardFrame.tsx'
import { REVEAL_KEY, useEggReveal } from './eggReveal.ts'

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

      {dynamic?.egg && dynamicId && (
        <EggInside egg={dynamic.egg} dynamicId={dynamicId} data={data} />
      )}

      {info?.description && (
        <CardText>{info.description.replace(/\r/g, '')}</CardText>
      )}
    </CardFrame>
  )
}

/**
 * What an egg will hatch — hidden until asked for.
 *
 * The save knows, and for an egg laid at a farm it knows everything. That is a
 * spoiler, so the card says only that there is something to see and how to see
 * it; the key shows this egg's and no other's, and the same key hides it.
 *
 * A found egg has only its species decided. The rest is rolled when it
 * hatches, and saying so is better than showing a row of blanks.
 */
function EggInside({
  egg,
  dynamicId,
  data,
}: {
  egg: EggContents
  dynamicId: Guid
  data: Refdata | undefined
}) {
  const shown = useEggReveal((s) => s.revealed.has(dynamicId))
  const key = <KeyHint>{REVEAL_KEY.toUpperCase()}</KeyHint>

  if (!shown) {
    return (
      <CardSection label="Inside">
        <p className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          <span
            aria-hidden
            className="h-4 w-24 rounded-control bg-[var(--color-line-strong)]"
          />
          <span>Hidden. Press {key} to look.</span>
        </p>
      </CardSection>
    )
  }

  const info = speciesOf(data, egg)
  const name = info?.name ?? egg.characterId
  return (
    <CardSection label="Inside" hint="what the egg records">
      <div className="flex items-center gap-2">
        <GameIcon eager path={info?.icon} name={name} size={32} />
        <div className="min-w-0">
          <div className="truncate text-sm">
            {name}
            {egg.isBoss && (
              <span className="ml-1.5 text-[var(--color-muted)]">alpha</span>
            )}
          </div>
          <div className="text-xs text-[var(--color-muted)]">
            {egg.gender ?? (egg.rolled ? 'sex not recorded' : 'species only')}
            {egg.rolled && (
              // The bars beside this show the shape; a card cannot be hovered
              // for the numbers, so they are written out.
              <span className="num">
                {' · '}IVs {egg.ivHp ?? 0} / {egg.ivAttack ?? 0} /{' '}
                {egg.ivDefense ?? 0}
              </span>
            )}
          </div>
        </div>
        {egg.rolled && (
          <div className="ml-auto">
            <IVBar
              hp={egg.ivHp}
              attack={egg.ivAttack}
              defense={egg.ivDefense}
            />
          </div>
        )}
      </div>
      {egg.passives.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {egg.passives.map((asset) => {
            const p = data?.passives[asset.toLowerCase()]
            return (
              <PassiveChip key={asset} name={p?.name ?? asset} rank={p?.rank} />
            )
          })}
        </div>
      )}
      <p className="mt-2 text-[11px] text-[var(--color-faint)]">
        {egg.rolled
          ? egg.passives.length === 0
            ? 'No passives. '
            : ''
          : 'A found egg: its sex, IVs and passives are rolled when it hatches. '}
        {key} hides it again.
      </p>
    </CardSection>
  )
}
