/**
 * Parse-failure messages.
 *
 * The acceptance bar for a corrupted save is "a useful message, not a white
 * screen", and "useful" means naming the likely cause and the fix. These tests
 * assert on that content, because a regression here is silent — the app still
 * works, it just stops helping.
 */

import { describe, expect, it } from 'vitest'

import { explainParseError } from '@/parse/explain.ts'

describe('explainParseError', () => {
  it('tells someone who dropped a player save as the world what to do', () => {
    const raw =
      'This does not look like a Palworld Level save: properties.worldSaveData is missing.'
    const { message, detail } = explainParseError(new Error(raw), 'Odd.sav')
    // Names the file, so a multi-file drop says which one failed.
    expect(message).toContain('Odd.sav')
    expect(message).toMatch(/not a world/i)
    expect(message).toMatch(/Level\.sav/)
    // The original is always kept for a bug report.
    expect(detail).toBe(raw)
  })

  it('explains an out-of-memory failure rather than echoing it', () => {
    const { message } = explainParseError(
      new RangeError('Array buffer allocation failed'),
    )
    expect(message).toMatch(/too large/i)
    expect(message).not.toMatch(/Array buffer/)
  })

  it('passes an unrecognised error through unchanged', () => {
    // Inventing an explanation for an error we do not understand would be
    // worse than showing the real one.
    const { message } = explainParseError(new Error('worker failed'))
    expect(message).toBe('worker failed')
  })

  it('handles a thrown non-Error', () => {
    expect(explainParseError('something odd').message).toBe('something odd')
  })
})
