/**
 * The parse worker.
 *
 * ## Why the raw tree stays here
 *
 * A `Level.sav` decompresses to tens of megabytes of GVAS — 55 MB for the
 * current reference world — and reads into a live object tree several times
 * that size. That whole tree is retained in this module's `raw` binding and
 * **never** posted to the main thread — what crosses is the ~1.8 MB slim
 * payload from `buildIndexes`. Keeping the heavy object graph off the main
 * thread's heap is the entire point of the architecture, so resist any change
 * that returns `raw` (or a slice of it that keeps a reference to it) from here.
 *
 * The `query` message exists so a "show raw JSON for this entity" inspector can
 * pull a subtree on demand; it serialises to a string before sending, which
 * deliberately breaks the reference.
 *
 * Everything `.sav`-specific — including the GPL Oodle WASM — arrives through
 * a dynamic import (`savTree`), so the main bundle never carries it.
 */

import { buildIndexes, mergePlayerDetails, type Phase } from './buildIndexes.ts'
import { readPlayerSave } from './readers/playerSave.ts'
import { playerBelongs } from '../../domain/verify.ts'
import { Warnings } from '../warnings.ts'
import type { Guid, PlayerDetail, SlimPayload } from '../../domain/types.ts'
import type { FromWorker, PlayerFileReport, ToWorker } from './protocol.ts'

let raw: unknown = null
/** Retained so player saves can be merged without re-parsing the level. */
let payload: SlimPayload | null = null
/** Warnings from passes that merging does not re-run. */
let carriedWarnings: SlimPayload['stats']['warnings'] = []
/** Accumulated across batches, so a second drop adds rather than replaces. */
const details = new Map<Guid, PlayerDetail>()

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, { transfer })
}

function progress(phase: Phase, label: string) {
  post({ t: 'progress', phase, label })
}

/** Walks a dotted path into the retained tree, tolerating array indices. */
function subtree(path: string[]): unknown {
  let node: any = raw
  for (const step of path) {
    if (node == null) return null
    node = Array.isArray(node) ? node[Number(step)] : node[step]
  }
  return node ?? null
}

/** Decompresses a raw save and reads it into the GVAS tree the readers take. */
async function savTree(buf: ArrayBuffer): Promise<unknown> {
  const { decodeSav } = await import('../sav/decode.ts')
  const { readGvas } = await import('../sav/gvas.ts')
  const result = await decodeSav(buf)
  if (!result.ok) throw new Error(result.message)
  return readGvas(result.gvas)
}

/**
 * Reads a batch of player saves onto the world already loaded.
 *
 * **A save whose player is not in this world is refused, not merged.** Files
 * arrive one gesture at a time now, so a save from a different world is a real
 * possibility rather than a theoretical one — and merging one is not harmless:
 * its container ids resolve against nothing, its row in the progression table
 * has no name to show, and it inflates `playerDetails` until the summary reads
 * "3 of 2 player saves". The same refusal covers a save left behind by a player
 * who has since left this world, because nothing in the files distinguishes the
 * two, and the reason says so.
 */
