/**
 * The parts of the command palette that are decisions and not plumbing: how
 * well a name matches what was typed, which pals to show for it, and what the
 * "recent" list keeps.
 *
 * Pure, so they are tested without the dialog.
 */

import type { Pal } from '../domain/types.ts'

/**
 * How well `text` answers `q`, lower is better, or nothing if it does not.
 *
 * 0 is the whole name, 1 its start, 2 the start of a later word, 3 anywhere.
 * `q` must already be trimmed and lowercased.
 */
export function matchRank(text: string, q: string): number | undefined {
  const t = text.toLowerCase()
  const at = t.indexOf(q)
  if (at === -1) return undefined
  if (t === q) return 0
  if (at === 0) return 1
  // The start of a word: "ig" finds "Pebble Ignis" ahead of "Digtoise".
  return /[\s\-_(]/.test(t[at - 1]!) ? 2 : 3
}

/**
 * The pals to show for a query: best match first, then highest level.
 *
 * The palette used to take the first six that matched in the order the save
 * lists them, which for "anubis" in a guild with thirty of them was six
 * arbitrary ones, often level 1 hatchlings. A nickname or a species name can
 * match, and the better of the two counts.
 */
export function rankPals(
  pals: readonly Pal[],
  q: string,
  speciesName: (characterId: string) => string,
  limit: number,
): Pal[] {
  const hits: { pal: Pal; rank: number }[] = []
  for (const pal of pals) {
    const ranks = [
      pal.nickname ? matchRank(pal.nickname, q) : undefined,
      matchRank(speciesName(pal.characterId), q),
      // The asset id last and worst: it is what the species was called before
      // game data loaded, and still findable by it afterwards.
      matchRank(pal.characterId, q) === undefined ? undefined : 3,
    ].filter((r): r is number => r !== undefined)
    if (ranks.length > 0) hits.push({ pal, rank: Math.min(...ranks) })
  }
  return hits
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.pal.level - a.pal.level ||
        a.pal.instanceId.localeCompare(b.pal.instanceId),
    )
    .slice(0, limit)
    .map((h) => h.pal)
}

/**
 * `list` with `item` put first, once, and no longer than `cap`.
 *
 * Choosing something already in the list moves it to the front and does not
 * list it twice.
 */
export function pushRecent<T extends { key: string }>(
  list: readonly T[],
  item: T,
  cap = 8,
): T[] {
  return [item, ...list.filter((r) => r.key !== item.key)].slice(0, cap)
}
