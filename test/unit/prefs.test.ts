/** Preferences as they are read back from storage. */

import { describe, expect, it } from 'vitest'

import { MAP_LAYER_IDS, parsePrefs } from '@/store/prefs.ts'
import { LAYER_IDS } from '@/views/map/params.ts'

describe('parsePrefs', () => {
  it('is empty for nothing, for junk and for the wrong shape', () => {
    expect(parsePrefs(null)).toEqual({})
    expect(parsePrefs('')).toEqual({})
    expect(parsePrefs('{not json')).toEqual({})
    expect(parsePrefs('[1,2]')).toEqual({})
    expect(parsePrefs('"map"')).toEqual({})
  })

  it('reads a view and a layer set', () => {
    const raw = JSON.stringify({ defaultView: 'breed', mapLayers: ['pals', 'bases'] }) // prettier-ignore
    expect(parsePrefs(raw)).toEqual({
      defaultView: 'breed',
      // In the list's own order, whatever order they were stored in.
      mapLayers: ['bases', 'pals'],
    })
  })

  it('drops what it does not recognise and keeps the rest', () => {
    const raw = JSON.stringify({
      defaultView: 'settings',
      mapLayers: ['pals', 'volcanoes'],
      theme: 'light',
    })
    expect(parsePrefs(raw)).toEqual({ mapLayers: ['pals'] })
  })

  it('keeps an empty layer set, which is a map that opens bare', () => {
    expect(parsePrefs('{"mapLayers":[]}')).toEqual({ mapLayers: [] })
    expect(parsePrefs('{"mapLayers":"pals"}')).toEqual({})
  })
})

describe('the layers a preference can name', () => {
  it('are layers the map has', () => {
    for (const id of MAP_LAYER_IDS) expect(LAYER_IDS).toContain(id)
  })

  it('leave out only the one that is always empty', () => {
    // Dungeons: the save records them and not where they are.
    expect(LAYER_IDS.filter((id) => !MAP_LAYER_IDS.includes(id as never))).toEqual(['dungeons']) // prettier-ignore
  })
})
