/**
 * Generates `public/demo/sample.json`, the world behind "Try a sample world".
 *
 *     pnpm sample
 *
 * It is the committed test fixture, `test/fixtures/level.mini.json`, run
 * through the same `buildIndexes` a real save goes through, and written out as
 * the slim payload the app keeps. So it is already redacted, by
 * `make-fixture.ts`, and loading it needs no parser: the app builds its index
 * from the payload directly, the way a remembered session comes back.
 *
 * It is small on purpose. Twelve pals, two players and one base is enough to
 * put something in every view, and nothing in it came from anywhere but a
 * fixture that was safe to commit.
 *
 * Re-run after `pnpm fixture`, or after a change to the payload's shape:
 * `sample.test.ts` fails when the committed file has fallen behind.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { SAMPLE_VERSION, sampleFrom } from '../src/store/sampleData.ts'

const SOURCE = resolve(process.cwd(), 'test/fixtures/level.mini.json')
const OUT = resolve(process.cwd(), 'public/demo/sample.json')

const sample = sampleFrom(JSON.parse(readFileSync(SOURCE, 'utf8')))
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(sample) + '\n')

const p = sample.payload
console.log(
  `wrote ${OUT} (v${SAMPLE_VERSION}): ${p.pals.length} pals, ${p.players.length} players, ${p.bases.length} bases, ${p.structures.length} structures`,
)
