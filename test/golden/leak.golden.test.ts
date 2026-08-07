/**
 * Guards every committed test file against containing real save data.
 *
 * This exists because the ad-hoc version of this check failed three times, in
 * three different ways:
 *
 * 1. A guild's `group_name` is its admin's player UID with the hyphens
 *    stripped and upper-cased. A GUID pattern that required hyphens walked
 *    straight past it and a real UID was committed.
 * 2. A "synthetic" hand-written fixture had a real player UID copied into it,
 *    and the pre-commit scan missed it because that scan only looked for the
 *    *unhyphenated* form.
 * 3. Even this file, once it existed, missed two real player UIDs sitting in a
 *    doc comment and a test filename — `\b` cannot match a UID followed by
 *    `_dps`, and the corpus was never normalised to compare against a bare
 *    match. Names were not checked at all. See {@link BARE} and the note in
 *    the matching loop.
 *
 * `scripts/make-fixture.ts` has its own `verifyRedaction` gate, but that only
 * covers files it generates. Anything hand-written bypasses it entirely — and
 * hand-written fixtures are exactly where a copied-from-real-data identifier
 * ends up. So this checks the committed tree against the actual save instead
 * of against a list of patterns someone thought of in advance.
 *
 * Skips when `data/` is absent, so CI stays green; it is a local guard, which
 * is where the mistake gets made.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { looksLikeDpsName } from '@/parse/sniff.ts'

const ROOT = process.cwd()
const DATA = resolve(ROOT, 'data')
const hasData = existsSync(DATA)

/** Files whose contents get committed and must therefore stay clean. */
function committedTestFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx|json)$/.test(entry)) out.push(path)
    }
  }
  walk(resolve(ROOT, 'test'))
  return out
}

/**
 * The save corpus to check against. **Never reads `*_dps.json`** — the one in
 * the reference set is 244 MB and would blow the heap, and the failure would
 * look like something else entirely.
 *
 * `LocalData.sav` is deliberately absent, and adding it would buy nothing: the
 * only identifiers it carries are the pal instance ids in its party presets,
 * every one of which resolves against `Level.json` and is therefore already in
 * this corpus. Including it would mean an async Oodle decode for zero extra
 * coverage. If a future field in that file ever names something of its own,
 * that changes and it belongs here.
 */
function saveCorpus(): string {
  const parts: string[] = []
  const level = join(DATA, 'Level.json')
  if (existsSync(level)) parts.push(readFileSync(level, 'utf8'))

  const players = join(DATA, 'Players')
  if (existsSync(players)) {
    for (const f of readdirSync(players)) {
      if (!f.endsWith('.json') || looksLikeDpsName(f)) continue
      parts.push(readFileSync(join(players, f), 'utf8'))
    }
  }
  return parts.join('\n').toLowerCase()
}

const HYPHENATED =
  /(?<![0-9a-fA-F])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![0-9a-fA-F])/g
/**
 * Bounded by "not a hex digit", not by `\b`.
 *
 * `\b` is the obvious anchor and is the third way this check has been fooled.
 * A word boundary needs a *non-word* character on the far side, and `_` is a
 * word character — so a bare player UID followed by `_dps.json`, which is
 * exactly how Palworld names its per-player DPS files, slid straight past a
 * `\b`-anchored pattern.
 *
 * Dropping the anchor entirely is worse: base64 blobs are full of runs like
 * `AAAAAAAA…`, every character of which is also a hex digit, so an unanchored
 * pattern reports the padding in two unrelated files as a shared identifier.
 * A hex-aware boundary catches the `_` case without matching inside a longer
 * hex run.
 */
