/**
 * Saved breeding paths: the canonical form, world scoping and storage.
 *
 * Every id here is synthetic. A saved path holds a player uid, which is exactly
 * what the golden leak guard exists to keep out of committed files.
 */

import { describe, expect, it } from 'vitest'

import type { BreedNode, BreedStep, BreedingPlan } from '@/domain/breeding.ts'
import type { SaveIndex } from '@/domain/types.ts'
import { BREED_DEFAULTS, type BreedParams } from '@/views/breed/params.ts'
import {
  belongsHere,
  canonicalPath,
  decodePath,
  defaultName,
  isSaveable,
  liveTicks,
  parseStored,
  serialiseStored,
  stepKey,
  summarisePlan,
  summaryText,
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

  it('ignores how the species list is filtered and ordered', () => {
    const filtered = plan({
      listElements: ['Fire'],
      listReachable: true,
      listUnowned: true,
      listSort: 'gen',
    })
    expect(canonicalPath(filtered, index)).toEqual(canonicalPath(plan(), index))
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
    elements: () => [],
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

/* -------------------------------------------------------------------------
   Progress
   ------------------------------------------------------------------------- */

const owned = (species: string): BreedNode => ({
  kind: 'owned',
  species,
  count: 1,
})

const step = (
  n: number,
  species: string,
  a: string,
  b: string,
  over: Partial<BreedStep> = {},
): BreedStep => ({
  n,
  species,
  a: owned(a),
  b: owned(b),
  generation: 1,
  selfPair: a === b,
  ...over,
})

const planOf = (
  steps: BreedStep[],
  over: Partial<BreedingPlan> = {},
): BreedingPlan => ({
  target: 'anubis',
  status: 'plan',
  ownedTarget: [],
  steps,
  generations: steps.length,
  options: [],
  borrowed: [],
  blockers: [],
  ...over,
})

describe('stepKey', () => {
  it('does not depend on the step number', () => {
    expect(stepKey(step(1, 'anubis', 'penguin', 'kelpie'))).toBe(
      stepKey(step(4, 'anubis', 'penguin', 'kelpie')),
    )
  })

  it('does not depend on which parent is on which side', () => {
    expect(stepKey(step(1, 'anubis', 'penguin', 'kelpie'))).toBe(
      stepKey(step(1, 'anubis', 'kelpie', 'penguin')),
    )
  })

  it('tells the same egg apart by what it has to carry', () => {
    const bare = step(1, 'anubis', 'penguin', 'kelpie')
    const carrying = step(1, 'anubis', 'penguin', 'kelpie', {
      carries: ['legend'],
    })
    expect(stepKey(bare)).not.toBe(stepKey(carrying))
    expect(stepKey(carrying)).toBe(
      stepKey(step(2, 'anubis', 'penguin', 'kelpie', { carries: ['legend'] })),
    )
  })
})

describe('liveTicks', () => {
  it('drops a tick whose step the plan no longer has', () => {
    const a = step(1, 'kelpie', 'penguin', 'penguin')
    const b = step(2, 'anubis', 'penguin', 'kelpie')
    const ticks = [stepKey(a), stepKey(b)]
    expect(liveTicks(planOf([a, b]), ticks)).toEqual(ticks)
    // A newer save holds a Kelpie, so the step that bred one is gone.
    expect(liveTicks(planOf([b]), ticks)).toEqual([stepKey(b)])
  })
})

describe('summarisePlan', () => {
  const a = step(1, 'kelpie', 'penguin', 'penguin')
  const b = step(2, 'anubis', 'penguin', 'kelpie')

  it('counts eggs, and ticked steps as done', () => {
    expect(summarisePlan(planOf([a, b]), [stepKey(a)], 100)).toEqual({
      status: 'plan',
      steps: 2,
      done: 1,
      owned: 0,
      savedAt: 100,
    })
  })

  it('counts a step a held pal already meets, ticked or not', () => {
    const met = { ...b, progress: { meets: true } as BreedStep['progress'] }
    expect(summarisePlan(planOf([a, met]), [], 100).done).toBe(1)
  })

  it('reports hatches only when they exceed the eggs', () => {
    expect(
      summarisePlan(planOf([a, b], { expectedEggs: 2 }), [], 100).hatches,
    ).toBeUndefined()
    expect(
      summarisePlan(planOf([a, b], { expectedEggs: 37.6 }), [], 100).hatches,
    ).toBe(38)
  })

  it('remembers the route under the previous save once it has changed', () => {
    const before = summarisePlan(planOf([a, b], { expectedEggs: 40 }), [], 100)
    const after = summarisePlan(planOf([b]), [], 200, before)
    expect(after.previous).toEqual({ steps: 2, hatches: 40 })
  })

  it('has nothing to compare against when a newer save changed nothing', () => {
    const before = summarisePlan(planOf([a, b]), [], 100)
    expect(
      summarisePlan(planOf([a, b]), [], 200, before).previous,
    ).toBeUndefined()
  })

  it('keeps the comparison while the same save stays open', () => {
    const first = summarisePlan(planOf([a, b]), [], 100)
    const second = summarisePlan(planOf([b]), [], 200, first)
    // Looked at again, ticked, looked at again: still "was 2".
    const third = summarisePlan(planOf([b]), [stepKey(b)], 200, second)
    expect(third.previous).toEqual({ steps: 2 })
    expect(third.done).toBe(1)
  })
})

describe('summaryText', () => {
  const base = { status: 'plan' as const, steps: 4, done: 0, owned: 0 }

  it('reads as a route', () => {
    expect(summaryText(base)).toBe('4 eggs')
    expect(summaryText({ ...base, steps: 1 })).toBe('1 egg')
    expect(summaryText({ ...base, done: 2, hatches: 38 })).toBe(
      '4 eggs · 2 done · ≈38 hatches',
    )
  })

  it('says so when there is nothing left to breed', () => {
    expect(summaryText({ ...base, steps: 0, owned: 2 })).toBe('already held')
  })

  it('says so when there is no route', () => {
    expect(summaryText({ ...base, status: 'unreachable', steps: 0 })).toBe(
      'no route from this stock',
    )
  })
})

describe('stored progress', () => {
  it('round-trips a summary and ticks, and drops ones it cannot read', () => {
    const good: SavedPath = {
      id: 'a',
      name: 'a',
      qs: 't=anubis',
      playerUid: A,
      createdAt: 1,
      summary: { status: 'plan', steps: 2, done: 1, owned: 0 },
      ticks: ['anubis<kelpie+penguin#'],
    }
    const bad = { ...good, id: 'b', summary: 'four eggs', ticks: [1, 'x'] }
    const { paths } = parseStored(JSON.stringify({ v: 1, paths: [good, bad] }))
    expect(paths[0]).toEqual(good)
    expect(paths[1]!.summary).toBeUndefined()
    expect(paths[1]!.ticks).toEqual(['x'])
  })
})
