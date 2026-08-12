import { describe, expect, it, vi } from 'vitest'

import {
  MAX_PLAYER_BYTES,
  filenameUidOf,
  looksLikeDpsName,
  partition,
  sniff,
} from '@/parse/sniff.ts'

/**
 * Builds a File-like whose `slice().text()` is observable, so we can prove the
 * DPS short-circuit happens *before* any read. That matters: the real file is
 * 244 MB and reading it is not a slow path, it is a dead tab.
 */
function fakeFile(name: string, body: string, size = body.length) {
  const read = vi.fn(async () => body)
  const file = {
    name,
    size,
    slice: vi.fn(() => ({ text: read })),
  } as unknown as File
  return { file, read }
}

const LEVEL = '{"header":{},"properties":{"Version":1,"worldSaveData":{}}}'
const PLAYER =
  '{"header":{},"properties":{"Version":1,"SaveData":{"struct_type":"PalWorldPlayerSaveData"}}}'
const DPS = '{"header":{},"properties":{"SaveParameterArray":{}}}'
const LOCAL =
  '{"header":{},"properties":{"Version":100,"SaveData":{"struct_type":"PalLocalSaveData"}}}'
const LEVELMETA =
  '{"header":{},"properties":{"Version":100,"SaveData":{"struct_type":"PalWorldBaseInfoSaveData"}}}'

describe('sniff', () => {
  it('classifies a level save', async () => {
    const { file } = fakeFile('Level.json', LEVEL)
    expect((await sniff(file)).kind).toBe('level')
  })

  it('classifies a player save', async () => {
    const { file } = fakeFile('ABCDEF01.json', PLAYER)
    expect((await sniff(file)).kind).toBe('player')
  })

  it('short-circuits a _dps file before reading a single byte', async () => {
    // The guard that stops a 244 MB read. If this regresses, the failure looks
    // like an out-of-memory crash somewhere else entirely.
    const { file, read } = fakeFile(
      'D4C3B2A1000000000000000000000000_dps.json',
      DPS,
      244_000_000,
    )
    const result = await sniff(file)
    expect(result.kind).toBe('dps')
    expect(read).not.toHaveBeenCalled()
    expect(file.slice).not.toHaveBeenCalled()
  })

  it('still catches a _dps file that was renamed', async () => {
    // The name check is the cheap first stop, never the discriminator.
    const { file } = fakeFile('totally-normal.json', DPS)
    expect((await sniff(file)).kind).toBe('dps')
  })

  it('rejects a player-shaped file that is implausibly large', async () => {
    const { file } = fakeFile('big.json', PLAYER, MAX_PLAYER_BYTES + 1)
    const result = await sniff(file)
    expect(result.kind).toBe('unknown')
    expect(result.reason).toMatch(/too large/i)
  })

  it('does not size-cap a level save, which is legitimately huge', async () => {
    const { file } = fakeFile('Level.json', LEVEL, 74_000_000)
    expect((await sniff(file)).kind).toBe('level')
  })

  it('classifies a .sav as a save rather than rejecting it outright', async () => {
    // It *is* a Palworld save; whether this app can decompress it is decided
    // by its container header, which the caller reads. Lumping it in with
    // "unknown" here would throw away the chance to say which format it is.
    const { file } = fakeFile('Level.sav', '')
    const result = await sniff(file)
    expect(result.kind).toBe('sav')
    // No reason: nothing has gone wrong yet.
    expect(result.reason).toBeUndefined()
    // And the classification happens on the name alone, without a read.
    expect(file.slice).not.toHaveBeenCalled()
  })

  it('recognises a .sav renamed to .json and says to rename it back', async () => {
    // The container magic and the GVAS header both sit in the first 32 bytes,
    // so a prefix scan still sees them through the compression. Renaming is
    // the whole fix now that raw saves are decoded directly — the file only
    // needs its extension back, not a conversion.
    // Literal NULs, spelled out: the real header is binary, and invisible
    // control characters in a source file are their own kind of trap.
    const header = 'Mz\0r%\0PlM1\0\x006\0"hGVAS\0\0\0'
    const { file } = fakeFile('Level.json', header)
    const result = await sniff(file)
    expect(result.kind).toBe('unknown')
    expect(result.reason).toMatch(/raw \.sav/i)
    expect(result.reason).toMatch(/\.sav extension/)
  })

  it('says what a file was missing when it is not a save at all', async () => {
    const { file } = fakeFile('notes.json', '{"hello":"world"}')
    const result = await sniff(file)
    expect(result.kind).toBe('unknown')
    // Naming the two markers is what turns "no" into something diagnosable.
    expect(result.reason).toMatch(/worldSaveData/)
    expect(result.reason).toMatch(/PalWorldPlayerSaveData/)
  })

  it('rejects unrelated JSON', async () => {
    const { file } = fakeFile('package.json', '{"name":"nope"}')
    expect((await sniff(file)).kind).toBe('unknown')
  })

  it('classifies LocalData.sav by name, without a read', async () => {
    // A `.sav` is compressed, so there is nothing to sniff without decoding
    // it; the name is all there is at this stage. The worker checks the
    // contents once it has them.
    const { file } = fakeFile('LocalData.sav', '', 68_276)
    const result = await sniff(file)
    expect(result.kind).toBe('local')
    expect(result.reason).toBeUndefined()
    expect(file.slice).not.toHaveBeenCalled()
  })

  it('classifies a converted LocalData.json too', async () => {
    const { file } = fakeFile('LocalData.json', LOCAL)
    expect((await sniff(file)).kind).toBe('local')
  })

  it('classifies LevelMeta.sav by name, without reading it', async () => {
    // Must not fall through to the generic `.sav` branch: `acceptSavs` treats
    // every non-UID-named `.sav` as a level candidate and hands everything but
    // the largest to the player reader, which used to blame this file for having
    // no PlayerUId.
    const { file } = fakeFile('LevelMeta.sav', '', 1_931)
    const result = await sniff(file)
    expect(result.kind).toBe('levelmeta')
    expect(result.reason).toBeUndefined()
    expect(file.slice).not.toHaveBeenCalled()
  })

  it('classifies a converted LevelMeta.json too', async () => {
    const { file } = fakeFile('LevelMeta.json', LEVELMETA)
    expect((await sniff(file)).kind).toBe('levelmeta')
  })

  it('recognises a renamed LevelMeta.json by its content', async () => {
    const { file } = fakeFile('world-meta.json', LEVELMETA)
    expect((await sniff(file)).kind).toBe('levelmeta')
  })

  it('recognises a LocalData.json that was renamed, by its content', async () => {
    // The name is the cheap first stop, never the discriminator — same
    // contract the DPS check has.
    const { file } = fakeFile('client-backup.json', LOCAL)
    expect((await sniff(file)).kind).toBe('local')
  })

  it('reads a player uid from a .sav filename too', () => {
    // This is the only thing separating a player .sav from a level .sav before
    // decompressing one: size cannot, because a compressed level save is under
    // a megabyte and smaller than any cap that admits a real player file.
    expect(filenameUidOf('FA02FA02FA024FFF8FFFFA02FA02FA02.sav')).toBe(
      'fa02fa02fa024fff8ffffa02fa02fa02',
    )
    expect(filenameUidOf('Level.sav')).toBeUndefined()
  })

  it('reads an advisory uid from the filename', () => {
    expect(filenameUidOf('FA02FA02FA024FFF8FFFFA02FA02FA02.json')).toBe(
      'fa02fa02fa024fff8ffffa02fa02fa02',
    )
    expect(filenameUidOf('Level.json')).toBeUndefined()
    expect(looksLikeDpsName('X_dps.json')).toBe(true)
  })
})

