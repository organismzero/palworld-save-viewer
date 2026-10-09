/**
 * Projecting `characters.json`: the pals, and the people listed beside them.
 *
 * Invented rows in the upstream file's shape. The real file is fetched at
 * runtime and is not in this repository.
 */

import { describe, expect, it } from 'vitest'

import { speciesOf } from '@/domain/names.ts'
import { slimCharacters, type Refdata } from '@/refdata/refdata.ts'

type Row = Record<string, unknown>

const RAW: { pals: Row[]; npcs: Row[] } = {
  pals: [
    {
      name: 'Lamball',
      asset: 'SheepBall',
      icon: '/icons/pals/T_SheepBall_icon_normal.webp',
      stats: { hp: 70, shot_attack: 70, zukan_index: 1, element_type1: 'Normal' }, // prettier-ignore
      work_suitabilities: { Handcraft: 1, Mining: 0 },
    },
  ],
  npcs: [
    {
      name: 'Zoe',
      asset: 'GrassBoss',
      icon: '/icons/npcs/T_Human_GrassBoss_icon_normal.webp',
      stats: { hp: 100, shot_attack: 100 },
      work_suitabilities: { Handcraft: 3, Mining: 0 },
    },
    // A person filed under a pal's id must not replace the pal.
    { name: 'Impostor', asset: 'sheepball', icon: '/icons/npcs/x.webp' },
    // A rank, and the wanted criminal who is one of them by id only.
    { name: 'Syndicate Gunner', asset: 'Hunter_Rifle' },
    { name: 'Hawk', asset: 'BOSS_Hunter_Rifle' },
    // A wanted criminal with no rank and file behind them.
    { name: 'Urchin', asset: 'BOSS_Male_NinjaElite' },
  ],
}
RAW.pals.push(
  // Only ever written with the prefix: a boss's companion.
  { name: 'Panthalus (Boss)', asset: 'BOSS_KingWhale_otomo', icon: '/icons/pals/T_KingWhale_icon_normal.webp', stats: { hp: 1, shot_attack: 1, zukan_index: -1, element_type1: 'Water' }, work_suitabilities: {} }, // prettier-ignore
  { name: 'Lamball (Boss)', asset: 'BOSS_SheepBall', icon: '/icons/pals/T_SheepBall_icon_normal.webp', stats: { hp: 70, shot_attack: 70, zukan_index: -1, element_type1: 'Normal' }, work_suitabilities: {} }, // prettier-ignore
  { name: 'Tetroise ', asset: 'CubeTurtle', icon: '/icons/pals/x.webp', stats: { hp: 1, shot_attack: 1, zukan_index: 9, element_type1: 'Water' }, work_suitabilities: {} }, // prettier-ignore
)

describe('slimCharacters', () => {
  const species = slimCharacters(RAW, undefined, undefined)

  it('names a captured human, who is listed apart from the pals', () => {
    // Without the `npcs` list a caught Zoe is shown as `GrassBoss`.
    expect(species.grassboss).toMatchObject({
      name: 'Zoe',
      icon: '/icons/npcs/T_Human_GrassBoss_icon_normal.webp',
      work: { Handcraft: 3 },
      human: true,
    })
  })

  it('gives a human nothing that would put them in a list of species', () => {
    // No paldex number and no element: those are what the pickers go by.
    expect(species.grassboss!.zukan).toBeUndefined()
    expect(species.grassboss!.element1).toBeUndefined()
  })

  it('keeps the pal when a person shares its id', () => {
    expect(species.sheepball!.name).toBe('Lamball')
    expect(species.sheepball!.human).toBeUndefined()
  })
})

describe('slimCharacters — rows that exist only as a boss', () => {
  const species = slimCharacters(RAW, undefined, undefined)

  it('answers to the plain id too, without the suffix', () => {
    // The reader strips `BOSS_`, so this is the id a save's pal asks under.
    expect(species.kingwhale_otomo).toMatchObject({
      name: 'Panthalus',
      element1: 'Water',
    })
    expect(species.male_ninjaelite?.name).toBe('Urchin')
  })

  it('leaves a species that has a plain row alone', () => {
    expect(species.sheepball!.name).toBe('Lamball')
    expect(species.hunter_rifle!.name).toBe('Syndicate Gunner')
  })

  it('trims a name', () => {
    expect(species.cubeturtle!.name).toBe('Tetroise')
  })
})

describe('speciesOf', () => {
  const data = {
    species: slimCharacters(RAW, undefined, undefined),
  } as unknown as Refdata
  const pal = (characterId: string, isBoss = false) => ({ characterId, isBoss })

  it('reads an alpha as its species', () => {
    expect(speciesOf(data, pal('SheepBall', true))?.name).toBe('Lamball')
  })

  it('reads a boss who is a person as that person', () => {
    // `BOSS_Hunter_Rifle` is Hawk, not an especially large Syndicate Gunner.
    expect(speciesOf(data, pal('Hunter_Rifle', true))?.name).toBe('Hawk')
    expect(speciesOf(data, pal('Hunter_Rifle'))?.name).toBe('Syndicate Gunner')
  })

  it('finds a boss who has no plain row', () => {
    expect(speciesOf(data, pal('Male_NinjaElite', true))?.name).toBe('Urchin')
    expect(speciesOf(data, pal('KingWhale_otomo', true))?.name).toBe('Panthalus') // prettier-ignore
  })

  it('answers nothing for an id it has never heard of, or with no data', () => {
    expect(speciesOf(data, pal('Nobody'))).toBeUndefined()
    expect(speciesOf(undefined, pal('SheepBall'))).toBeUndefined()
  })
})

describe('slimCharacters — an icon path upstream misspells', () => {
  it('points Rayhound Cryst at the file that exists', () => {
    // The CDN is case-sensitive: `Thunderdog` is a 404, `ThunderDog` is the art.
    const species = slimCharacters(
      {
        pals: [
          {
            name: 'Rayhound Cryst',
            asset: 'ThunderDog_Ice',
            icon: '/icons/pals/T_Thunderdog_Ice_icon_normal.webp',
          },
        ],
      },
      undefined,
      undefined,
    )
    expect(species.thunderdog_ice!.icon).toBe(
      '/icons/pals/T_ThunderDog_Ice_icon_normal.webp',
    )
  })
})
