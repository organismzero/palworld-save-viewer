/**
 * `LevelMeta.sav` — the world's metadata sidecar.
 *
 * The smallest file in a Palworld save by two orders of magnitude: 1,931 bytes
 * compressed, 2,122 decompressed, and it holds four values. It is what the
 * game's own load screen reads to list a world without opening it.
 *
 * ## Why it is worth reading at all
 *
 * `Timestamp` is the only answer in the whole save to "when was this written" —
 * the app's other handle is the file's mtime, which it never sees and which
 * copying destroys.
 *
 * **It is a naive wall clock, not UTC.** Measured across a 30-snapshot autosave
 * set: each folder the server named `2026.08.11-15.31.41` carries ticks whose
 * digits are exactly that, so the game wrote what its own clock read and attached
 * no zone. Nothing in the save records the server's offset, so the *instant* is
 * unknowable and `relativeTime` must never be pointed at this — on a UTC+10 host
 * it renders a save from this afternoon as written in the future. `saveClock` in
 * `lib/format.ts` formats the reading instead, and every caller says whose clock
 * it is.
 *
 * Differences are safe: two tick values sit in the same unknown frame, so "caught
 * nine days before this save" needs no timezone and is exact.
 *
 * Not to be confused with the guild's `last_online_real_time`, which is a
 * duration of server uptime and lands in year 0001 if read as a DateTime.
 */

import type { Node } from '../../gvas.ts'
import { int, str, struct } from '../../gvas.ts'
import type { LevelMetaPayload } from '../../../domain/types.ts'
import type { Warnings } from '../../warnings.ts'

/** Everything the file is known to contain. Anything else is worth a warning. */
const KNOWN_SAVE_DATA_FIELDS = new Set(['WorldName', 'InGameDay'])

export function readLevelMeta(
  raw: Node,
  fileName: string,
  warn: Warnings,
): LevelMetaPayload {
  const sd = raw?.properties?.SaveData
  const body = sd?.value

  // The filename is what routed this file here — `.sav` bytes are compressed, so
  // nothing upstream could check the contents. This is where that check happens,
  // exactly as in `readLocalData`.
  if (!body || sd?.struct_type !== 'PalWorldBaseInfoSaveData') {
    throw new Error(
      `${fileName} does not look like a Palworld LevelMeta save: expected properties.SaveData to be a PalWorldBaseInfoSaveData${
        sd?.struct_type ? `, found ${sd.struct_type}` : ', found nothing'
      }.`,
    )
  }

  for (const key of Object.keys(body)) {
    if (!KNOWN_SAVE_DATA_FIELDS.has(key)) {
      warn.add('unknown-levelmeta-field', `SaveData.${key}`)
    }
  }

  const props = raw?.properties ?? {}

  return {
    fileName,
    version: int(props.Version),
    savedAtTicks: ticksOf(props.Timestamp),
    // `"Autosave_W"` in every autosave, so it is a label rather than an identity.
    // Kept because it is what the game shows, and dropped when empty rather than
    // surfaced as a blank field.
    worldName: str(struct(props.SaveData).WorldName) || undefined,
    inGameDay: int(struct(props.SaveData).InGameDay),
  }
}

/**
 * The `DateTime` struct's tick count.
 *
 * A `DateTime` is a single `UInt64` and the reader hands it back as the struct's
 * value directly rather than as a named field, so this reads the number off
 * whichever of the two shapes it arrives in instead of assuming one.
 */
function ticksOf(node: Node): number | undefined {
  const v = node?.value
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  const inner = (v as { ticks?: unknown } | undefined)?.ticks
  return typeof inner === 'number' && inner > 0 ? inner : undefined
}
