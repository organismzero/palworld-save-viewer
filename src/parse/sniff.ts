/**
 * Classifies a dropped file by **name**, without reading it.
 *
 * Every file this app reads is a raw `.sav`: a compressed container with
 * nothing to sniff until it is decoded, which is the worker's job. So the
 * name is all there is to go on here, and every classification is advisory —
 * each reader checks the struct type inside the file and rejects it by name if
 * it is not what the name claimed.
 *
 * The one classification that has to be right is `dps`. A `*_dps.sav` holds a
 * player's Dimensional Pal Storage, sits in a `Players/` folder beside the
 * player save it is named after, and would otherwise be handed to the player
 * reader, which rejects it.
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
export type SaveKind =
  'dps' | 'sav' | 'local' | 'levelmeta' | 'settings' | 'unknown'

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

/**
 * A dedicated server's settings, the one file this app reads that is neither a
 * `.sav` nor in the save folder: it lives under `Pal/Saved/Config/<Platform>/`.
 *
 * By name, like the rest, and for the same reason: nothing here reads a file.
 * The parser checks for the section header and refuses anything without it.
 */
const SETTINGS_FILENAME = /^PalWorldSettings\.ini$/i

/**
 * The template the game ships beside it, which lists every default. It parses
 * exactly like the real thing, which is the problem: read as "your server's
 * settings" it would report a vanilla server whatever the server is set to.
 */
const SETTINGS_TEMPLATE = /^DefaultPalWorldSettings\.ini$/i

export function looksLikeSettingsName(name: string): boolean {
  return SETTINGS_FILENAME.test(name)
}

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
    return { file, kind: 'dps', filenameUid }
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

  if (looksLikeSettingsName(name)) return { file, kind: 'settings' }
  if (SETTINGS_TEMPLATE.test(name)) {
    return {
      file,
      kind: 'unknown',
      reason:
        'That is the game’s template of default values, not your server’s settings. The one to add is PalWorldSettings.ini, under Pal/Saved/Config.',
    }
  }
  if (lower.endsWith('.ini')) {
    return {
      file,
      kind: 'unknown',
      reason: 'The only .ini this app reads is PalWorldSettings.ini.',
    }
  }

  return {
    file,
    kind: 'unknown',
    filenameUid,
    reason:
      'Not a Palworld save file. The app reads .sav files, and PalWorldSettings.ini.',
  }
}

export interface Partitioned {
  rejected: Sniffed[]
  /**
   * `*_dps.sav` files: each one player's Dimensional Pal Storage.
   *
   * Their own bucket, apart from `savs`, because the level-picking heuristic
   * must never see one — a storage file is named after a player and can be
   * larger than the world. They are read with the player saves, and like them
   * need a world open to be read onto.
   */
  storage: Sniffed[]
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
  /**
   * The server's `PalWorldSettings.ini`. One is kept, since it describes one
   * server, and it is read on the main thread: it is text.
   */
  settings?: Sniffed
}

/* -------------------------------------------------------------------------
   Where a file sat in what was dropped
   ------------------------------------------------------------------------- */

/**
 * Paths for files that arrived by drag and drop.
 *
 * A folder chosen through the picker carries `webkitRelativePath`; one that was
 * dropped does not, and the entry it came from is gone by the time anything
 * here sees the `File`. So the drop walker writes each one down as it goes.
 */
const DROPPED_PATHS = new WeakMap<File, string>()

export function notePath(file: File, path: string): void {
  DROPPED_PATHS.set(file, path)
}

/** A file's path within the gesture that brought it, or just its name. */
export function pathOf(file: File): string {
  const path = DROPPED_PATHS.get(file) || file.webkitRelativePath || file.name
  return path.replace(/^\/+/, '')
}

const depthOf = (path: string) => path.split('/').length - 1
const dirOf = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** The one nearest the top of what was dropped; the first, among equals. */
function shallowest(of: Sniffed[]): Sniffed | undefined {
  let best: Sniffed | undefined
  let bestDepth = Infinity
  for (const s of of) {
    const d = depthOf(pathOf(s.file))
    if (d < bestDepth) {
      best = s
      bestDepth = d
    }
  }
  return best
}

