/**
 * "Try a sample world": a small redacted world, fetched on request.
 *
 * It costs nothing to anyone who does not ask for it. The file is not in the
 * bundle and nothing fetches it until the link is pressed.
 *
 * No parser is involved. The file is the slim payload the app keeps in memory
 * anyway, so it goes straight to `buildSaveIndex`, the same way a remembered
 * session comes back from this browser's storage.
 */

import { buildSaveIndex } from '../domain/index.ts'
import { SAMPLE_NAME, readSample } from './sampleData.ts'
import { useSaveStore } from './saveStore.ts'

export async function loadSample(): Promise<void> {
  useSaveStore.setState({
    status: 'loading',
    fileName: SAMPLE_NAME,
    fileBytes: undefined,
    error: undefined,
    progressLabel: 'Fetching the sample world',
  })
  // Asked once the fetch comes back: a real save dropped while it is out must
  // not have the sample land on top of it.
  const stillWanted = () => {
    const s = useSaveStore.getState()
    return s.status === 'loading' && s.fileName === SAMPLE_NAME
  }

  try {
    const res = await fetch(`${import.meta.env.BASE_URL}demo/sample.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = readSample(await res.json())
    if (!payload) throw new Error('not a sample this version reads')
    if (!stillWanted()) return

    useSaveStore.setState({
      status: 'ready',
      index: buildSaveIndex(payload),
      isSample: true,
      localData: undefined,
      levelMeta: undefined,
      playerFiles: {},
      fileName: SAMPLE_NAME,
      fileBytes: undefined,
      restoredFrom: undefined,
      timings: undefined,
      error: undefined,
      phase: 'done',
      progressLabel: undefined,
    })
  } catch {
    if (!stillWanted()) return
    useSaveStore.setState({
      status: 'error',
      error:
        'The sample world could not be loaded. Your own Level.sav will still open.',
    })
  }
}
