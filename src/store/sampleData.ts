/**
 * The sample world's file format: one slim payload and a version.
 *
 * Apart from `sample.ts`, which fetches it, so the script that writes the file
 * and the test that checks it can import this without a store or a browser.
 */

import type { SlimPayload } from '../domain/types.ts'
import { buildIndexes } from '../parse/worker/buildIndexes.ts'

/**
 * Bumped when the payload's shape changes in a way an old file would break
 * on. The loader refuses a file of another version rather than half-read it.
 */
export const SAMPLE_VERSION = 1

/** What the header shows in place of a file name. */
export const SAMPLE_NAME = 'Sample world'

export interface SampleFile {
  version: number
  payload: SlimPayload
}

/** A raw level tree, as the fixture holds it, to the file the app ships. */
export function sampleFrom(tree: unknown): SampleFile {
  return { version: SAMPLE_VERSION, payload: buildIndexes(tree) }
}

/** The payload from a fetched file, or nothing if it is not one this build reads. */
export function readSample(file: unknown): SlimPayload | undefined {
  const f = file as Partial<SampleFile> | null
  if (!f || f.version !== SAMPLE_VERSION || !f.payload) return undefined
  return f.payload
}