const BARE = /(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/g

/**
 * Blanks out base64 byte blobs before scanning.
 *
 * Base64 padding is a long run of `A`s, every character of which is also a hex
 * digit — so a 32-character window of it inside a `~b` field reads as an
 * identifier and matches the same padding in the real save. (No example is
 * spelled out here on purpose: this file is one of the files being scanned,
 * and a literal one fails its own check.) Filtering those by
 * character diversity instead was tried and rejected: **real player UIDs are
 * themselves low-entropy** — four meaningful bytes then zeros, five to eight
 * distinct characters against this blob's three — so any threshold wide enough
 * to clear the padding starts discarding exactly the identifiers that matter
 * most.
 *
 * Excluding the blobs by structure is narrow and safe instead. They are opaque
 * byte runs of four to twenty-eight bytes — trailing padding and custom-version
 * stamps — and no identifier this guard exists to catch has ever been written
 * by hand inside one.
 */
function withoutByteBlobs(text: string): string {
  return text.replace(/"~b"\s*:\s*"[^"]*"/g, '"~b":""')
}
/**
 * Catches things like `PsnAccountId`, which is an unquoted 19-digit integer.
 * The negative lookbehind keeps it off the digits after a decimal point —
 * otherwise the tail of a float like `-879.3872680664062` reads as a long int.
 */
const LONG_INT = /(?<![.\d])\d{15,}\b/g

/**
 * Numbers are only treated as identifying at platform-account-id scale.
 *
 * The distinction being drawn is *who* versus *when*. Clocks are not
 * identifying — .NET wall-clock ticks land around 6.4e17, in-game
 * `GameDateTimeTicks` around 2.7e14, and `make-fixture.ts` deliberately keeps
 * real ones so the last-seen ordering tests have something to sort. A
 * `PsnAccountId`, the thing this rule actually hunts, is an order of magnitude
 * larger: 1.7e18 and 8.4e18 in the reference saves.
 */
const ACCOUNT_ID_SCALE = 1e18
const isIdentifyingNumber = (s: string) =>
  !/^0+$/.test(s) && Number(s) >= ACCOUNT_ID_SCALE

/** Values that legitimately appear in both and identify nobody. */
const ALLOWED = new Set([
  '00000000-0000-0000-0000-000000000000',
  '0'.repeat(32),
])

/**
 * The other kind of identifier: names people chose.
 *
 * GUIDs are the obvious leak and were the first two to happen, but a guild
 * name or a gamertag identifies a real person just as well and pattern-based
 * scanning cannot recognise one — so these are lifted out of the save itself
 * and searched for literally. The temptation this closes is writing
 * `expect(guild.name).toBe('<their guild>')` in a golden test, which is a
 * natural thing to reach for and puts a real name in a public repository.
 *
 * Names shorter than four characters are skipped: they collide with ordinary
 * words in source code, and the false failures would train people to ignore
 * this test, which costs more than the marginal coverage is worth.
 */
const NAME_FIELDS = [
  /"player_name"\s*:\s*"([^"]{4,})"/gi,
  /"guild_name"\s*:\s*"([^"]{4,})"/gi,
  /"nickname"\s*:\s*\{[^{}]*"value"\s*:\s*"([^"]{4,})"/gi,
]

function realNames(corpusRaw: string): string[] {
  const names = new Set<string>()
  for (const re of NAME_FIELDS) {
    for (const m of corpusRaw.matchAll(re)) {
      const name = m[1]?.trim()
      if (name && name.length >= 4) names.add(name.toLowerCase())
    }
  }
  return [...names]
}

const bareOf = (s: string) => s.replace(/-/g, '').toLowerCase()

describe.skipIf(!hasData)('golden: committed tests leak no save data', () => {
  const corpus = saveCorpus()

  /**
   * The corpus with every hyphen removed, built once and only if needed.
   *
   * ~75 MB of string, so it is worth not making unless a candidate identifier
   * actually reaches the third check — but it is what lets a bare UID in a
   * test file be recognised against a save that writes it hyphenated.
   */
  let bareCorpusCache: string | undefined
  const bareCorpus = () => (bareCorpusCache ??= corpus.replace(/-/g, ''))

  const files = committedTestFiles()
  const names = realNames(corpus)

  it('finds files to check', () => {
    expect(files.length).toBeGreaterThan(0)
    expect(corpus.length).toBeGreaterThan(1000)
    // If this ever reads zero, the name check silently passes everything.
    expect(names.length).toBeGreaterThan(0)
  })

  it.each(files.map((f) => [f.replace(ROOT + '/', ''), f]))(
    '%s contains no identifier from the real save',
    (_name, path) => {
      const text = withoutByteBlobs(readFileSync(path, 'utf8'))
      const found = new Set<string>()

      for (const re of [HYPHENATED, BARE]) {
        for (const match of text.match(re) ?? []) {
          if (ALLOWED.has(match.toLowerCase())) continue
          // Both spellings of the match against both spellings of the corpus.
          //
          // Checking only one direction is the third historical miss: the old
          // code stripped hyphens from the match and searched a corpus that
          // still had them, so a *bare* UID pasted into a test — which is
          // exactly how Palworld names player files — matched nothing. The
          // save writes UIDs hyphenated in most places and bare in a few, and
          // a leak is a leak in either form.
          if (
            corpus.includes(match.toLowerCase()) ||
            corpus.includes(bareOf(match)) ||
            bareCorpus().includes(bareOf(match))
          ) {
            found.add(match)
          }
        }
      }

      for (const match of text.match(LONG_INT) ?? []) {
        if (!isIdentifyingNumber(match)) continue
        if (corpus.includes(match)) found.add(match)
      }

      const lower = text.toLowerCase()
      for (const name of names) {
        if (lower.includes(name)) found.add(name)
      }

      expect(
        [...found],
        `identifiers from data/ found in a committed file`,
      ).toEqual([])
    },
  )
})
