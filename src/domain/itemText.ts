/**
 * The plain-text account of an item, for screen readers and anywhere a card
 * cannot go.
 *
 * This was the inventory cell's native `title` until hover cards replaced it,
 * and it lives on as the item card's plain-text twin, the way `palTooltip` does
 * for pals. Pure, and takes everything as arguments: it must stay useful in
 * degraded mode, where the name is a raw asset id and nothing else is known.
 */

import type { DynamicItem } from './types.ts'
import type { ItemInfo } from '../refdata/refdata.ts'
import { count as formatCount } from '../lib/format.ts'

export interface ItemTextInput {
  name: string
  info?: ItemInfo
  dynamic?: DynamicItem
  /** How many are in this stack, or in total across a merged row. */
  count?: number
  /** `dynamic.passives` resolved to names; the raw ids are the fallback. */
  passiveNames?: string[]
  /** For a merged row: how many containers hold it. */
  places?: number
}

export function itemText({
  name,
  info,
  dynamic,
  count,
  passiveNames,
  places,
}: ItemTextInput): string {
  const lines = [count !== undefined ? `${name} ×${formatCount(count)}` : name]
  if (places !== undefined && places > 1) lines.push(`in ${places} places`)
  const type = [info?.typeA, info?.typeB].filter(Boolean).join(' · ')
  if (type) lines.push(type)
  if (info?.weight) lines.push(`${info.weight} wt each`)
  if (dynamic?.durability !== undefined) {
    lines.push(
      info?.durability
        ? `durability ${Math.round(dynamic.durability)} / ${info.durability}`
        : `durability ${Math.round(dynamic.durability)}`,
    )
  }
  if (dynamic?.ammo) lines.push(`${dynamic.ammo} rounds loaded`)
  for (const p of passiveNames ?? dynamic?.passives ?? []) lines.push(`+ ${p}`)
  if (info?.description) lines.push('', info.description.replace(/\r/g, ''))
  return lines.join('\n')
}
