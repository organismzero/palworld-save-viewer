/**
 * Aggregates behind the guild dashboard.
 *
 * All pure, and all taking their reference-data lookups as arguments rather
 * than reaching for a store. Two reasons: they stay testable without mocking
 * IndexedDB, and they keep working in the degraded state, where a pal's
 * element is unknown and its species name is a raw asset id. Every one of
 * these has an explicit answer for "reference data is missing" — usually an
 * `unknown` bucket that is shown rather than dropped, because a donut that
 * silently omits 400 pals is worse than one that admits it cannot classify
 * them.
 */

import type { ElementName } from '../lib/color.ts'
import { ELEMENTS } from '../lib/color.ts'
import type { Guild, Pal, Player, SaveIndex } from './types.ts'

/** What the dashboard needs to know about a species, and nothing more. */
export interface SpeciesLookup {
  (
    characterId: string,
  ):
    | { element1?: string; element2?: string; work?: Record<string, number> }
    | undefined
}

/* -------------------------------------------------------------------------
   Guild-level totals
   ------------------------------------------------------------------------- */

export interface GuildTotals {
  players: Player[]
  pals: Pal[]
  structures: number
  bases: number
  /**
   * `memberCount` in the save is the length of
   * `individual_character_handle_ids` — 1,108 for a 10-player guild, because
   * it counts every pal handle too. Never show it as a member count.
   */
  handles: number
}

export function guildTotals(index: SaveIndex, guild: Guild): GuildTotals {
  return {
    players: index.playersByGuild.get(guild.groupId) ?? [],
    pals: index.palsByGuild.get(guild.groupId) ?? [],
    structures: index.structuresByGuild.get(guild.groupId)?.length ?? 0,
    bases: guild.baseIds.length,
    handles: guild.characterHandleIds.length,
  }
}

/* -------------------------------------------------------------------------
   Distributions
   ------------------------------------------------------------------------- */

export interface Bin {
  from: number
  to: number
  count: number
}

/**
 * Level distribution.
 *
 * Bins span 1..max rather than 1..60: a save whose best pal is level 38 should
 * not be drawn with 22 empty bins on the right, which reads as "your pals are
 * bad" rather than "you have not hit the cap".
 */
export function levelHistogram(pals: Pal[], bucket = 5): Bin[] {
  if (pals.length === 0) return []
  const max = Math.max(...pals.map((p) => p.level))
  const bins: Bin[] = []
  for (let from = 1; from <= max; from += bucket) {
    bins.push({ from, to: Math.min(from + bucket - 1, max), count: 0 })
  }
  for (const pal of pals) {
    const i = Math.min(bins.length - 1, Math.floor((pal.level - 1) / bucket))
    const bin = bins[i]
    if (bin) bin.count += 1
  }
  return bins
}

export interface ElementSlice {
  name: ElementName | 'Unknown'
  display: string
  color: string
  count: number
}

/**
 * Element distribution, counted by **primary element only**.
 *
 * Counting both elements would make the slices sum to more than the number of
 * pals, and a donut whose slices sum past 100% is a lie. Dual-element pals are
 * counted once, under their first element.
 */
export function elementDistribution(
  pals: Pal[],
  species: SpeciesLookup,
): ElementSlice[] {
  const tally = new Map<string, number>()
  for (const pal of pals) {
    const raw = species(pal.characterId)?.element1
    const el = ELEMENTS.find(
      (e) => e.name.toLowerCase() === tail(raw)?.toLowerCase(),
    )
    const key = el?.name ?? 'Unknown'
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }

  const slices: ElementSlice[] = []
  for (const el of ELEMENTS) {
    const count = tally.get(el.name) ?? 0
    if (count > 0) {
      slices.push({
        name: el.name,
        display: el.display,
        color: el.oklch,
        count,
      })
    }
  }
  const unknown = tally.get('Unknown') ?? 0
  if (unknown > 0) {
    slices.push({
      name: 'Unknown',
      display: 'Unclassified',
      color: 'var(--color-line)',
      count: unknown,
    })
  }
  return slices.sort((a, b) => b.count - a.count)
}

function tail(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const sep = raw.lastIndexOf('::')
  return sep === -1 ? raw : raw.slice(sep + 2)
}

