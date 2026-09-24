/**
 * The real save every golden suite reads, from `data/` (gitignored).
 *
 * Raw `.sav` files, the same ones a user drops: the app no longer reads
 * converted `.json`, so neither do its tests. Each suite gates on `hasLevel`
 * and self-skips without a save, which keeps CI green.
 *
 * Memoised per test file — vitest runs each file in its own worker, so this is
 * one decode per suite rather than one per test.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { readSavFile } from '../../scripts/readSav.ts'

export const DATA = resolve(process.cwd(), 'data')
export const LEVEL_SAV = join(DATA, 'Level.sav')
export const PLAYERS_DIR = join(DATA, 'Players')
export const LOCAL_SAV = join(DATA, 'LocalData.sav')

export const hasLevel = existsSync(LEVEL_SAV)

let level: Promise<any> | undefined

/** The world's GVAS tree, read once per test file. */
export function levelTree(): Promise<any> {
  level ??= readSavFile(LEVEL_SAV)
  return level
}

/**
 * Every player save, as the app would take them from a `Players/` folder:
 * `<uid>.sav` only, never the `_dps.sav` storage file beside it.
 */
export function playerSaveNames(): string[] {
  if (!existsSync(PLAYERS_DIR)) return []
  return readdirSync(PLAYERS_DIR)
    .filter((f) => /^[0-9A-Fa-f]{32}\.sav$/.test(f))
    .sort()
}

export function dpsSaveNames(): string[] {
  if (!existsSync(PLAYERS_DIR)) return []
  return readdirSync(PLAYERS_DIR).filter((f) => /_dps\.sav$/i.test(f))
}

export async function playerTrees(): Promise<{ name: string; tree: any }[]> {
  return Promise.all(
    playerSaveNames().map(async (name) => ({
      name,
      tree: await readSavFile(join(PLAYERS_DIR, name)),
    })),
  )
}
