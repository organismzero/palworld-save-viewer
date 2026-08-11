/**
 * Re-derives every breeding result and checks it against upstream's own tables.
 *
 * `src/domain/breeding.ts` claims that two small sections of `breedingdata.json`
 * reproduce the four large precomputed ones exactly. This is that claim, made
 * runnable — the alternative is a comment nobody can check.
 *
 * Not in CI: it needs the network, and no game data is vendored in this
 * repository. Run it by hand after a reference-data refresh.
 *
 *     pnpm verify:breeding                    # fetch from the CDN
 *     pnpm verify:breeding path/to/breedingdata.json
 */

import { readFile } from 'node:fs/promises'

import {
  buildBreedingTable,
  childOf,
  pairKey,
  type BreedingTable,
} from '../src/domain/breeding.ts'
import type { BreedingData } from '../src/refdata/refdata.ts'

const URL_ =
  'https://cdn.jsdelivr.net/gh/deafdudecomputers/PalworldSaveTools@main/resources/game_data/breedingdata.json'

async function load(): Promise<any> {
  const path = process.argv[2]
  if (path) return JSON.parse(await readFile(path, 'utf8'))
  const res = await fetch(URL_)
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  return res.json()
}

/** The same projection `refdata.ts` applies, kept in step by hand. */
function slim(raw: any): BreedingData {
  const pals: BreedingData['pals'] = {}
  for (const [id, v] of Object.entries<any>(raw?.pal_info ?? {})) {
    if (typeof v?.combi_rank !== 'number') continue
    pals[id.toLowerCase()] = {
      combiRank: v.combi_rank,
      ignoreCombi: v.ignore_combi === true,
    }
  }
  const uniqueCombos = (raw?.unique_combos ?? []).map((c: any) => ({
    a: String(c.parent_a).toLowerCase(),
    b: String(c.parent_b).toLowerCase(),
    child: String(c.child).toLowerCase(),
  }))
  return { pals, uniqueCombos }
}

function main(raw: any, table: BreedingTable) {
  // Upstream lists 212 pairs under two children — both the unique-combo result
  // and the formula result. Ours is single-valued, so the check is that our
  // answer is always *among* what upstream lists for that pair.
  const listed = new Map<string, Set<string>>()
  for (const section of [
    'child_to_parents_formula',
    'child_to_parents_unique',
    'child_to_parents_ignore',
  ]) {
    for (const [child, ps] of Object.entries<any>(raw?.[section] ?? {})) {
      for (const p of ps as any[]) {
        const key = pairKey(
          String(p.parent_a).toLowerCase(),
          String(p.parent_b).toLowerCase(),
        )
        const at = listed.get(key)
        if (at) at.add(child.toLowerCase())
        else listed.set(key, new Set([child.toLowerCase()]))
      }
    }
  }

  let checked = 0
  let outside = 0
  const examples: string[] = []
  for (const [key, children] of listed) {
    const [a, b] = key.split('|') as [string, string]
    const got = childOf(table, a, b)
    checked++
    if (!got || !children.has(got)) {
      outside++
      if (examples.length < 10) {
        examples.push(
          `  ${a} + ${b} → ${got}, upstream: ${[...children].join(', ')}`,
        )
      }
    }
  }

  // The other direction: upstream's parent→children table, checked directly.
  let pcChecked = 0
  let pcWrong = 0
  for (const [parent, list] of Object.entries<any>(
    raw?.parent_to_children_formula ?? {},
  )) {
    for (const e of list as any[]) {
      pcChecked++
      const got = childOf(
        table,
        parent.toLowerCase(),
        String(e.partner).toLowerCase(),
      )
      const want = String(e.child).toLowerCase()
      // A unique combo legitimately overrides this table's formula entry.
      if (got !== want && !table.unique.has(pairKey(parent.toLowerCase(), String(e.partner).toLowerCase()))) pcWrong++ // prettier-ignore
    }
  }

  const ranks = table.candidates.map((id) => table.rank.get(id)!)
  const distinct = new Set(ranks).size === ranks.length

  console.log(`species:              ${table.rank.size}`)
  console.log(`formula candidates:   ${table.candidates.length}`)
  console.log(`candidate ranks distinct: ${distinct ? 'yes' : 'NO — tie-break needs the id key'}`) // prettier-ignore
  console.log(`unique combos:        ${table.unique.size}`)
  console.log(`cross-species impossible: ${table.crossSpeciesImpossible.size}`)
  console.log(`byTarget span:        0…${table.byTarget.length - 1}`)
  console.log()
  console.log(`pairs checked:        ${checked}`)
  console.log(`answers outside upstream's list: ${outside}`)
  if (examples.length) console.log(examples.join('\n'))
  console.log()
  console.log(
    `parent→children checked: ${pcChecked}, disagreements: ${pcWrong}`,
  )

  if (outside > 0 || pcWrong > 0 || !distinct) {
    console.error('\nFAIL — the formula and upstream disagree.')
    process.exit(1)
  }
  console.log('\nOK — every pair agrees.')
}

const raw = await load()
main(raw, buildBreedingTable(slim(raw)))
