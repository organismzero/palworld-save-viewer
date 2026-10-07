import { describe, expect, it, vi } from 'vitest'

import {
  JSON_REFUSED,
  filenameUidOf,
  looksLikeDpsName,
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
    expect(result.ignored.map((r) => r.file.name)).toEqual([`${uid}_dps.sav`])
    expect(result.rejected).toEqual([])
  })

  it('still explains a DPS file dropped on its own', () => {
    // Ignoring it silently is right in a folder drop and wrong here: a drop
    // that changes nothing on screen reads as the app having failed.
    const result = partition([fakeFile('B_dps.sav', 244_000_000).file])
    expect(result.savs).toEqual([])
    expect(result.ignored[0]?.reason).toBe('DPS storage file.')
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
