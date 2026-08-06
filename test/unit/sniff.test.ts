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
    expect(result.rejected.map((r) => r.file.name)).toEqual([
      'B_dps.json',
      'notes.txt',
    ])
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
