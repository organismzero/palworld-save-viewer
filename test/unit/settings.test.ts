/**
 * Reading `PalWorldSettings.ini`.
 *
 * Every value here is invented. The real file holds a server's passwords and
 * address, which is the whole reason the parser drops them.
 */

import { describe, expect, it } from 'vitest'

import { SETTINGS_SECTION, parseWorldSettings } from '@/parse/settings.ts'
import {
  changedRates,
  rateText,
  settingLabel,
  settingText,
} from '@/domain/worldSettings.ts'
import type { WorldSettings } from '@/domain/types.ts'

const file = (options: string) =>
  `${SETTINGS_SECTION}\nOptionSettings=(${options})\n`

function read(options: string): WorldSettings {
  const got = parseWorldSettings(file(options), 'PalWorldSettings.ini')
  if (!got.ok) throw new Error(got.reason)
  return got.settings
}

describe('parseWorldSettings', () => {
  it('reads numbers, booleans in either case, and bare words', () => {
    const s = read('ExpRate=1.500000,bIsPvP=False,bHardcore=true,DeathPenalty=Item,GuildPlayerMaxNum=20') // prettier-ignore
    expect(s.values).toEqual({
      ExpRate: 1.5,
      bIsPvP: false,
      bHardcore: true,
      DeathPenalty: 'Item',
      GuildPlayerMaxNum: 20,
    })
  })

  it('keeps a quoted comma and a bracketed list as one value each', () => {
    const s = read('ServerDescription="one, two",CrossplayPlatforms=(Steam,Xbox),ExpRate=2') // prettier-ignore
    expect(s.values).toEqual({
      ServerDescription: 'one, two',
      CrossplayPlatforms: '(Steam,Xbox)',
      ExpRate: 2,
    })
  })

  it('drops passwords, addresses and ports unread, and says which', () => {
    const s = read(
      'AdminPassword="hunter2",ServerPassword="open sesame",PublicIP="203.0.113.7",PublicPort=8211,RCONEnabled=True,RCONPort=25575,RESTAPIEnabled=True,RESTAPIPort=8212,BanListURL="https://example.invalid/bans.txt",ExpRate=1', // prettier-ignore
    )
    expect(s.values).toEqual({ ExpRate: 1 })
    expect(s.withheld).toEqual([
      'AdminPassword',
      'ServerPassword',
      'PublicIP',
      'PublicPort',
      'RCONEnabled',
      'RCONPort',
      'RESTAPIEnabled',
      'RESTAPIPort',
      'BanListURL',
    ])
    // Not in the result under any name.
    const everything = JSON.stringify(s)
    for (const secret of [
      'hunter2',
      'open sesame',
      '203.0.113.7',
      '25575',
      'example.invalid',
    ]) {
      expect(everything).not.toContain(secret)
    }
  })

  it('drops a secret it has never seen, by the shape of its name', () => {
    const s = read('WebhookToken=abc,SomeNewPassword=xyz,QueryPort=1,ExpRate=1')
    expect(Object.keys(s.values)).toEqual(['ExpRate'])
  })

  it('does not mistake a setting that merely ends like a secret', () => {
    // "Export" and "Import" end in "port".
    const s = read('bAllowGlobalPalboxExport=false,bAllowGlobalPalboxImport=true,QueryPort=27015') // prettier-ignore
    expect(s.values).toEqual({
      bAllowGlobalPalboxExport: false,
      bAllowGlobalPalboxImport: true,
    })
    expect(s.withheld).toEqual(['QueryPort'])
  })

  it('keeps a setting it has never seen, as written', () => {
    expect(read('BrandNewThing=Sideways').values).toEqual({ BrandNewThing: 'Sideways' }) // prettier-ignore
  })

  it('leaves an empty value empty and odd numerics as text', () => {
    expect(read('RandomizerSeed=,Version=1.2.3').values).toEqual({
      RandomizerSeed: '',
      Version: '1.2.3',
    })
  })

  it('reads through a byte-order mark and Windows line endings', () => {
    const text = `\uFEFF${SETTINGS_SECTION}\r\nOptionSettings=(ExpRate=3)\r\n`
    const got = parseWorldSettings(text, 'x.ini')
    expect(got.ok && got.settings.values).toEqual({ ExpRate: 3 })
  })

  it('stops at the bracket that closes the line', () => {
    const got = parseWorldSettings(
      `${SETTINGS_SECTION}\nOptionSettings=(ExpRate=2)\n[Other]\nExpRate=9\n`,
      'x.ini',
    )
    expect(got.ok && got.settings.values).toEqual({ ExpRate: 2 })
  })

  it('says why for a file that is not one, is empty, or has no settings', () => {
    const not = parseWorldSettings('[Core.System]\nPaths=x', 'Engine.ini')
    expect(not).toMatchObject({ ok: false })
    expect(!not.ok && not.reason).toMatch(/Not a PalWorldSettings/)

    const empty = parseWorldSettings('  \n', 'PalWorldSettings.ini')
    expect(!empty.ok && empty.reason).toMatch(/defaults/)

    const bare = parseWorldSettings(
      `${SETTINGS_SECTION}\n`,
      'PalWorldSettings.ini',
    )
    expect(!bare.ok && bare.reason).toMatch(/no OptionSettings/)
  })
})

describe('reading the settings', () => {
  it('calls a multiplier changed when it is not 1, furthest first', () => {
    const s = read('ExpRate=1.5,PalCaptureRate=1,WorkSpeedRate=0.25,PalDamageRateAttack=2,ItemCorruptionMultiplier=3,GuildPlayerMaxNum=20,PalEggDefaultHatchingTime=72') // prettier-ignore
    expect(changedRates(s).map((r) => [r.key, r.value])).toEqual([
      // ×0.25 is as far from 1 as ×4, so it leads.
      ['WorkSpeedRate', 0.25],
      ['ItemCorruptionMultiplier', 3],
      ['PalDamageRateAttack', 2],
      ['ExpRate', 1.5],
    ])
  })

  it('does not judge what is not a multiplier', () => {
    // A cap and a duration are not rates, whatever their value.
    expect(changedRates(read('GuildPlayerMaxNum=20,PalEggDefaultHatchingTime=72'))).toEqual([]) // prettier-ignore
  })

  it('names the settings people ask about and spells out the rest', () => {
    expect(settingLabel('ExpRate')).toBe('XP')
    expect(settingLabel('bEnableFastTravel')).toBe('enable fast travel')
    expect(settingLabel('DropItemMaxNum_UNKO')).toBe('drop item max num unko')
  })

  it('writes values the way a person would', () => {
    expect(rateText(1.5)).toBe('×1.5')
    expect(settingText('ExpRate', 2)).toBe('×2')
    expect(settingText('bIsPvP', false)).toBe('off')
    expect(settingText('PalEggDefaultHatchingTime', 72)).toBe('72 h')
    expect(settingText('GuildPlayerMaxNum', 20)).toBe('20')
    expect(settingText('RandomizerSeed', '')).toBe('—')
  })
})
