/**
 * How long a passive-aware breeding search actually takes.
 *
 * `domain/passiveBreeding.ts` runs in a worker because it is too slow for the
 * main thread, and the module comment quotes numbers for how slow. This is
 * where those numbers come from — the alternative is a table nobody can check.
 *
 * Not in CI: it needs the network for `breedingdata.json` and a real save for
 * a real stock, and no game data is vendored in this repository. Run it after
 * touching the search, and paste the numbers into the module's doc comment.
 *
 *     pnpm bench:passives                     # fetch from the CDN
 *     pnpm bench:passives path/to/breedingdata.json
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { buildIndexes } from '../src/parse/worker/buildIndexes.ts'
import { buildSaveIndex } from '../src/domain/index.ts'
import {
  buildBreedingTable,
  buildStock,
  reachFrom,
  type Stock,
} from '../src/domain/breeding.ts'
import {
  planWithPassives,
  reachWithPassives,
} from '../src/domain/passiveBreeding.ts'
import { carrierCounts } from '../src/domain/passives.ts'
import type { BreedingData } from '../src/refdata/refdata.ts'
import type { Pal, SaveIndex } from '../src/domain/types.ts'

const LEVEL_JSON = resolve(process.cwd(), 'data/Level.json')

const SOURCES = [
  'https://cdn.jsdelivr.net/gh/deafdudecomputers/PalworldSaveTools@main/resources/game_data/breedingdata.json',
  'https://raw.githubusercontent.com/deafdudecomputers/PalworldSaveTools/main/resources/game_data/breedingdata.json',
]

async function loadBreeding(): Promise<any> {
  const path = process.argv[2]
  if (path) return JSON.parse(await readFile(path, 'utf8'))
  let last: unknown
  for (const url of SOURCES) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
      last = new Error(`${res.status} from ${url}`)
    } catch (err) {
      last = err
    }
  }
  throw last ?? new Error('no source reachable')
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

function pooled(stock: Stock): Pal[] {
  const out: Pal[] = []
  for (const entry of stock.bySpecies.values()) {
    out.push(...entry.male, ...entry.female, ...entry.unknown)
  }
  return out
}

/** The player with the most pals — the one the view opens on. */
function busiest(index: SaveIndex): string | undefined {
  let best: string | undefined
  let most = -1
  for (const p of index.players) {
    const n = index.palsByOwner.get(p.playerUid)?.length ?? 0
    if (n > most) {
      most = n
      best = p.playerUid
    }
  }
  return best
}

function ms(run: () => void): number {
  const t0 = performance.now()
  run()
  return performance.now() - t0
}

async function main() {
  if (!existsSync(LEVEL_JSON)) {
    console.error('needs data/Level.json — see README')
    process.exit(1)
  }

  const index = buildSaveIndex(
    buildIndexes(JSON.parse(readFileSync(LEVEL_JSON, 'utf8')), {
      source: 'json',
    }),
  )
  const table = buildBreedingTable(slim(await loadBreeding()))

  for (const includeGuild of [false, true]) {
    const stock = buildStock(index, table, busiest(index), { includeGuild })
    const reach = reachFrom(stock, table)
    const baseline = ms(() => void reachFrom(stock, table))

    // The passives most of the roster carries, so the search has real carriers
    // to route through rather than a contrived best case.
    const common = [...carrierCounts(pooled(stock))]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)

    // A deep target, so planning has a real tree to walk.
    const target = [...reach.depth.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0]

    console.log(
      `\n${includeGuild ? 'guild pooled' : 'one player'} — ${stock.counted} pals, ` +
        `${stock.bySpecies.size} species, ${reach.depth.size} reachable ` +
        `(reachFrom ${baseline.toFixed(0)} ms)`,
    )
    console.log(`  target ${target}`)

    for (let k = 1; k <= 4; k++) {
      const wanted = common.slice(0, k).map(([id]) => id)
      let search!: ReturnType<typeof reachWithPassives>
      const searchMs = ms(() => {
        search = reachWithPassives(stock, table, reach, wanted)
      })
      let plan!: ReturnType<typeof planWithPassives>
      const planMs = ms(() => {
        plan = planWithPassives(table, reach, search, stock, target ?? '')
      })
      console.log(
        `  ${k} wanted: ${searchMs.toFixed(0)} ms search, ${planMs.toFixed(1)} ms plan, ` +
          `${search.statesExplored} explored, ${search.states.size} settled` +
          (search.truncated ? ', TRUNCATED' : '') +
          ` → ${plan.status}${plan.expectedEggs ? ` ~${plan.expectedEggs.toFixed(0)} eggs` : ''}`,
      )
    }
  }
}

await main()
