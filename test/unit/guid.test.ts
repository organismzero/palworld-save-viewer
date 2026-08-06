import { describe, expect, it } from 'vitest'

import {
  ZERO_GUID,
  formatGuid,
  isZero,
  nonZero,
  normGuid,
  shortPlayerUid,
} from '@/parse/guid.ts'

describe('normGuid', () => {
  it('strips hyphens and lowercases', () => {
    expect(normGuid('FA06FA06-FA06-4FFF-8FFF-FA06FA06FA06')).toBe(
      'fa06fa06fa064fff8ffffa06fa06fa06',
    )
  })

  it('is idempotent', () => {
    const once = normGuid('FA06FA06-FA06-4FFF-8FFF-FA06FA06FA06')!
    expect(normGuid(once)).toBe(once)
  })

  it('rejects non-GUIDs rather than returning a bad key', () => {
    expect(normGuid('not-a-guid')).toBeUndefined()
    expect(normGuid('')).toBeUndefined()
    expect(normGuid(undefined)).toBeUndefined()
    expect(normGuid(null)).toBeUndefined()
    expect(normGuid(42)).toBeUndefined()
  })
})

describe('isZero / nonZero', () => {
  it('recognises the zero GUID in both spellings', () => {
    expect(isZero(ZERO_GUID)).toBe(true)
    expect(isZero(normGuid('00000000-0000-0000-0000-000000000000'))).toBe(true)
  })

  it('treats absent as zero', () => {
    expect(isZero(undefined)).toBe(true)
  })

  it('lets real GUIDs through', () => {
    const g = normGuid('fa06fa06-fa06-4fff-8fff-fa06fa06fa06')!
    expect(isZero(g)).toBe(false)
    expect(nonZero(g)).toBe(g)
  })

  it('drops zero GUIDs so they cannot become map keys', () => {
    // Unlocked chests, unowned containers and wild pals all carry zero GUIDs;
    // keying on them collapses every unowned thing into one bucket.
    expect(nonZero(ZERO_GUID)).toBeUndefined()
    expect(nonZero(undefined)).toBeUndefined()
  })
})

describe('display helpers', () => {
  it('restores hyphens', () => {
    expect(formatGuid('fa06fa06fa064fff8ffffa06fa06fa06')).toBe(
      'fa06fa06-fa06-4fff-8fff-fa06fa06fa06',
    )
  })

  it('passes through anything unexpected', () => {
    expect(formatGuid(undefined)).toBe('')
    expect(formatGuid('short')).toBe('short')
  })

  it('shortens player UIDs to their meaningful first four bytes', () => {
    expect(shortPlayerUid('fa02fa02fa024fff8ffffa02fa02fa02')).toBe('FA02FA02')
    expect(shortPlayerUid(undefined)).toBe('')
  })
})
