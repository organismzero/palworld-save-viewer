/**
 * Turns a parse failure into something a person can act on.
 *
 * A reader's own error — "worldSaveData is missing" — is true, useless, and
 * looks like the app is broken rather than like the file is the wrong one.
 * Every message here names what probably happened and what to do about it —
 * the acceptance bar for a corrupted save is a useful message, not a stack
 * trace and not a white screen.
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

  // A player save picked as the world: dropped alone with an unusual name, or
  // renamed so it no longer carries its player's UID.
  if (/worldSaveData is missing/.test(raw)) {
    return {
      message: `${name} is a Palworld save but not a world. Drop the world’s Level.sav first, then add the Players folder.`,
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
