/**
 * Turns a parse failure into something a person can act on.
 *
 * A `JSON.parse` error reads "Unexpected token < in JSON at position 0", which
 * is true, useless, and looks like the app is broken rather than like the file
 * is the wrong one. Every message here names what probably happened and what
 * to do about it — the acceptance bar for a corrupted save is a useful message,
 * not a stack trace and not a white screen.
 *
 * The original text is always appended so a bug report still carries the real
 * error.
 */

export interface Explained {
  message: string
  /** The raw error, for the diagnostics panel and bug reports. */
  detail?: string
}

export function explainParseError(err: unknown, fileName?: string): Explained {
  const raw = err instanceof Error ? err.message : String(err)
  const name = fileName ? `“${fileName}”` : 'That file'

  // A `.sav` dropped straight in is the single most likely mistake, and the
  // one with the most useful answer.
  if (/^�|PlM|PlZ|CNK/.test(raw) || /GVAS/i.test(raw)) {
    return {
      message: `${name} looks like a raw .sav that was renamed to .json. Drop it with its original .sav extension and it will be decoded directly.`,
      detail: raw,
    }
  }

  if (isJsonSyntaxError(raw)) {
    return {
      message: `${name} is not valid JSON. A truncated file is the usual cause — if it came from a converter, run the conversion again. Raw .sav files can be dropped as-is.`,
      detail: raw,
    }
  }

  if (/worldSaveData is missing/.test(raw)) {
    return {
      message: `${name} is valid JSON but not a Palworld level save. A player save from the Players folder looks like this — drop Level.json first, then add the Players folder.`,
      detail: raw,
    }
  }

  if (
    /out of memory|Array buffer allocation failed|allocation size overflow/i.test(
      raw,
    )
  ) {
    return {
      message: `${name} is too large for this browser tab to hold. A very large server world can exceed what a 32-bit tab can allocate; a 64-bit browser with more memory available is the only fix.`,
      detail: raw,
    }
  }

  return { message: raw }
}

/**
 * Every engine words this differently — V8 says "Unexpected token", Spidermonkey
 * "JSON.parse: unexpected character", JSC "Unexpected identifier" — so this
 * matches on the shared vocabulary rather than on any one of them.
 */
function isJsonSyntaxError(raw: string): boolean {
  return (
    /JSON/i.test(raw) ||
    /Unexpected (token|end of|identifier|number|string|character)/i.test(raw)
  )
}