describe('partition', () => {
  it('splits a folder drop into level, players and rejects', async () => {
    const files = [
      fakeFile('Level.json', LEVEL, 74_000_000).file,
      fakeFile('A.json', PLAYER).file,
      fakeFile('B.json', PLAYER).file,
      fakeFile('B_dps.json', DPS, 244_000_000).file,
      fakeFile('notes.txt', '').file,
    ]
    const result = await partition(files)

    expect(result.level?.file.name).toBe('Level.json')
    expect(result.players.map((p) => p.file.name)).toEqual(['A.json', 'B.json'])
    // A DPS file is expected, understood and useless: it arrives with every
    // folder drop, so it is ignored rather than rejected and never appears in
    // the ledger of player saves it is not one of. An unrelated file is news.
    expect(result.ignored.map((r) => r.file.name)).toEqual(['B_dps.json'])
    expect(result.rejected.map((r) => r.file.name)).toEqual(['notes.txt'])
  })

  it('ignores the _dps.sav that comes with every real Players folder', async () => {
    // The regression: `<uid>_dps.sav` matches the player-save filename pattern,
    // so below the generic `.sav` branch it was classified as a raw save, passed
    // the "named player save" filter and reached the player reader — which
    // rejected it, putting a permanent, unactionable rejection in the ledger.
    const uid = 'C2CDDA50000000000000000000000000'
    const result = await partition([
      fakeFile('Level.sav', '', 861_566).file,
      fakeFile(`${uid}.sav`, '', 120_000).file,
      fakeFile(`${uid}_dps.sav`, '', 244_000_000).file,
    ])

    expect(result.savs.map((s) => s.file.name)).toEqual([
      'Level.sav',
      `${uid}.sav`,
    ])
    expect(result.ignored.map((r) => r.file.name)).toEqual([`${uid}_dps.sav`])
    expect(result.rejected).toEqual([])
  })

  it('still explains a DPS file dropped on its own', async () => {
    // Ignoring it silently is right in a folder drop and wrong here: a drop
    // that changes nothing on screen reads as the app having failed.
    const result = await partition([
      fakeFile('B_dps.sav', '', 244_000_000).file,
    ])

    expect(result.level).toBeUndefined()
    expect(result.players).toEqual([])
    expect(result.ignored[0]?.reason).toBe('DPS storage file.')
  })

  it('keeps LevelMeta out of the raw-sav bucket entirely', async () => {
    // The regression this guards is what a real world folder drop used to do:
    // both `Level.sav` and `LevelMeta.sav` are unnamed `.sav`s, so `acceptSavs`
    // sorted them by size, took the largest as the level, and queued the other
    // as a player save.
    const files = [
      fakeFile('Level.sav', '', 861_566).file,
      fakeFile('LevelMeta.sav', '', 1_931).file,
    ]
    const result = await partition(files)

    expect(result.levelMeta?.file.name).toBe('LevelMeta.sav')
    expect(result.savs.map((s) => s.file.name)).toEqual(['Level.sav'])
    expect(result.players).toEqual([])
    expect(result.rejected).toEqual([])
  })

  it('keeps only one LevelMeta and rejects the rest', async () => {
    const files = [
      fakeFile('LevelMeta.sav', '', 1_931).file,
      fakeFile('LevelMeta.json', LEVELMETA).file,
    ]
    const result = await partition(files)
    expect(result.levelMeta?.file.name).toBe('LevelMeta.sav')
    expect(result.rejected.map((r) => r.file.name)).toEqual(['LevelMeta.json'])
  })

  it('prefers the largest level file when several are dropped', async () => {
    const files = [
      fakeFile('truncated.json', LEVEL, 1_000).file,
      fakeFile('Level.json', LEVEL, 74_000_000).file,
    ]
    const result = await partition(files)
    expect(result.level?.file.name).toBe('Level.json')
  })

  it('tells a level .sav apart from player .sav files by name', async () => {
    // A folder of raw saves: exactly one is the world, the rest are players.
    // Picking "the largest" alone would work here but breaks the moment a
    // player file is bigger than a small world, so the name decides.
    const files = [
      fakeFile('Level.sav', '', 861_566).file,
      fakeFile('FA02FA02FA024FFF8FFFFA02FA02FA02.sav', '', 8_198).file,
      fakeFile('AB02FA02FA024FFF8FFFFA02FA02FA0C.sav', '', 9_293).file,
    ]
    const result = await partition(files)

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

  it('keeps LocalData.sav out of the raw-save bucket', async () => {
    // This is the bug the `local` bucket exists to prevent. `acceptSavs`
    // treats the largest unnamed `.sav` as the level and hands the rest to the
    // player-save reader — which does *not* reject a LocalData, because it has
    // a `SaveData` of its own, and would produce a junk player record.
    const files = [
      fakeFile('Level.sav', '', 861_566).file,
      fakeFile('LocalData.sav', '', 68_276).file,
    ]
    const result = await partition(files)

    expect(result.savs.map((s) => s.file.name)).toEqual(['Level.sav'])
    expect(result.local?.file.name).toBe('LocalData.sav')
    expect(result.rejected).toEqual([])
  })

  it('keeps only one LocalData and rejects the rest', async () => {
    // One file describes one client; a second is a mistake worth naming
    // rather than silently letting the last one win.
    const files = [
      fakeFile('LocalData.sav', '', 68_276).file,
      fakeFile('LocalData.json', LOCAL).file,
    ]
    const result = await partition(files)

    expect(result.local?.file.name).toBe('LocalData.sav')
    expect(result.rejected.map((r) => r.file.name)).toEqual(['LocalData.json'])
  })

  it('keeps raw saves apart from rejects so they can be explained', async () => {
    // Someone dropping their whole save folder gets both the .sav and the
    // converted .json. The .json wins, and the .sav must not be reported as a
    // problem — nothing went wrong.
    const files = [
      fakeFile('Level.sav', '', 861_566).file,
      fakeFile('Level.json', LEVEL, 74_000_000).file,
    ]
    const result = await partition(files)

    expect(result.level?.file.name).toBe('Level.json')
    expect(result.savs.map((s) => s.file.name)).toEqual(['Level.sav'])
    expect(result.rejected).toEqual([])
  })

  it('reports a .sav-only drop as a save, not as nothing usable', async () => {
    const result = await partition([fakeFile('Level.sav', '', 861_566).file])
    expect(result.level).toBeUndefined()
    expect(result.savs).toHaveLength(1)
    expect(result.rejected).toEqual([])
  })
})