export interface ChosenWorld {
  level: Sniffed
  /** Player saves and storage files to read onto it, one per file name. */
  players: Sniffed[]
  /** Other level saves, and copies of player files, from deeper in the drop. */
  ignored: Sniffed[]
}

/**
 * Which save in a drop is the world, and which files go with it.
 *
 * A world folder is not one world. The game keeps its autosaves inside it —
 * `backup/world/<timestamp>/` — and each of those is a whole earlier copy: a
 * `Level.sav`, a `LevelMeta.sav`, and a `Players/` of files with the same names
 * as the live ones. Fifty-six of them, in the reference folder.
 *
 * So the level is the one **nearest the top**: the live save sits in the folder
 * itself and every backup sits under it. Size, which this used to go by, picks
 * whichever copy happened to be largest — an older one as readily as the live
 * one — and then handed the other fifty-odd levels to the player reader, to be
 * decompressed in full and refused one at a time.
 *
 * A player's file is the copy nearest that level, by the same reasoning. Names
 * settle it only when the drop has no folders in it at all, where `Level.sav`
 * is preferred and size is the last resort it always was.
 */
export function chooseWorld(savs: Sniffed[], storage: Sniffed[]): ChosenWorld {
  const unnamed = savs.filter((s) => s.filenameUid === undefined)
  // Nothing that could be a level: the caller only asks when something is, but
  // the largest file is the least wrong answer if it ever does.
  const candidates = unnamed.length > 0 ? unnamed : savs
  const rank = (s: Sniffed) => {
    const path = pathOf(s.file)
    return [
      depthOf(path),
      /^level\.sav$/i.test(s.file.name) ? 0 : 1,
      -s.file.size,
    ]
  }
  const level = [...candidates].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)]
    return ra[0]! - rb[0]! || ra[1]! - rb[1]! || ra[2]! - rb[2]!
  })[0]!

  const home = dirOf(pathOf(level.file))
  const under = (path: string) => home === '' || path.startsWith(`${home}/`)

  const byName = new Map<string, Sniffed>()
  const ignored: Sniffed[] = candidates.filter((s) => s !== level)
  const others = [
    ...(unnamed.length > 0 ? savs.filter((s) => s.filenameUid) : []),
    ...storage,
  ]
  for (const s of others) {
    const key = s.file.name.toLowerCase()
    const held = byName.get(key)
    if (!held) {
      byName.set(key, s)
      continue
    }
    const [a, b] = [pathOf(held.file), pathOf(s.file)]
    const better =
      Number(under(b)) - Number(under(a)) || depthOf(a) - depthOf(b)
    if (better > 0) {
      ignored.push(held)
      byName.set(key, s)
    } else {
      ignored.push(s)
    }
  }

  return { level, players: [...byName.values()], ignored }
}

/** Sniffs a batch and splits it. */
export function partition(files: File[]): Partitioned {
  const sniffed = files.map((f) => sniff(f))
  // Nearest the top first, so that the copy kept below is the live one and not
  // whichever backup the folder happened to list first.
  const nearest = (kind: SaveKind) => {
    const all = sniffed.filter((s) => s.kind === kind)
    const top = shallowest(all)
    return top ? [top, ...all.filter((s) => s !== top)] : all
  }
  const locals = nearest('local')
  const metas = nearest('levelmeta')
  const settings = nearest('settings')

  return {
    savs: sniffed.filter((s) => s.kind === 'sav'),
    local: locals[0],
    levelMeta: metas[0],
    settings: settings[0],
    rejected: sniffed.filter(
      (s) =>
        s.kind === 'unknown' ||
        locals.indexOf(s) > 0 ||
        metas.indexOf(s) > 0 ||
        settings.indexOf(s) > 0,
    ),
    storage: sniffed.filter((s) => s.kind === 'dps'),
  }
}
