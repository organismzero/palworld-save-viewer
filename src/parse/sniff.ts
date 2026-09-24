/**
 * Classifies a dropped file by **name**, without reading it.
 *
 * Every file this app reads is a raw `.sav`: a compressed container with
 * nothing to sniff until it is decoded, which is the worker's job. So the
 * name is all there is to go on here, and every classification is advisory —
 * each reader checks the struct type inside the file and rejects it by name if
 * it is not what the name claimed.
 *
 * The one classification that has to be right is `dps`. A `*_dps.sav`
 * DPS-storage file sits in every `Players/` folder, can run to hundreds of
 * megabytes, and would otherwise be handed to the player reader.
 *
 * Converted `.json` saves were supported once and are not any more: the `.sav`
 * reader produces the same tree, so the conversion step only cost the user
 * time. A dropped `.json` is rejected with a reason that says so.
 *
 * **Invariant: never read the bytes of a file.**
 */

import { normGuid, type Guid } from './guid.ts'

/**
 * `sav` is a *classification*, not a rejection. A raw save is a real Palworld
 * file and the app can read its container header, so it gets its own kind and
 * a purpose-built explanation rather than being lumped in with `unknown`.
 */
export type SaveKind = 'dps' | 'sav' | 'local' | 'levelmeta' | 'unknown'

export interface Sniffed {
  file: File
  kind: SaveKind
  /** Parsed from the filename. Advisory — the authority is inside the file. */
  filenameUid?: Guid
  /** Why this was rejected, for the ingestion ledger. */
  reason?: string
}

/**
 * Palworld names each player's file after their UID.
 *
 * This is the only thing that separates a player `.sav` from a level `.sav`
 * before decompressing one: size does not, because a compressed level save is
 * under a megabyte and well inside any plausible player-file cap.
 */
const UID_FILENAME = /^([0-9A-Fa-f]{32})(?:_dps)?\.sav$/i

/**
 * The client's own save, which the game always names exactly this.
 *
 * The authority is still inside the file — the worker checks `SaveData` is a `PalLocalSaveData`
 * and rejects it by name if not.
 */
const LOCALDATA_FILENAME = /^LocalData\.sav$/i

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
const LEVELMETA_FILENAME = /^LevelMeta\.sav$/i

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

/** Said for any `.json`, which is the one wrong file people are likely to try. */
export const JSON_REFUSED =
  'Converted .json saves are no longer supported. Drop the original .sav instead — it is read directly.'

export function sniff(file: File): Sniffed {
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

  // Third name check with the same order requirement, and the one that took
  // longest to notice: a real `Players/` folder holds
  // `<uid>_dps.sav`, whose name matches `UID_FILENAME` — so below the generic
  // `.sav` branch it was classified as a raw save, passed the "named player
  // save" filter, and reached the player reader, which rejected it. Every folder
  // drop then listed a rejection nobody could act on.
  if (looksLikeDpsName(name)) {
    return { file, kind: 'dps', filenameUid, reason: 'DPS storage file.' }
  }

  // Classified, not rejected: the container header says which compression it
  // uses, and that determines whether there is anything useful to say beyond
  // "no". The header read happens at the call site, not here — this function's
  // invariant is that it never reads a file it has not classified first.
  if (lower.endsWith('.sav')) {
    return { file, kind: 'sav', filenameUid }
  }

  if (lower.endsWith('.json')) {
    return { file, kind: 'unknown', filenameUid, reason: JSON_REFUSED }
  }

  return {
    file,
    kind: 'unknown',
    filenameUid,
    reason: 'Not a Palworld save file. The app reads .sav files.',
  }
}

export interface Partitioned {
  rejected: Sniffed[]
  /**
   * Files that are expected, understood and of no use to this app — today only
   * `*_dps.sav`, the DPS-storage file that sits in every `Players/` folder.
   *
   * Separate from `rejected` because a rejection is news and this is not: it
   * arrives with every folder drop, it will never be readable, and listing it
   * beside the player saves it is not one of only invites the question again.
   * Still reported when a drop contains nothing else, or dropping one on its own
   * would look like the app had ignored the file.
   */
  ignored: Sniffed[]
  /** Raw saves, kept apart so the caller can read their headers and explain. */
  savs: Sniffed[]
  /**
   * The client's `LocalData`. Its own bucket rather than a
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

/** Sniffs a batch and splits it. */
export function partition(files: File[]): Partitioned {
  const sniffed = files.map((f) => sniff(f))
  const locals = sniffed.filter((s) => s.kind === 'local')
  const metas = sniffed.filter((s) => s.kind === 'levelmeta')

  return {
    savs: sniffed.filter((s) => s.kind === 'sav'),
    local: locals[0],
    levelMeta: metas[0],
    rejected: sniffed.filter(
      (s) =>
        s.kind === 'unknown' || locals.indexOf(s) > 0 || metas.indexOf(s) > 0,
    ),
    ignored: sniffed.filter((s) => s.kind === 'dps'),
  }
}
