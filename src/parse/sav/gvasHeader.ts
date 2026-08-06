/**
 * The GVAS file header.
 *
 * Fixed layout, then a variable list of custom-version GUIDs that Unreal uses
 * to version individual subsystems. The strict checks below are deliberate:
 * this project has only ever seen save-game version 3 with custom-version
 * format 3, and a save that differs is one whose property layout may differ
 * too. Failing at the header with a clear message beats parsing on and
 * producing subtly wrong numbers.
 */

import type { FArchiveReader, Json } from './farchive.ts'

/** `"GVAS"` as a little-endian i32. */
export const GVAS_MAGIC = 0x53415647

export interface GvasHeader {
  magic: number
  save_game_version: number
  package_file_version_ue4: number
  package_file_version_ue5: number
  engine_version_major: number
  engine_version_minor: number
  engine_version_patch: number
  engine_version_changelist: number
  engine_version_branch: string
  custom_version_format: number
  custom_versions: [string, number][]
  save_game_class_name: string
  [key: string]: Json
}

export function readHeader(reader: FArchiveReader): GvasHeader {
  const magic = reader.i32()
  if (magic !== GVAS_MAGIC) {
    throw new Error(
      `Not a GVAS archive: magic is 0x${(magic >>> 0).toString(16)}, expected "GVAS".`,
    )
  }

  const saveGameVersion = reader.i32()
  if (saveGameVersion !== 3) {
    throw new Error(
      `Unsupported GVAS save game version ${saveGameVersion} (expected 3).`,
    )
  }

  const header: GvasHeader = {
    magic,
    save_game_version: saveGameVersion,
    package_file_version_ue4: reader.i32(),
    package_file_version_ue5: reader.i32(),
    engine_version_major: reader.u16(),
    engine_version_minor: reader.u16(),
    engine_version_patch: reader.u16(),
    engine_version_changelist: reader.u32(),
    engine_version_branch: reader.fstring(),
    custom_version_format: reader.i32(),
    custom_versions: [],
    save_game_class_name: '',
  }

  if (header.custom_version_format !== 3) {
    throw new Error(
      `Unsupported custom version format ${header.custom_version_format} (expected 3).`,
    )
  }

  header.custom_versions = reader.tarray((r): [string, number] => [
    r.guid(),
    r.i32(),
  ])
  header.save_game_class_name = reader.fstring()
  return header
}
