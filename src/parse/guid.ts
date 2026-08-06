/**
 * GUID normalisation.
 *
 * The save mixes hyphenated and unhyphenated GUID spellings across sections,
 * so every GUID that enters an index goes through {@link normGuid} first.
 * PalworldSaveTools does the same (lowercase, hyphens stripped) and matching
 * its convention keeps ported logic honest.
 */

/** A normalised GUID: 32 lowercase hex characters, no hyphens. */
export type Guid = string

export const ZERO_GUID = '0'.repeat(32)

export function normGuid(g: unknown): Guid | undefined {
  if (typeof g !== 'string') return undefined
  const n = g.replace(/-/g, '').toLowerCase()
  return n.length === 32 ? n : undefined
}

/**
 * True for absent or all-zero GUIDs.
 *
 * This guard matters more than it looks: unlocked chests carry a zero
 * `private_lock_player_uid`, unowned containers a zero `BelongInfo.GroupId`,
 * and wild pals a zero `OwnerPlayerUId`. Letting any of those become a map key
 * silently collapses every unowned thing into one bucket.
 */
export function isZero(g: Guid | undefined): boolean {
  return !g || g === ZERO_GUID
}

/** Drops zero/absent GUIDs, so `nonZero(x)` is safe to use as a map key. */
export function nonZero(g: Guid | undefined): Guid | undefined {
  return isZero(g) ? undefined : g
}

/** Re-inserts hyphens for display. Not for use as a key. */
export function formatGuid(g: Guid | undefined): string {
  if (!g || g.length !== 32) return g ?? ''
  return `${g.slice(0, 8)}-${g.slice(8, 12)}-${g.slice(12, 16)}-${g.slice(16, 20)}-${g.slice(20)}`
}

/**
 * Player UIDs are stored as GUIDs whose meaningful part is the first 4 bytes
 * (e.g. `d4c3b2a1-0000-0000-0000-000000000000`). This yields the short form
 * players actually recognise.
 */
export function shortPlayerUid(g: Guid | undefined): string {
  return g ? g.slice(0, 8).toUpperCase() : ''
}
