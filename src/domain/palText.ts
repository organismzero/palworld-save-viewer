/**
 * Human-readable summaries of a pal.
 *
 * A pal turns up in five places — the collection grid, its own drawer, the
 * guild panel's best-pals list, the summary tables and the map — and until now
 * each one showed a different subset with no way to see the rest without
 * clicking through. These build the hover text, once, so every surface agrees.
 *
 * Modelled on `tooltipText` in `components/ItemSlot.tsx`, which is the existing
 * precedent: a `\n`-joined string handed to the native `title` attribute rather
 * than a styled hover card. Same reasoning as there — it is keyboard
 * reachable, never clipped by a scroll container, and free.
 *
 * Pure, and takes its lookups as arguments: the app has a designed degraded
 * state where reference data is unavailable and a pal's name is a raw asset id,
 * and these must stay useful in it.
 */

import type { Pal } from './types.ts'
import { element } from '../lib/color.ts'
import { ivTotal } from './index.ts'

/** Just the reference-data fields the text needs. */
export interface PalSpeciesText {
  name?: string
  element1?: string
  element2?: string
}

export interface PalPassiveText {
  name: string
  rank: number
}

/**
 * The one-line name: nickname if it has one, otherwise the species.
 *
 * Falls back to the raw `characterId`, which is what the degraded state shows
 * everywhere else.
 */
export function palName(pal: Pal, species?: PalSpeciesText): string {
  return pal.nickname ?? species?.name ?? pal.characterId
}

/**
 * Multi-line hover text for a pal.
 *
 * Ordered by what someone scanning a list actually wants: what it is, how good
 * it is, then the detail. Absent data is omitted rather than rendered as a
 * dash — a tooltip padded with "—" is harder to read than a short one.
 */
export function palTooltip(
  pal: Pal,
  species?: PalSpeciesText,
  passive?: (asset: string) => PalPassiveText | undefined,
): string {
  const name = palName(pal, species)
  const speciesName = species?.name ?? pal.characterId
  const lines: string[] = []

  // Only repeat the species when the nickname hides it.
  lines.push(name === speciesName ? name : `${name} · ${speciesName}`)

  const traits = [
    `level ${pal.level}`,
    ...(pal.isBoss ? ['alpha'] : []),
    ...(pal.isRare ? ['rare'] : []),
    ...(pal.gender ? [pal.gender.toLowerCase()] : []),
  ]
  lines.push(traits.join(' · '))

  const elements = [species?.element1, species?.element2]
    .map((e) => element(e)?.display)
    .filter(Boolean)
  if (elements.length) lines.push(elements.join(' / '))

  // IVs are the reason anyone sorts a collection, so they are always shown —
  // including the zeros, because "0/0/0" is itself the answer to "is this one
  // worth keeping".
  lines.push(
    `IV ${ivTotal(pal)}/300 — hp ${pal.ivHp ?? 0}, atk ${pal.ivAttack ?? 0}, def ${pal.ivDefense ?? 0}`,
  )

  if (pal.rank > 0) lines.push(`condensed ★${pal.rank}`)
  if (pal.sickness) lines.push(`sick: ${pal.sickness}`)

  if (pal.passives.length > 0) {
    lines.push('')
    for (const asset of pal.passives) {
      const info = passive?.(asset)
      // Rank is what makes a passive good or bad, and it is not obvious from
      // the name — mark the detrimental ones rather than listing them flat.
      const mark = info && info.rank < 0 ? '▾ ' : '+ '
      lines.push(`${mark}${info?.name ?? asset}`)
    }
  }

  return lines.join('\n')
}

/** What the `★N` pill on a pal card means. */
export const CONDENSER_RANK_HELP =
  'Condenser rank — this pal has been soul-boosted at a Pal Condenser. 0–4 stars, each costing more duplicates.'
