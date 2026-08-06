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
  it('names the file so a multi-file drop says which one failed', () => {
    const { message } = explainParseError(
      new SyntaxError('Unexpected token < in JSON at position 0'),
      'Level.json',
    )
    expect(message).toContain('Level.json')
  })

  it('recognises truncated or non-JSON input and says how to fix it', () => {
    for (const raw of [
      // The three engines word this differently on purpose.
      'Unexpected token < in JSON at position 0',
      'JSON.parse: unexpected character at line 1 column 1',
      'Unexpected end of JSON input',
    ]) {
      const { message, detail } = explainParseError(new SyntaxError(raw))
      expect(message).toMatch(/not valid JSON/i)
      expect(message).toMatch(/convert/i)
      // The original is always kept for a bug report.
      expect(detail).toBe(raw)
    }
  })

  it('tells someone who dropped a level-shaped file that is not one', () => {
    const { message } = explainParseError(
      new Error(
        'This does not look like a Palworld Level save: properties.worldSaveData is missing.',
      ),
    )
    expect(message).toMatch(/not a Palworld level save/i)
    // The most likely thing they actually dropped.
    expect(message).toMatch(/player save/i)
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
