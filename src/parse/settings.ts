/**
 * `PalWorldSettings.ini`: how a dedicated server is configured.
 *
 * A few kilobytes of text, so it is read on the main thread: no container, no
 * Oodle, no worker. The whole payload is one line,
 * `OptionSettings=(Key=Value,Key=Value,…)`, under a section header.
 *
 * ## What this file is not
 *
 * It is not part of the save. It lives in the server's config directory and
 * says how the server is set up *now*; nothing ties it to when the save was
 * written. An admin who doubled XP last week has a file that does not describe
 * most of the history in the world beside it. Everything that shows these
 * values has to say "server config", never "this world was played at".
 *
 * ## What is thrown away, on purpose
 *
 * The same line that holds the XP rate holds the admin password, the server
 * password, the public address and the remote-console port. None of those is
 * needed to read a save, and this app keeps what it parses: in memory, and in
 * browser storage if the user asked for the save to be remembered. So they are
 * dropped here, before anything else sees them, and only their *names* are
 * kept, to say that they were. A value that is never held cannot be shown,
 * stored, exported or screenshotted by mistake.
 *
 * Unknown keys are kept, as raw text: a game update that adds a setting should
 * show up, not vanish. The cost is that a future secret under a name this does
 * not recognise would be kept too, which is why the pattern below is broad.
 */

import type { WorldSettings, WorldSettingValue } from '../domain/types.ts'

/** The section every real file starts with, and the check that this is one. */
export const SETTINGS_SECTION = '[/Script/Pal.PalGameWorldSettings]'

/**
 * Keys whose values are never kept.
 *
 * By pattern, not by list, so a new `SomethingPassword` or `FooPort` is caught
 * without anyone having to notice it was added.
 */
const SECRET = /password|token|secret|apikey|publicip|rcon|restapi/i
/**
 * The two that have to mind their case: `PublicPort` and `BanListURL` are
 * secrets, `bAllowGlobalPalboxExport` ends in "port" and is not.
 */
const SECRET_SUFFIX = /(Port|URL|Url)$/

export type SettingsResult =
  { ok: true; settings: WorldSettings } | { ok: false; reason: string }

export function parseWorldSettings(
  text: string,
  fileName: string,
): SettingsResult {
  // A byte-order mark, which Windows editors add and `File.text()` keeps.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  if (!body.includes(SETTINGS_SECTION)) {
    return {
      ok: false,
      reason: body.trim()
        ? `Not a PalWorldSettings.ini: it has no ${SETTINGS_SECTION} section.`
        : 'This file is empty, which is how a server that uses the game’s defaults for everything keeps it. There is nothing in it to read.',
    }
  }

  const start = body.indexOf('OptionSettings=(')
  if (start === -1) {
    return {
      ok: false,
      reason:
        'The settings section is there but holds no OptionSettings line, so the server is on the game’s defaults.',
    }
  }

  const values: Record<string, WorldSettingValue> = {}
  const withheld: string[] = []
  for (const pair of splitTopLevel(body, start + 'OptionSettings=('.length)) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const key = pair.slice(0, eq).trim()
    if (SECRET.test(key) || SECRET_SUFFIX.test(key)) {
      withheld.push(key)
      continue
    }
    values[key] = coerce(pair.slice(eq + 1).trim())
  }

  return { ok: true, settings: { fileName, values, withheld } }
}

/**
 * The `Key=Value` pairs between the opening bracket at `from` and its match.
 *
 * Split on commas that are outside quotes and outside nested brackets: a
 * server description can hold a comma, and `CrossplayPlatforms=(Steam,Xbox)`
 * is one value, not two.
 */
function splitTopLevel(text: string, from: number): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let cur = ''
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"') quoted = !quoted
    if (!quoted) {
      if (ch === '(') depth++
      else if (ch === ')') {
        // The bracket that closes `OptionSettings=(`.
        if (depth === 0) break
        depth--
      } else if (ch === ',' && depth === 0) {
        out.push(cur)
        cur = ''
        continue
      }
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

function coerce(raw: string): WorldSettingValue {
  if (/^true$/i.test(raw)) return true
  if (/^false$/i.test(raw)) return false
  // A plain decimal. Anything else that looks numeric (a seed, a version) is
  // left as the text it was written as.
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1)
  }
  return raw
}
