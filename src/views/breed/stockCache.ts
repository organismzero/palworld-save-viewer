/**
 * The Breed view's expensive derivations, kept across its own unmounting.
 *
 * The view is unmounted on every tab switch and its params are replaced
 * wholesale when a saved path is opened, and each time React's memos went with
 * it: the breeding table, the stock, the reach, and — the one that hurts — a
 * passive search that runs for ten seconds at four passives. Flicking between
 * two saved paths paid for both searches on every flick.
 *
 * ## Why identity, and why that is still safe
 *
 * `usePassiveSearch` keys on the stock's *identity* for a reason it spells out:
 * assembling a save a file at a time grows a player's roster without changing
 * any setting, so a key made of settings would leave the old answer on screen
 * looking current. That guarantee is kept rather than traded away. Everything
 * here hangs off the `SaveIndex` object, and every load and every merge builds
 * a new one (`buildSaveIndex` in `saveStore`), so the same settings against a
 * grown roster miss the cache and are worked out again. What the cache adds is
 * only that the same settings against the *same* index return the *same*
 * `Stock` object — which is what lets the search's own cache recognise a
 * question it has already answered.
 *
 * Weak maps throughout, so loading another save lets the previous one's whole
 * tree go.
 */

import {
  buildBreedingTable,
  buildStock,
  reachFrom,
  type BreedingTable,
  type Reach,
  type Stock,
} from '../../domain/breeding.ts'
import type { Guid, SaveIndex } from '../../domain/types.ts'
import type { BreedingData } from '../../refdata/refdata.ts'

/**
 * A map that forgets its least recently used entry past `cap`.
 *
 * A `Map` iterates in insertion order, so re-inserting on every hit keeps the
 * stalest key first and eviction is "delete the first one".
 */
export class Recent<K, V> {
  private readonly entries = new Map<K, V>()
  private readonly cap: number

  constructor(cap: number) {
    this.cap = cap
  }

  /** Read without counting it as a use — safe during render. */
  peek(key: K): V | undefined {
    return this.entries.get(key)
  }

  get(key: K): V | undefined {
    const hit = this.entries.get(key)
    if (hit === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, hit)
    return hit
  }

  set(key: K, value: V) {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.cap) {
      // Non-null: the loop only runs while there is at least one entry.
      this.entries.delete(this.entries.keys().next().value!)
    }
  }

  get size(): number {
    return this.entries.size
  }
}

const tables = new WeakMap<BreedingData, BreedingTable | null>()

/**
 * The breeding table for a refdata projection, built once.
 *
 * `undefined` when the projection is empty, which is how a failed breeding
 * fetch arrives — `slimBreeding` yields empty rather than throwing.
 */
export function tableFor(
  raw: BreedingData | undefined,
): BreedingTable | undefined {
  if (!raw) return undefined
  let table = tables.get(raw)
  if (table === undefined) {
    table = Object.keys(raw.pals).length === 0 ? null : buildBreedingTable(raw)
    tables.set(raw, table)
  }
  return table ?? undefined
}

export interface StockSettings {
  ownerUid: Guid | undefined
  assumeUnknownGender: boolean
  includeGuild: boolean
  includeBase: boolean
  includeMembers: readonly Guid[]
}

/**
 * How many stocks to keep per save. A stock is a view over pals the index
 * already holds, so this is cheap; what it really bounds is how many passive
 * searches can stay cached behind them.
 */
const STOCKS_PER_SAVE = 6

/** Stands in for "no breeding table" as a weak-map key. */
const NO_TABLE = {}

const stocks = new WeakMap<SaveIndex, WeakMap<object, Recent<string, Stock>>>()

export function settingsKey(s: StockSettings): string {
  return [
    s.ownerUid ?? '',
    s.assumeUnknownGender ? 1 : 0,
    s.includeGuild ? 1 : 0,
    s.includeBase ? 1 : 0,
    // Sorted, so ticking the same guildmates in a different order is one stock.
    [...s.includeMembers].sort().join(','),
  ].join('|')
}

/** `buildStock`, returning the same object for the same question. */
export function stockFor(
  index: SaveIndex,
  table: BreedingTable | undefined,
  settings: StockSettings,
): Stock {
  let byTable = stocks.get(index)
  if (!byTable) stocks.set(index, (byTable = new WeakMap()))
  const tableKey = table ?? NO_TABLE
  let recent = byTable.get(tableKey)
  if (!recent) byTable.set(tableKey, (recent = new Recent(STOCKS_PER_SAVE)))

  const key = settingsKey(settings)
  let stock = recent.get(key)
  if (!stock) {
    stock = buildStock(index, table, settings.ownerUid, {
      assumeUnknownGender: settings.assumeUnknownGender,
      includeGuild: settings.includeGuild,
      includeBase: settings.includeBase,
      includeMembers: settings.includeMembers,
    })
    recent.set(key, stock)
  }
  return stock
}

const reaches = new WeakMap<Stock, Reach>()

/**
 * `reachFrom`, once per stock.
 *
 * Keyed on the stock alone: a stock from `stockFor` was built against one
 * table and is never handed back for another.
 */
export function reachFor(stock: Stock, table: BreedingTable): Reach {
  let reach = reaches.get(stock)
  if (!reach) reaches.set(stock, (reach = reachFrom(stock, table)))
  return reach
}
