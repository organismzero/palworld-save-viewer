import { describe, expect, it, vi } from 'vitest'

import {
  JSON_REFUSED,
  filenameUidOf,
  looksLikeDpsName,
  chooseWorld,
  notePath,
  partition,
  sniff,
} from '@/parse/sniff.ts'

/**
 * A File-like whose reads are observable, so each test can prove that
 * classification never touched the bytes. That matters most for the DPS file:
 * the real one can run to hundreds of megabytes, and reading it is not a slow
 * path, it is a dead tab.
 */
function fakeFile(name: string, size = 1_000) {
  const file = {
    name,
    size,
    slice: vi.fn(() => ({ text: vi.fn(async () => '') })),
    arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
  } as unknown as File
  return { file }
}

describe('sniff', () => {
  it('classifies a .sav on its name alone, without a read', () => {
    // It is a Palworld save; which one is decided by the caller from the name
    // and by the worker from the contents.
    const { file } = fakeFile('Level.sav', 861_566)
    const result = sniff(file)
    expect(result.kind).toBe('sav')
    expect(result.reason).toBeUndefined()
    expect(file.slice).not.toHaveBeenCalled()
    expect(file.arrayBuffer).not.toHaveBeenCalled()
  })

  it('short-circuits a _dps file before reading a single byte', () => {
    // The guard that stops a huge read. If this regresses, the failure looks
    // like an out-of-memory crash somewhere else entirely.
    const { file } = fakeFile(
      'D4C3B2A1000000000000000000000000_dps.sav',
      244_000_000,
    )
    const result = sniff(file)
    expect(result.kind).toBe('dps')
    expect(file.slice).not.toHaveBeenCalled()
    expect(file.arrayBuffer).not.toHaveBeenCalled()
  })

  it('classifies LocalData.sav by name, without a read', () => {
    // A `.sav` is compressed, so there is nothing to sniff without decoding
    // it; the name is all there is at this stage. The worker checks the
    // contents once it has them.
    const { file } = fakeFile('LocalData.sav', 68_276)
    const result = sniff(file)
    expect(result.kind).toBe('local')
    expect(result.reason).toBeUndefined()
    expect(file.slice).not.toHaveBeenCalled()
  })

  it('classifies LevelMeta.sav by name, without reading it', () => {
    // Must not fall through to the generic `.sav` branch: `acceptSavs` treats
    // every non-UID-named `.sav` as a level candidate and hands everything but
    // the largest to the player reader, which used to blame this file for having
    // no PlayerUId.
    const { file } = fakeFile('LevelMeta.sav', 1_931)
    const result = sniff(file)
    expect(result.kind).toBe('levelmeta')
    expect(result.reason).toBeUndefined()
    expect(file.slice).not.toHaveBeenCalled()
  })

  it('refuses a converted .json and says to drop the .sav instead', () => {
    // The one wrong file people are likely to try, from the days this app
    // read converter output. Every shape of it gets the same answer.
    for (const name of [
      'Level.json',
      'LocalData.json',
      'LevelMeta.json',
      'FA02FA02FA024FFF8FFFFA02FA02FA02.json',
    ]) {
      const { file } = fakeFile(name)
      const result = sniff(file)
      expect(result.kind).toBe('unknown')
      expect(result.reason).toBe(JSON_REFUSED)
      expect(file.slice).not.toHaveBeenCalled()
    }
    expect(JSON_REFUSED).toMatch(/\.sav/)
  })

  it('refuses an unrelated file without reading it', () => {
    const { file } = fakeFile('notes.txt')
    const result = sniff(file)
    expect(result.kind).toBe('unknown')
    expect(result.reason).toMatch(/\.sav/)
    expect(file.slice).not.toHaveBeenCalled()
  })

  it('reads a player uid from a .sav filename', () => {
    // This is the only thing separating a player .sav from a level .sav before
    // decompressing one: size cannot, because a compressed level save is under
    // a few megabytes and smaller than any cap that admits a real player file.
    expect(filenameUidOf('FA02FA02FA024FFF8FFFFA02FA02FA02.sav')).toBe(
      'fa02fa02fa024fff8ffffa02fa02fa02',
    )
    expect(filenameUidOf('Level.sav')).toBeUndefined()
    // A converted file no longer names a player.
    expect(
      filenameUidOf('FA02FA02FA024FFF8FFFFA02FA02FA02.json'),
    ).toBeUndefined()
    expect(looksLikeDpsName('X_dps.sav')).toBe(true)
  })
})

