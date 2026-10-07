/**
 * Partner-skill text: the game's markup rendered to prose, or refused.
 *
 * The refusals matter as much as the renderings. A hover card that says
 * "increases Attack by %" is worse than one that only names the skill.
 */

import { describe, expect, it } from 'vitest'

import { partnerSkillText, ranchDrops } from '@/refdata/gameText.ts'

const effects = (asset: string) =>
  ({
    Coop_1: { effect1: 10, effect2: 0 },
    Burn_1: { effect1: 25 },
    Switch_1: { effect1: 0 },
  })[asset]

describe('partnerSkillText', () => {
  it('renders element markup and fills a reference-passive value', () => {
    expect(
      partnerSkillText(
        "When activated, changes the player's attack type to [ICON:ElemIcon_Ground][ELEM:Earth] and increases Attack by {ReferencePassive1_EffectValue1}%.",
        [],
        ['Coop_1'],
        effects,
      ),
    ).toBe(
      "When activated, changes the player's attack type to Earth and increases Attack by 10%.",
    )
  })

  it('uses display names, not internal ones', () => {
    expect(partnerSkillText('Deals [ELEM:Leaf] damage.', [], [], effects)).toBe(
      'Deals Grass damage.',
    )
  })

  it('fills own-passive values by position and unwraps known effects', () => {
    expect(
      partnerSkillText(
        '[EFFECT:IvyCling] buildup by {Passive2_EffectValue1}.',
        ['Coop_1', 'Burn_1'],
        [],
        effects,
      ),
    ).toBe('Ivy Cling buildup by 25.')
  })

  it('normalises line endings', () => {
    expect(partnerSkillText('One.\r\nTwo.', [], [], effects)).toBe('One.\nTwo.')
  })

  it.each([
    [
      'a message the data does not carry',
      'Faster. {ReferenceMsgId_RideSpeedUp}',
    ],
    ['a rank-scaled value', 'Heals {ActiveSkillMainValueByRank}.'],
    ['a passive slot that is not there', 'Attack +{Passive3_EffectValue1}%.'],
    ['a zero value', 'Attack +{Passive1_EffectValue1}%.'],
    ['an unknown effect', 'Immune to [EFFECT:Sleepy].'],
    ['an unknown element', 'Deals [ELEM:Plasma] damage.'],
    ['an unknown tag', 'Look [SPARKLE:yes].'],
  ])('refuses text with %s', (_, raw) => {
    expect(partnerSkillText(raw, ['Switch_1'], [], effects)).toBeUndefined()
  })

  it('returns nothing for empty or non-string input', () => {
    expect(partnerSkillText('', [], [], effects)).toBeUndefined()
    expect(partnerSkillText(undefined, [], [], effects)).toBeUndefined()
  })
})

describe('ranchDrops', () => {
  const ITEMS = new Map([
    ['Milk', 'milk'],
    ['Egg', 'egg'],
    ['Eggplant', 'eggplant'],
    ['Gold Coin', 'money'],
    ['Cotton Candy', 'sweet'],
    ['Caramel Cotton Candy', 'sweet_caramel'],
    ['High Quality Cloth', 'cloth2'],
    ['Wool', 'wool'],
  ])
  const byLength = [...ITEMS.keys()].sort((a, b) => b.length - a.length)
  const drops = (text: string) => ranchDrops(text, ITEMS, byLength)

  it('reads each phrasing the data uses', () => {
    expect(drops('Sometimes drops Milk when assigned to Ranch.')).toEqual([
      'milk',
    ])
    expect(drops('Sometimes lays an Egg when assigned to Ranch.')).toEqual([
      'egg',
    ])
    expect(
      drops('Sometimes digs up Gold Coin when assigned to Ranch.'),
    ).toEqual(['money'])
    expect(
      drops('Sometimes makes High Quality Cloth when assigned to Ranch.'),
    ).toEqual(['cloth2'])
  })

  it('takes the longest name and never a name inside it', () => {
    expect(
      drops('Sometimes drops Caramel Cotton Candy when assigned to Ranch.'),
    ).toEqual(['sweet_caramel'])
    expect(
      drops('Sometimes drops Cotton Candy when assigned to Ranch.'),
    ).toEqual(['sweet'])
  })

  it('matches whole words only', () => {
    expect(drops('Sometimes drops Eggplant when assigned to Ranch.')).toEqual([
      'eggplant',
    ])
  })

  it('ignores sentences that are not about a Ranch', () => {
    expect(
      drops(
        'Can be ridden. While in party, finds more Wool. Sometimes drops Milk when assigned to Ranch.',
      ),
    ).toEqual(['milk'])
    expect(drops('Can be ridden.')).toEqual([])
    expect(drops(undefined as unknown as string)).toEqual([])
  })
})
