/**
 * Bakes the world map into a tile pyramid, once.
 *
 * `T_WorldMap.webp` is 1.9 MB on disk and **8192×8192**, which is 268 MB of
 * RGBA once decoded. The trick that makes this safe is `createImageBitmap`'s
 * `resizeWidth`, which resizes *during* decode so the full frame is never
 * materialised. The M0 spike measured 580 ms for the 4096 decode and 1.4 s to
 * slice 341 tiles totalling 1.7 MB — see docs/spike-m0.md.
 *
 * Support for `resizeWidth` is uneven across engines and only Chromium is
 * verified, so the result is **feature-detected** by comparing the returned
 * bitmap's width against what was asked for. When it is ignored we redraw down
 * ourselves and close the oversized bitmap immediately; when the decode fails
 * outright we step down to 2048, and the map view falls back to a procedural
 * grid if even that fails.
 */

import { fetchMapImage, putTiles, putTileSet, tileKey } from './refdata.ts'

const TILE = 256
const TARGET = 4096
const FALLBACK = 2048

export type TilesToWorker = { t: 'bake' }
export type TilesFromWorker =
  | { t: 'progress'; done: number; total: number; label: string }
  | { t: 'done'; size: number; tile: number; levels: number; bytes: number }
  | { t: 'error'; message: string }

function post(msg: TilesFromWorker) {
  self.postMessage(msg)
}

/** Decodes at `target`, coping with engines that ignore the resize request. */
async function decodeAt(blob: Blob, target: number): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: target,
    resizeHeight: target,
    resizeQuality: 'high',
  })
  if (bitmap.width === target) return bitmap

  // The resize was ignored — we are now holding the full-size bitmap. Draw it
  // down and release it before doing anything else.
  const canvas = new OffscreenCanvas(target, target)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, target, target)
  bitmap.close()
  return createImageBitmap(canvas)
}

async function bake() {
  post({ t: 'progress', done: 0, total: 1, label: 'Fetching world map' })
  const blob = await fetchMapImage()

  let bitmap: ImageBitmap
  let size = TARGET
  try {
    bitmap = await decodeAt(blob, TARGET)
  } catch {
    post({
      t: 'progress',
      done: 0,
      total: 1,
      label: 'Retrying at lower detail',
    })
    size = FALLBACK
    bitmap = await decodeAt(blob, FALLBACK)
  }
  size = bitmap.width

  // Zoom pyramid: full size down to a single tile.
  const levels: number[] = []
  for (let s = size; s >= TILE; s /= 2) levels.push(s)

  const total = levels.reduce((n, s) => n + (s / TILE) ** 2, 0)
  let done = 0
  let bytes = 0

  for (const [level, levelSize] of levels.entries()) {
    const scaled = new OffscreenCanvas(levelSize, levelSize)
    scaled.getContext('2d')!.drawImage(bitmap, 0, 0, levelSize, levelSize)

    const per = levelSize / TILE
    const batch: [string, Blob][] = []
    for (let x = 0; x < per; x++) {
      for (let y = 0; y < per; y++) {
        const tile = new OffscreenCanvas(TILE, TILE)
        tile.getContext('2d')!.drawImage(scaled, -x * TILE, -y * TILE)
        const out = await tile.convertToBlob({
          type: 'image/webp',
          quality: 0.85,
        })
        batch.push([tileKey(level, x, y), out])
        bytes += out.size
        done++
      }
    }
    await putTiles(batch)
    post({
      t: 'progress',
      done,
      total,
      label: `Preparing map — ${Math.round((done / total) * 100)}%`,
    })
  }

  bitmap.close()
  await putTileSet({ size, tile: TILE, levels: levels.length })
  post({ t: 'done', size, tile: TILE, levels: levels.length, bytes })
}

self.onmessage = (ev: MessageEvent<TilesToWorker>) => {
  if (ev.data.t !== 'bake') return
  bake().catch((err) =>
    post({
      t: 'error',
      message: err instanceof Error ? err.message : String(err),
    }),
  )
}