describe('partition', () => {
  it('ignores the _dps.sav that comes with every real Players folder', () => {
    // The regression: `<uid>_dps.sav` matches the player-save filename pattern,
    // so below the generic `.sav` branch it was classified as a raw save, passed
    // the "named player save" filter and reached the player reader — which
    // rejected it, putting a permanent, unactionable rejection in the ledger.
    // Made up, and it has to be: this line held a real player UID copied
    // straight out of `data/Players/` until `leak.golden.test.ts` was run
    // against it. Any 32 hex digits exercise the filename pattern equally well.
    const uid = '0BADC0DE000000000000000000000000'
    const result = partition([
      fakeFile('Level.sav', 861_566).file,
      fakeFile(`${uid}.sav`, 120_000).file,
      fakeFile(`${uid}_dps.sav`, 244_000_000).file,
    ])

    expect(result.savs.map((s) => s.file.name)).toEqual([
      'Level.sav',
      `${uid}.sav`,
    ])
    expect(result.storage.map((r) => r.file.name)).toEqual([`${uid}_dps.sav`])
    expect(result.rejected).toEqual([])
  })

  it('takes a storage file dropped on its own, without calling it a level', () => {
    // Named after a player and possibly larger than the world, so it must never
    // reach the "largest .sav is the level" heuristic.
    const result = partition([fakeFile('B_dps.sav', 244_000_000).file])
    expect(result.savs).toEqual([])
    expect(result.rejected).toEqual([])
    expect(result.storage).toHaveLength(1)
  })

  it('keeps LevelMeta out of the raw-sav bucket entirely', () => {
    // The regression this guards is what a real world folder drop used to do:
    // both `Level.sav` and `LevelMeta.sav` are unnamed `.sav`s, so `acceptSavs`
    // sorted them by size, took the largest as the level, and queued the other
    // as a player save.
    const result = partition([
      fakeFile('Level.sav', 861_566).file,
      fakeFile('LevelMeta.sav', 1_931).file,
    ])

    expect(result.levelMeta?.file.name).toBe('LevelMeta.sav')
    expect(result.savs.map((s) => s.file.name)).toEqual(['Level.sav'])
    expect(result.rejected).toEqual([])
  })

  it('tells a level .sav apart from player .sav files by name', () => {
    // A folder of raw saves: exactly one is the world, the rest are players.
    // Picking "the largest" alone would work here but breaks the moment a
    // player file is bigger than a small world, so the name decides.
    const result = partition([
      fakeFile('Level.sav', 861_566).file,
      fakeFile('FA02FA02FA024FFF8FFFFA02FA02FA02.sav', 8_198).file,
      fakeFile('AB02FA02FA024FFF8FFFFA02FA02FA0C.sav', 9_293).file,
    ])

    expect(result.savs).toHaveLength(3)
    expect(
      result.savs.filter((s) => s.filenameUid).map((s) => s.file.name),
    ).toEqual([
      'FA02FA02FA024FFF8FFFFA02FA02FA02.sav',
      'AB02FA02FA024FFF8FFFFA02FA02FA0C.sav',
    ])
    expect(
      result.savs.find((s) => s.file.name === 'Level.sav')?.filenameUid,
    ).toBeUndefined()
  })

  it('keeps LocalData.sav out of the raw-save bucket', () => {
    // This is the bug the `local` bucket exists to prevent. `acceptSavs`
    // treats the largest unnamed `.sav` as the level and hands the rest to the
    // player-save reader — which does *not* reject a LocalData, because it has
    // a `SaveData` of its own, and would produce a junk player record.
    const result = partition([
      fakeFile('Level.sav', 861_566).file,
      fakeFile('LocalData.sav', 68_276).file,
    ])

    expect(result.savs.map((s) => s.file.name)).toEqual(['Level.sav'])
    expect(result.local?.file.name).toBe('LocalData.sav')
    expect(result.rejected).toEqual([])
  })

  it('rejects a converted .json that arrives with the real saves', () => {
    // A folder that still holds old converter output alongside the saves: the
    // .sav files are used, and the .json is named as the one that was not.
    const result = partition([
      fakeFile('Level.sav', 861_566).file,
      fakeFile('Level.json', 74_000_000).file,
    ])

    expect(result.savs.map((s) => s.file.name)).toEqual(['Level.sav'])
    expect(result.rejected.map((r) => r.file.name)).toEqual(['Level.json'])
    expect(result.rejected[0]?.reason).toBe(JSON_REFUSED)
  })

  it('reports a .sav-only drop as a save, not as nothing usable', () => {
    const result = partition([fakeFile('Level.sav', 861_566).file])
    expect(result.savs).toHaveLength(1)
    expect(result.rejected).toEqual([])
  })
})

