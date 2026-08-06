/**
 * Pal hover text.
 *
 * The degraded path matters as much as the happy one here: this text appears in
 * the summary view, which deliberately has no reference data at all, so it has
 * to stay useful when every lookup returns nothing.
 */

import { describe, expect, it } from 'vitest'

import { palName, palTooltip } from '@/domain/palText.ts'
import type { Pal } from '@/domain/types.ts'

function pal(overrides: Partial<Pal> = {}): Pal {
  return {
    instanceId: 'a'.repeat(32),
    characterId: 'Kitsunebi',
    isBoss: false,
    isRare: false,
    level: 24,
    exp: 0,
    rank: 0,
    rankAttack: 0,
    rankDefence: 0,
    rankHp: 0,
    rankCraftSpeed: 0,
    passives: [],
    equipWaza: [],
    masteredWaza: [],
    workSuitabilityBonus: {},
    oldOwnerUids: [],
    ...overrides,
  }
}

const SPECIES = { name: 'Foxparks', element1: 'Fire' }

describe('palName', () => {
  it('prefers the nickname, then the species, then the raw id', () => {
    expect(palName(pal({ nickname: 'Sparky' }), SPECIES)).toBe('Sparky')
    expect(palName(pal(), SPECIES)).toBe('Foxparks')
    expect(palName(pal())).toBe('Kitsunebi')
  })
})

describe('palTooltip', () => {
  it('names the species alongside a nickname, and not twice without one', () => {
    expect(palTooltip(pal({ nickname: 'Sparky' }), SPECIES)).toContain(
      'Sparky · Foxparks',
    )
    // No nickname — repeating "Foxparks · Foxparks" would be noise.
    expect(palTooltip(pal(), SPECIES).split('\n')[0]).toBe('Foxparks')
  })

  it('always reports IVs, including the zeros', () => {
    // "0/300" is itself the answer to "is this one worth keeping", so it must
    // not be omitted the way genuinely absent fields are.
    const text = palTooltip(pal(), SPECIES)
    expect(text).toContain('IV 0/300')
    expect(text).toContain('hp 0, atk 0, def 0')

    const good = palTooltip(
      pal({ ivHp: 90, ivAttack: 80, ivDefense: 70 }),
      SPECIES,
    )
    expect(good).toContain('IV 240/300')
    expect(good).toContain('hp 90, atk 80, def 70')
  })

  it('flags alphas, rares and condenser rank', () => {
    const text = palTooltip(
      pal({ isBoss: true, isRare: true, rank: 3, gender: 'Female' }),
      SPECIES,
    )
    expect(text).toContain('alpha')
    expect(text).toContain('rare')
    expect(text).toContain('female')
    expect(text).toContain('condensed ★3')
  })

  it('omits absent detail rather than listing it as empty', () => {
    // A tooltip padded with "condensed —" and "sick —" is harder to scan than
    // a short one. (The em dash in the IV line is a separator, not a
    // placeholder, which is why this checks labels rather than punctuation.)
    const text = palTooltip(pal(), SPECIES)
    expect(text).not.toContain('condensed')
    expect(text).not.toContain('sick')
    // Name, traits, element, IVs — and nothing else for a plain pal.
    expect(text.split('\n')).toEqual([
      'Foxparks',
      'level 24',
      'Fire',
      'IV 0/300 — hp 0, atk 0, def 0',
    ])
  })

  it('resolves passive names and marks the detrimental ones', () => {
    const text = palTooltip(
      pal({ passives: ['Runner', 'PAL_ALLAttack_down1'] }),
      SPECIES,
      (a) =>
        a === 'Runner'
          ? { name: 'Runner', rank: 2 }
          : { name: 'Coward', rank: -1 },
    )
    expect(text).toContain('+ Runner')
    // Rank is what makes a passive good or bad, and the name alone hides it.
    expect(text).toContain('▾ Coward')
  })

  it('stays useful with no reference data at all', () => {
    // The summary view's case: raw asset ids everywhere, still legible.
    const text = palTooltip(pal({ level: 31, passives: ['Legend'] }))
    expect(text).toContain('Kitsunebi')
    expect(text).toContain('level 31')
    expect(text).toContain('IV 0/300')
    expect(text).toContain('+ Legend')
    // No element line rather than an empty one.
    expect(text).not.toContain('undefined')
  })

  it('shows both elements when a species has two', () => {
    const text = palTooltip(pal(), {
      name: 'Foxparks',
      element1: 'Fire',
      element2: 'Dark',
    })
    expect(text).toContain('Fire / Dark')
  })

  it('accepts the enum spelling the save uses', () => {
    // Elements arrive as `EPalElementType::Leaf` in some fields and `Leaf` in
    // others; both must resolve to the display name.
    expect(
      palTooltip(pal(), { name: 'X', element1: 'EPalElementType::Leaf' }),
    ).toContain('Grass')
  })
})
