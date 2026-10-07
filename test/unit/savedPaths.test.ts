/**
 * Saved breeding paths: the canonical form, world scoping and storage.
 *
 * Every id here is synthetic. A saved path holds a player uid, which is exactly
 * what the golden leak guard exists to keep out of committed files.
 */

import { describe, expect, it } from 'vitest'

import type { SaveIndex } from '@/domain/types.ts'
import { BREED_DEFAULTS, type BreedParams } from '@/views/breed/params.ts'
import {
  belongsHere,
  canonicalPath,
  decodePath,
  defaultName,
  isSaveable,
  parseStored,
  serialiseStored,
  type SavedPath,
} from '@/views/breed/savedPaths.ts'

const A = 'aaaaaaaa'.padEnd(32, '0')
const B = 'bbbbbbbb'.padEnd(32, '0')
const GONE = 'eeeeeeee'.padEnd(32, '0')
const P1 = 'cccccccc'.padEnd(32, '1')
const P2 = 'dddddddd'.padEnd(32, '2')

/** `A` holds two pals and `B` one, so `A` is the default player. */
const index = {
  players: [{ playerUid: A }, { playerUid: B }],
  playerByUid: new Map([
    [A, {}],
    [B, {}],
  ]),
  palsByOwner: new Map([
    [A, [{}, {}]],
    [B, [{}]],
    [GONE, [{}]],
  ]),
  palById: new Map([
    [P1, { characterId: 'Anubis' }],
    [P2, { characterId: 'Penguin' }],
  ]),
} as unknown as SaveIndex

const plan = (over: Partial<BreedParams> = {}): BreedParams => ({
  ...BREED_DEFAULTS,
  target: 'anubis',
  ...over,
})

const pair = (over: Partial<BreedParams> = {}): BreedParams => ({
  ...BREED_DEFAULTS,
  mode: 'pair',
  pairA: P1,
  pairB: P2,
  ...over,
})

describe('isSaveable', () => {
  it('needs a target in plan mode and both parents in pair mode', () => {
    expect(isSaveable(BREED_DEFAULTS)).toBe(false)
    expect(isSaveable(plan())).toBe(true)
    expect(isSaveable(pair({ pairB: undefined }))).toBe(false)
    expect(isSaveable(pair())).toBe(true)
  })
})

describe('canonicalPath', () => {
  it('names the default player, which a link leaves out', () => {
    const got = canonicalPath(plan(), index)
    expect(got?.playerUid).toBe(A)
    expect(decodePath(got!.qs, index).playerUid).toBe(A)
  })

  it('keeps a player who was actually picked', () => {
    expect(canonicalPath(plan({ playerUid: B }), index)?.playerUid).toBe(B)
  })

  it('is the same for the default player picked or not', () => {
    expect(canonicalPath(plan(), index)).toEqual(
      canonicalPath(plan({ playerUid: A }), index),
    )
  })

  it('ignores the search box', () => {
    expect(canonicalPath(plan({ query: 'anu' }), index)).toEqual(
      canonicalPath(plan(), index),
    )
  })

  it('keeps everything that changes the plan', () => {
    const base = canonicalPath(plan(), index)!.qs
    for (const over of [
      { passives: ['legend'] },
      { includeGuild: true },
      { includeBase: true },
      { assumeUnknownGender: true },
      { route: { a: 'penguin', b: 'kelpie' } },
      { target: 'penguin' },
    ] satisfies Partial<BreedParams>[]) {
      expect(canonicalPath(plan(over), index)!.qs).not.toBe(base)
    }
  })

  it('drops a leftover target and passives from a pair', () => {
    const clean = canonicalPath(pair(), index)
    const messy = canonicalPath(
      pair({ target: 'anubis', passives: ['legend'], noSpares: true }),
      index,
    )
    expect(messy).toEqual(clean)
    expect(decodePath(clean!.qs, index)).toMatchObject({
      mode: 'pair',
      pairA: P1,
      pairB: P2,
    })
  })

  it('is nothing when there is nothing to keep, or nobody to plan for', () => {
    expect(canonicalPath(BREED_DEFAULTS, index)).toBeUndefined()
    const empty = {
      players: [],
      playerByUid: new Map(),
      palsByOwner: new Map(),
      palById: new Map(),
    } as unknown as SaveIndex
    expect(canonicalPath(plan(), empty)).toBeUndefined()
  })
})

describe('defaultName', () => {
  const species = {
    name: (id: string) => id.toUpperCase(),
    icon: () => undefined,
    element: () => undefined,
  }
  const passives = {
    name: (id: string) => `<${id}>`,
    rank: () => undefined,
    description: () => undefined,
    origin: () => undefined,
    all: () => [],
  }

  it('is the target, then the passives', () => {
    expect(defaultName(plan(), index, species, passives)).toBe('ANUBIS')
    expect(
      defaultName(
        plan({ passives: ['legend', 'swift'] }),
        index,
        species,
        passives,
      ),
    ).toBe('ANUBIS · <legend>, <swift>')
  })

  it('is the two parents for a pair', () => {
    expect(defaultName(pair(), index, species, passives)).toBe(
      'ANUBIS × PENGUIN',
    )
  })
})

describe('belongsHere', () => {
  const path = (playerUid: string): SavedPath => ({
    id: 'x',
    name: 'x',
    qs: 't=anubis',
    playerUid,
    createdAt: 0,
  })

  it('goes by the player', () => {
    expect(belongsHere(path(A), index)).toBe(true)
    expect(belongsHere(path('ffffffff'.padEnd(32, '0')), index)).toBe(false)
  })

  it('counts a departed member whose pals are still in the world', () => {
    expect(belongsHere(path(GONE), index)).toBe(true)
  })
})

describe('stored paths', () => {
  const one: SavedPath = {
    id: 'id-1',
    name: 'Anubis',
    qs: 'p=aaaaaaaa&t=anubis',
    playerUid: A,
    createdAt: 1,
  }

  it('round-trips', () => {
    expect(parseStored(serialiseStored([one]))).toEqual({
      paths: [one],
      writable: true,
    })
  })

  it('starts empty and writable', () => {
    expect(parseStored(null)).toEqual({ paths: [], writable: true })
    expect(parseStored('')).toEqual({ paths: [], writable: true })
  })

  it('treats junk as empty, since there is nothing in it to protect', () => {
    expect(parseStored('{not json')).toEqual({ paths: [], writable: true })
    expect(parseStored('42')).toEqual({ paths: [], writable: true })
  })

  it('refuses to write over a version it does not know', () => {
    expect(parseStored(JSON.stringify({ v: 2, paths: [one] }))).toEqual({
      paths: [],
      writable: false,
    })
  })

  it('drops a damaged entry without losing the rest', () => {
    const raw = JSON.stringify({ v: 1, paths: [one, { id: 'broken' }, null] })
    expect(parseStored(raw).paths).toEqual([one])
  })
})