async function readPlayerBatch(
  files: { fileName: string; buf: ArrayBuffer }[],
  world: SlimPayload,
): Promise<{ reports: PlayerFileReport[]; warn: Warnings }> {
  const warn = new Warnings()
  const reports: PlayerFileReport[] = []

  progress('players', `Reading ${files.length} player saves`)
  for (const { fileName, buf } of files) {
    try {
      const detail = readPlayerSave(await savTree(buf), fileName, warn)
      if (!playerBelongs(world.players, detail.playerUid)) {
        reports.push({
          fileName,
          uid: detail.playerUid,
          ok: false,
          reason:
            'Not a player in this world — from a different save, or from a player who has left.',
        })
        continue
      }
      details.set(detail.playerUid, detail)
      reports.push({ fileName, uid: detail.playerUid, ok: true })
    } catch (err) {
      reports.push({
        fileName,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { reports, warn }
}

/**
 * A world: decompress, read the GVAS archive into a tree, index it.
 *
 * Inlined rather than going through `savTree` so each step gets its own
 * progress label and timing.
 */
async function handleParseSav(id: number, buf: ArrayBuffer) {
  const timings: Record<string, number> = {}
  let phase: Phase = 'decode'

  try {
    const { decodeSav } = await import('../sav/decode.ts')
    const { readGvas } = await import('../sav/gvas.ts')

    let t = performance.now()
    progress('decode', 'Decompressing save')
    const result = await decodeSav(buf)
    if (!result.ok) throw new Error(result.message)
    timings.decompress = performance.now() - t

    phase = 'gvas'
    t = performance.now()
    progress(
      'gvas',
      `Reading ${(result.gvas.length / 1e6).toFixed(0)} MB of GVAS`,
    )
    raw = readGvas(result.gvas)
    timings.gvas = performance.now() - t

    t = performance.now()
    details.clear()
    payload = buildIndexes(raw, {
      onPhase: (p, label) => {
        phase = p
        progress(p, label)
      },
    })
    carriedWarnings = payload.stats.warnings
    timings.index = performance.now() - t

    post({ t: 'result', id, payload, timings })
  } catch (err) {
    raw = null
    payload = null
    details.clear()
    post({
      t: 'error',
      id,
      phase,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
  }
}

async function handleParsePlayerSav(
  id: number,
  files: { fileName: string; buf: ArrayBuffer }[],
) {
  if (!payload) {
    post({
      t: 'error',
      id,
      phase: 'players',
      message: 'Load a level save before adding player saves.',
    })
    return
  }

  const { reports, warn } = await readPlayerBatch(files, payload)

  progress('merge', 'Re-deriving ownership')
  mergePlayerDetails(
    payload,
    [...details.values()],
    [...carriedWarnings, ...warn.list()],
  )
  post({ t: 'playersResult', id, payload, reports })
}

/**
 * The client's `LocalData`.
 *
 * Stateless, unlike every other handler here: nothing about this file feeds
 * `buildIndexes` or ownership, so there is nothing to retain and re-merge. It
 * is read once and handed over, masks and all, and the transfer list means the
 * worker's copy of them is detached rather than duplicated.
 *
 * A file that turns out not to be a `LocalData` comes back as a rejected
 * report rather than an `error`, so a mistaken drop lands in the ingestion
 * ledger instead of tearing down an already-loaded world.
 */
async function handleParseLocal(
  id: number,
  fileName: string,
  buf: ArrayBuffer,
) {
  const { readLocalData, maskBuffers } = await import('./readers/localData.ts')
  const warn = new Warnings()

  try {
    progress('decode', 'Reading client data')
    const tree = await savTree(buf)

    const local = readLocalData(tree, fileName, warn)
    post(
      { t: 'localResult', id, payload: local, report: { fileName, ok: true } },
      maskBuffers(local),
    )
  } catch (err) {
    post({
      t: 'localResult',
      id,
      report: {
        fileName,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      },
    })
  }
}

/**
 * `LevelMeta.sav`, which is two kilobytes and carries nothing transferable.
 *
 * No transfer list, unlike `parseLocal`: there are no mask buffers here, just
 * four scalars, so the structured clone is free.
 */
async function handleParseLevelMeta(
  id: number,
  fileName: string,
  buf: ArrayBuffer,
) {
  const { readLevelMeta } = await import('./readers/levelMeta.ts')
  const warn = new Warnings()

  try {
    progress('decode', 'Reading world metadata')
    const tree = await savTree(buf)

    post({
      t: 'levelMetaResult',
      id,
      payload: readLevelMeta(tree, fileName, warn),
      report: { fileName, ok: true },
    })
  } catch (err) {
    post({
      t: 'levelMetaResult',
      id,
      report: {
        fileName,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      },
    })
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  switch (msg.t) {
    case 'parseSav':
      void handleParseSav(msg.id, msg.buf)
      break

    case 'parsePlayerSav':
      void handleParsePlayerSav(msg.id, msg.files)
      break

    case 'parseLocal':
      void handleParseLocal(msg.id, msg.fileName, msg.buf)
      break

    case 'parseLevelMeta':
      void handleParseLevelMeta(msg.id, msg.fileName, msg.buf)
      break

    /**
     * Take on a world this worker never parsed.
     *
     * `raw` stays null — the ~170 MB tree cannot be reconstructed from a slim
     * payload and nothing needs it to merge player saves. What the merge does
     * need is `payload` to write into, the level's warnings so they are not
     * dropped on the next re-post, and any player details already merged, so a
     * second Players drop adds rather than replaces.
     */
    case 'adopt':
      payload = msg.payload
      carriedWarnings = msg.payload.stats.warnings
      details.clear()
      for (const d of msg.payload.playerDetails) details.set(d.playerUid, d)
      post({ t: 'adopted', id: msg.id })
      break

    case 'query': {
      let json: string | null = null
      try {
        json = JSON.stringify(subtree(msg.path), null, 2) ?? null
      } catch {
        json = null
      }
      post({ t: 'queryResult', id: msg.id, json })
      break
    }

    case 'dropRaw':
      raw = null
      break
  }
}
