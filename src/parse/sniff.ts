/**
 * Classifies a dropped file by **content**, not by name.
 *
 * This matters more than it looks. A player save and a `*_dps.sav` DPS-storage
 * file have byte-identical GVAS headers, so a header sniff cannot tell them
 * apart — and the DPS file in the reference save set is **244 MB**, so parsing
 * one by mistake is not a slow path, it is a dead tab.
 *
 * Three independent stops guard against that, each individually sufficient:
 * a filename match, a size cap, and the content marker. The filename check is
 * the cheap first stop, never the discriminator — a renamed or `_dps2` file
 * would sail straight past it.
 *
 * **Invariant: never read the bytes of a file that is not `level` or `player`.**
 */

import { normGuid, type Guid } from './guid.ts'

/**
 * `sav` is a *classification*, not a rejection. A raw save is a real Palworld
 * file and the app can read its container header, so it gets its own kind and
 * a purpose-built explanation rather than being lumped in with `unknown`.
 */
export type SaveKind =
  'level' | 'player' | 'dps' | 'sav' | 'local' | 'levelmeta' | 'unknown'

export interface Sniffed {
  file: File
  kind: SaveKind
  /** Parsed from the filename. Advisory — the authority is inside the file. */
  filenameUid?: Guid
  /** Why this was rejected, for the ingestion ledger. */
  reason?: string
}

/**
 * Largest plausible player save. Real ones measure 66–111 KB; this is ~70x
 * headroom and still three orders of magnitude below the DPS file.
 */
export const MAX_PLAYER_BYTES = 8 * 1024 * 1024

/** How much of the file to read looking for the discriminating marker. */
const PREFIX_BYTES = 64 * 1024

/**
 * Markers, in the order they must be tested.
 *
 * `SaveParameterArray` goes first because it is the one whose absence we
 * cannot afford: a DPS file also contains neither `Version` nor `Timestamp`,
 * but testing for a *missing* key is not something a prefix scan can do
 * reliably, whereas its own root key is right at the front.
 */
const MARKERS: readonly [string, SaveKind][] = [
  ['SaveParameterArray', 'dps'],
  ['PalLocalSaveData', 'local'],
  ['PalWorldBaseInfoSaveData', 'levelmeta'],
  ['PalWorldPlayerSaveData', 'player'],
  ['worldSaveData', 'level'],
]

/**
 * A raw save that has been renamed rather than converted.
 *
 * `PlM`/`PlZ`/`CNK` are the container magics and `GVAS` the archive header
 * that follows; both sit within the first 32 bytes, so a prefix scan sees them
 * even though the rest of the file is compressed binary. Worth detecting
 * separately because "rename it back and convert it" is a completely different
 * instruction from "this is not a save".
 */
const RAW_SAVE_MARKERS = ['PlM', 'PlZ', 'CNK', 'GVAS']

/**
 * Palworld names each player's file after their UID, in both formats.
 *
 * This is the only thing that separates a player `.sav` from a level `.sav`
 * before decompressing one: size does not, because a compressed level save is
 * under a megabyte and well inside any plausible player-file cap.
 */
const UID_FILENAME = /^([0-9A-Fa-f]{32})(?:_dps)?\.(json|sav)$/i

/**
 * The client's own save, which the game always names exactly this.
 *
 * Matching on the name is the same concession `UID_FILENAME` already makes:
 * a `.sav` is compressed, so there is no content to sniff without decoding it,
 * and this function's invariant is that it never decodes. The authority is
 * still inside the file — the worker checks `SaveData` is a `PalLocalSaveData`
 * and rejects it by name if not.
 */
const LOCALDATA_FILENAME = /^LocalData\.(json|sav)$/i

/**
 * The world's metadata sidecar, which sits beside `Level.sav` in every world
 * folder and every autosave backup.
 *
 * Matched by name for the same reason as `LocalData` — a `.sav` is compressed and
 * this function does not decode — and it has to be matched at all because
 * `acceptSavs` treats every non-UID-named `.sav` as a level candidate and hands
 * everything but the largest to the player reader. Left unrecognised, dropping a
 * real world folder ends in `LevelMeta.sav has no PlayerUId.`, which blames a
 * perfectly good file for not being something it never claimed to be.
 *
 * As with `LocalData`, the authority stays inside the file: the reader checks
 * `SaveData` is a `PalWorldBaseInfoSaveData` and rejects it by name if not.
 */
const LEVELMETA_FILENAME = /^LevelMeta\.(json|sav)$/i

export function looksLikeLevelMetaName(name: string): boolean {
  return LEVELMETA_FILENAME.test(name)
}

export function filenameUidOf(name: string): Guid | undefined {
  const m = UID_FILENAME.exec(name)
  return m ? normGuid(m[1]!) : undefined
}