export interface WorkCoverage {
  id: string
  display: string
  /** Pals with any level in this work type. */
  pals: number
  /** Summed levels — a single level-4 miner beats four level-1 ones. */
  levels: number
}

/**
 * Work-suitability coverage across a roster.
 *
 * The point of this chart is finding the gap ("your guild is weak on
 * Watering"), so a work type with zero pals is kept in the list. Dropping it
 * would hide exactly the thing worth seeing.
 */
export function workCoverage(
  pals: Pal[],
  species: SpeciesLookup,
  types: readonly { id: string; display: string }[],
): WorkCoverage[] {
  const out = types.map((t) => ({
    id: t.id,
    display: t.display,
    pals: 0,
    levels: 0,
  }))
  const byId = new Map(out.map((w) => [w.id, w]))

  for (const pal of pals) {
    const base = species(pal.characterId)?.work ?? {}
    // A pal's own bonuses stack on top of its species' base suitability.
    const ids = new Set([
      ...Object.keys(base),
      ...Object.keys(pal.workSuitabilityBonus),
    ])
    for (const id of ids) {
      const level = (base[id] ?? 0) + (pal.workSuitabilityBonus[id] ?? 0)
      if (level <= 0) continue
      const row = byId.get(id)
      if (!row) continue
      row.pals += 1
      row.levels += level
    }
  }
  return out
}

export interface PassiveCount {
  asset: string
  name: string
  rank?: number
  count: number
}

export function passiveFrequency(
  pals: Pal[],
  passive: (asset: string) => { name: string; rank: number } | undefined,
  limit = 10,
): PassiveCount[] {
  const tally = new Map<string, number>()
  for (const pal of pals) {
    for (const asset of pal.passives) {
      tally.set(asset, (tally.get(asset) ?? 0) + 1)
    }
  }
  return [...tally]
    .map(([asset, count]) => {
      const info = passive(asset)
      return { asset, name: info?.name ?? asset, rank: info?.rank, count }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/* -------------------------------------------------------------------------
   Per-player
   ------------------------------------------------------------------------- */

export interface PlayerSummary {
  player: Player
  pals: Pal[]
  /** Map objects this player personally placed. */
  built: number
  /** Their best pal by IV total, for the card. */
  best?: Pal
  role?: number
  isAdmin: boolean
}

export function playerSummary(
  index: SaveIndex,
  player: Player,
  guild: Guild | undefined,
): PlayerSummary {
  const pals = index.palsByOwner.get(player.playerUid) ?? []
  let built = 0
  for (const s of index.structures) {
    if (s.buildPlayerUid === player.playerUid) built += 1
  }
  return {
    player,
    pals,
    built,
    best: pals.reduce<Pal | undefined>(
      (a, b) => (a === undefined || ivOf(b) > ivOf(a) ? b : a),
      undefined,
    ),
    role: guild?.members.find((m) => m.playerUid === player.playerUid)?.role,
    isAdmin: guild?.adminPlayerUid === player.playerUid,
  }
}

function ivOf(p: Pal): number {
  return (p.ivHp ?? 0) + (p.ivAttack ?? 0) + (p.ivDefense ?? 0)
}

/**
 * Progress through the current level, 0..1.
 *
 * The save records only a cumulative XP total, so the denominator has to come
 * from the levelling curve in reference data. Returns `undefined` — and the
 * card shows the raw total instead — whenever it cannot be computed honestly:
 * no reference data, a level past the end of the table, or a level whose
 * neighbours give a zero-width band.
 *
 * Note the curve's `TotalEXP` is the XP required to *be* a level, so the band
 * for level L runs from `total[L]` to `total[L+1]`. Using the table's own
 * `NextEXP` instead is off by one row — it is the cost of reaching L from
 * L−1, not of leaving L.
 */
export function levelProgress(
  level: number,
  exp: number,
  table: { level: number; total: number }[] | undefined,
): number | undefined {
  if (!table?.length) return undefined
  const here = table.find((r) => r.level === level)
  const next = table.find((r) => r.level === level + 1)
  if (!here || !next) return undefined

  const span = next.total - here.total
  if (!(span > 0)) return undefined
  return Math.max(0, Math.min(1, (exp - here.total) / span))
}
