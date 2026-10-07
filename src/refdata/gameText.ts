/**
 * The game's inline text markup, rendered to plain prose — or refused.
 *
 * A species' `description` in `characters.json` is really its partner skill's
 * description, written for the game's own rich-text renderer. It carries three
 * kinds of markup and two families of placeholder:
 *
 * - `[ICON:ElemIcon_Ground]` — an inline element icon. Always sits straight
 *   before an `[ELEM:…]` naming the same element, so it is simply dropped.
 * - `[ELEM:Earth]` — an element, by internal name. Printed as its display name.
 * - `[EFFECT:Burn]` — a status effect. Only the nine that appear in the data
 *   are unwrapped; anything else refuses the whole text.
 * - `{Passive1_EffectValue1}` and `{ReferencePassive1_EffectValue1}` — a value
 *   from one of the passives the species lists, by position.
 * - Everything else in braces — `{ReferenceMsgId_RideSpeedUp}`,
 *   `{ActiveSkillMainValueByRank}` — names text or numbers the data does not
 *   carry.
 *
 * The values filled in are the partner skill's **level 1** values. A species'
 * `passives` list starts with the level-1 set in placeholder order, then
 * appends later levels' variants in no consistent layout — Anubis runs
 * `_1`…`_5`, `CatMage` interleaves a second skill — so reading a condensed pal's
 * own value out of it would be guesswork. Callers say "at Lv 1" instead.
 *
 * Same discipline as `resolveEffects` in `refdata.ts`: a description with a
 * hole in it is worse than none, so anything left unresolved drops the text
 * and the caller falls back to the partner skill's name. Across the upstream
 * data at the time of writing, 474 of 703 descriptions survive.
 */

import { element } from '../lib/color.ts'

/** A passive's `effect1`–`effect4`, looked up by asset id. */
export type EffectValues = (
  asset: string,
) => Record<string, unknown> | undefined

/** Every `[EFFECT:…]` tag in the data, as the sentence around it wants it. */
const EFFECTS: Record<string, string> = {
  Burn: 'Burn',
  Darkness: 'Darkness',
  Electrical: 'Electrical',
  Freeze: 'Freeze',
  IvyCling: 'Ivy Cling',
  Muddy: 'Muddy',
  Poison: 'Poison',
  Stun: 'Stun',
  Wetness: 'Wetness',
}

export function partnerSkillText(
  raw: unknown,
  passives: readonly string[] | undefined,
  referencePassives: readonly string[] | undefined,
  effects: EffectValues,
): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  let failed = false

  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\[ICON:[^\]]*\]/g, '')
    .replace(/\[ELEM:([^\]]*)\]/g, (_, name: string) => {
      const el = element(name)
      if (!el) failed = true
      return el?.display ?? ''
    })
    .replace(/\[EFFECT:([^\]]*)\]/g, (_, name: string) => {
      const label = EFFECTS[name]
      if (!label) failed = true
      return label ?? ''
    })
    .replace(
      /\{(Reference)?Passive([1-9])_EffectValue([1-4])\}/g,
      (_, ref: string | undefined, slot: string, n: string) => {
        const list = ref ? referencePassives : passives
        const asset = list?.[Number(slot) - 1]
        const value = asset ? effects(asset)?.[`effect${n}`] : undefined
        // A zero is a switch, not an amount; printing "by 0%" would be a lie.
        if (typeof value !== 'number' || value === 0) {
          failed = true
          return ''
        }
        return String(value)
      },
    )

  // Anything still bracketed is a token shape this has not been taught.
  if (failed || /[{}[\]]/.test(text)) return undefined
  return text.replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * What a species drops when it works a Ranch, read out of its description.
 *
 * The data has no ranch-drop field; the partner-skill text says it in a few
 * fixed phrasings — "Sometimes drops Milk when assigned to Ranch", "Sometimes
 * lays an Egg…", "…digs up Gold Coin…", "…makes High Quality Cloth…". So this
 * takes only the sentences that mention a Ranch and finds item names in them.
 *
 * Longest name first, and no match may overlap another: "Caramel Cotton Candy"
 * contains "Cotton Candy", and the Woolipop that drops the one does not drop
 * the other. Names match whole words only, so "Egg" is not found inside
 * "Eggplant".
 *
 * `items` maps each item's display name to its id; returns ids, in the order
 * the sentence names them.
 */
export function ranchDrops(
  raw: unknown,
  items: ReadonlyMap<string, string>,
  byLength: readonly string[],
): string[] {
  if (typeof raw !== 'string') return []
  const out: string[] = []
  for (const sentence of raw.replace(/\r\n?/g, ' ').split(/(?<=\.)\s+/)) {
    if (!/\bRanch\b/.test(sentence)) continue
    const taken: [number, number][] = []
    const found: [number, string][] = []
    for (const name of byLength) {
      if (!sentence.includes(name)) continue
      const re = new RegExp(`(?<![\\w-])${escapeRe(name)}(?![\\w-])`, 'g')
      for (const m of sentence.matchAll(re)) {
        const start = m.index
        const end = start + name.length
        if (taken.some(([a, b]) => start < b && end > a)) continue
        taken.push([start, end])
        found.push([start, items.get(name)!])
      }
    }
    for (const [, id] of found.sort((a, b) => a[0] - b[0])) {
      if (!out.includes(id)) out.push(id)
    }
  }
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