export function looksLikeLocalDataName(name: string): boolean {
  return LOCALDATA_FILENAME.test(name)
}

export function looksLikeDpsName(name: string): boolean {
  return /_dps/i.test(name)
}

export async function sniff(
  file: File,
  prefixBytes = PREFIX_BYTES,
): Promise<Sniffed> {
  const name = file.name
  const filenameUid = filenameUidOf(name)
  const lower = name.toLowerCase()

  // `LocalData.sav` has to be caught before the generic `.sav` branch, or the
  // caller's "largest unnamed .sav is the level" heuristic would hand it to the
  // player-save reader — which does not reject it, because it has a `SaveData`
  // of its own, and so would quietly produce a junk player record.
  if (looksLikeLocalDataName(name)) {
    return { file, kind: 'local', filenameUid }
  }

  // Same reasoning, and the same order requirement: it must be caught before the
  // generic `.sav` branch or `acceptSavs` hands it to the player reader.
  if (looksLikeLevelMetaName(name)) {
    return { file, kind: 'levelmeta', filenameUid }
  }

  // Classified, not rejected: the container header says which compression it
  // uses, and that determines whether there is anything useful to say beyond
  // "no". The header read happens at the call site, not here — this function's
  // invariant is that it never reads a file it has not classified first.
  if (lower.endsWith('.sav')) {
    return { file, kind: 'sav', filenameUid }
  }

  if (!lower.endsWith('.json')) {
    return { file, kind: 'unknown', filenameUid, reason: 'Not a .json file.' }
  }

  // Stop 1: the name. Returns without touching a single byte.
  if (looksLikeDpsName(name)) {
    return { file, kind: 'dps', filenameUid, reason: 'DPS storage file.' }
  }

  // Stop 2: the size. A level save is legitimately huge, so this only bounds
  // the player-shaped candidates; the content check below sorts the rest.
  const oversizeForPlayer = file.size > MAX_PLAYER_BYTES

  // Stop 3: the content.
  const prefix = await file.slice(0, prefixBytes).text()
  for (const [marker, kind] of MARKERS) {
    if (!prefix.includes(marker)) continue

    if (kind === 'dps') {
      return { file, kind: 'dps', filenameUid, reason: 'DPS storage file.' }
    }
    if (kind === 'player' && oversizeForPlayer) {
      return {
        file,
        kind: 'unknown',
        filenameUid,
        reason: `Too large to be a player save (${Math.round(file.size / 1e6)} MB).`,
      }
    }
    return { file, kind, filenameUid }
  }

  // A `.sav` renamed to `.json` reaches here, and deserves the same advice as
  // one that kept its extension rather than a flat "not a save".
  if (RAW_SAVE_MARKERS.some((m) => prefix.slice(0, 64).includes(m))) {
    return {
      file,
      kind: 'unknown',
      filenameUid,
      reason:
        'This is a raw .sav with a .json extension. Give it back its .sav extension and drop it again — raw saves are decoded directly.',
    }
  }

  return {
    file,
    kind: 'unknown',
    filenameUid,
    reason:
      'Not a Palworld save. A level save contains worldSaveData and a player save PalWorldPlayerSaveData; this file has neither.',
  }
}

export interface Partitioned {
  level?: Sniffed
  players: Sniffed[]
  rejected: Sniffed[]
  /** Raw saves, kept apart so the caller can read their headers and explain. */
  savs: Sniffed[]
  /**
   * The client's `LocalData`, in either format. Its own bucket rather than a
   * member of `savs` because the caller's level-picking heuristic must never
   * see it; only one is kept, since it describes a single client.
   */
  local?: Sniffed
  /**
   * The world's `LevelMeta`. Its own bucket for the same reason as `local`: the
   * level-picking heuristic must never see it, and only one is kept because it
   * describes a single world.
   */
  levelMeta?: Sniffed
}

/**
 * Sniffs a batch and splits it. If several level files are dropped the largest
 * wins, since a partial or truncated export is the likelier mistake.
 */
export async function partition(files: File[]): Promise<Partitioned> {
  const sniffed = await Promise.all(files.map((f) => sniff(f)))
  const levels = sniffed.filter((s) => s.kind === 'level')
  levels.sort((a, b) => b.file.size - a.file.size)
  const locals = sniffed.filter((s) => s.kind === 'local')
  const metas = sniffed.filter((s) => s.kind === 'levelmeta')

  return {
    level: levels[0],
    players: sniffed.filter((s) => s.kind === 'player'),
    savs: sniffed.filter((s) => s.kind === 'sav'),
    local: locals[0],
    levelMeta: metas[0],
    rejected: sniffed.filter(
      (s) =>
        s.kind === 'dps' ||
        s.kind === 'unknown' ||
        levels.indexOf(s) > 0 ||
        locals.indexOf(s) > 0 ||
        metas.indexOf(s) > 0,
    ),
  }
}