describe('the server settings file', () => {
  it('is recognised by name, in any case, and never read', () => {
    const { file } = fakeFile('palworldsettings.INI', 3_500)
    expect(sniff(file).kind).toBe('settings')
    expect(file.arrayBuffer).not.toHaveBeenCalled()
  })

  it('is kept apart from the saves, one per drop', () => {
    const result = partition([
      fakeFile('Level.sav', 861_566).file,
      fakeFile('PalWorldSettings.ini').file,
      fakeFile('PalWorldSettings.ini').file,
    ])
    expect(result.savs.map((s) => s.file.name)).toEqual(['Level.sav'])
    expect(result.settings?.file.name).toBe('PalWorldSettings.ini')
    // The second of two is surplus, and says so by being turned away.
    expect(result.rejected).toHaveLength(1)
  })

  it('turns away the template of defaults, and says which file is wanted', () => {
    const got = sniff(fakeFile('DefaultPalWorldSettings.ini').file)
    expect(got.kind).toBe('unknown')
    expect(got.reason).toMatch(/template/)
    expect(got.reason).toMatch(/PalWorldSettings\.ini/)
  })

  it('turns away any other .ini by name', () => {
    const got = sniff(fakeFile('GameUserSettings.ini').file)
    expect(got.kind).toBe('unknown')
    expect(got.reason).toMatch(/only \.ini/i)
  })
})

/* -------------------------------------------------------------------------
   Which save in a folder is the world
   ------------------------------------------------------------------------- */

describe('chooseWorld', () => {
  const UID_A = 'A'.repeat(32)
  const UID_B = 'B'.repeat(32)

  /** A file as it would arrive from a dropped folder. */
  function at(path: string, size = 1_000) {
    const { file } = fakeFile(path.split('/').at(-1)!, size)
    notePath(file, `/${path}`)
    return sniff(file)
  }
  const split = (all: ReturnType<typeof sniff>[]) =>
    chooseWorld(
      all.filter((s) => s.kind === 'sav'),
      all.filter((s) => s.kind === 'dps'),
    )
  const paths = (of: ReturnType<typeof sniff>[]) =>
    of.map((s) => s.file).map((f) => `${f.name}:${f.size}`).sort() // prettier-ignore

  it('takes the level nearest the top, not the largest', () => {
    // The live save, and an older, larger autosave of the same world.
    const live = at('World/Level.sav', 2_000)
    const backup = at('World/backup/world/2026.08.11-15.31.41/Level.sav', 9_000)
    const got = split([backup, live])
    expect(got.level).toBe(live)
    expect(got.ignored).toEqual([backup])
    // And the other level is not handed on to be read as a player.
    expect(got.players).toEqual([])
  })

  it('keeps one copy of each player file: the one beside that level', () => {
    const got = split([
      at(`World/backup/world/one/Players/${UID_A}.sav`, 1),
      at('World/Level.sav'),
      at(`World/Players/${UID_A}.sav`, 2),
      at(`World/Players/${UID_A}_dps.sav`, 3),
      at(`World/backup/world/two/Players/${UID_A}.sav`, 4),
      at(`World/backup/world/one/Players/${UID_A}_dps.sav`, 5),
      at('World/backup/world/one/Level.sav'),
    ])
    expect(paths(got.players)).toEqual([`${UID_A}.sav:2`, `${UID_A}_dps.sav:3`])
    expect(got.ignored).toHaveLength(4)
  })

  it('keeps a player who is only in a backup, for the reader to judge', () => {
    // Whether they are in this world is the worker's call, from the contents.
    const got = split([
      at('World/Level.sav'),
      at(`World/backup/world/one/Players/${UID_B}.sav`),
    ])
    expect(got.players).toHaveLength(1)
    expect(got.ignored).toEqual([])
  })

  it('goes by name, then size, when nothing was in a folder', () => {
    const level = sniff(fakeFile('Level.sav', 10).file)
    const other = sniff(fakeFile('Renamed.sav', 99).file)
    const player = sniff(fakeFile(`${UID_A}.sav`, 500).file)
    const got = chooseWorld([other, player, level], [])
    expect(got.level).toBe(level)
    expect(got.players).toEqual([player])
    expect(got.ignored).toEqual([other])

    const big = sniff(fakeFile('World-copy.sav', 99).file)
    const small = sniff(fakeFile('Another.sav', 10).file)
    expect(chooseWorld([small, big], []).level).toBe(big)
  })
})

describe('partition — sidecar files in a folder with backups', () => {
  it('keeps the LevelMeta nearest the top', () => {
    const file = (path: string, size: number) => {
      const { file } = fakeFile('LevelMeta.sav', size)
      notePath(file, `/${path}`)
      return file
    }
    const backup = file('World/backup/world/one/LevelMeta.sav', 1)
    const live = file('World/LevelMeta.sav', 2)
    const got = partition([backup, live])
    expect(got.levelMeta?.file).toBe(live)
    expect(got.rejected.map((s) => s.file)).toEqual([backup])
  })
})
