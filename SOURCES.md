# Sources, credits and licensing

## Why this project is GPL-3.0

Palworld's saves have been Oodle-compressed (`PlM` container magic) since game
version 0.6, and 1.0 carries that format forward. Reading a `.sav` in a browser
therefore needs an Oodle decompressor.

This project ships one: [`ooz-wasm`](https://www.npmjs.com/package/ooz-wasm), a
WebAssembly build of [`powzix/ooz`](https://github.com/powzix/ooz) — a
clean-room Kraken/Mermaid/Selkie/Leviathan implementation — published under
**GPL-3.0-or-later**. Bundling it makes the combined work a derivative, so
**this project is licensed GPL-3.0-or-later** rather than the permissive licence
it started under. See `LICENSE` for the full text.

Two notes on that choice, kept because they are easy to lose:

- `ooz` reverse-engineers a proprietary codec, and its upstream repository has
  historically carried no clear licence file. The npm package declares
  GPL-3.0-or-later and includes the licence text; anyone redistributing this
  project should satisfy themselves that is sound.
- Vendoring Oodle's own `oo2core*` binaries would be proprietary redistribution
  and is not an option under any licence. Nothing here does that.

Only decompression is ever needed. The game still accepts the older `PlZ`
(double-zlib) container on read, so nothing here needs — or ships — an Oodle
_compressor_.

### What that buys

`src/parse/sav/` reads the container header, decompresses all three formats
(`PlM` via `ooz-wasm`, `PlZ` and `CNK` via the browser's own
`DecompressionStream`), and parses the GVAS archive into the same tree that a
converted `.json` produces. `test/golden/savPipeline.golden.test.ts` asserts
both paths yield an identical `SaveIndex` from the same world.

The Oodle WASM and the GVAS reader are dynamically imported, so a session that
only ever opens `.json` never downloads either.

## Game data and art

**This repository contains no Pocketpair intellectual property.** No map
images, no icons, no extracted game tables.

At runtime the app fetches reference data and art from
[PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools)
(MIT) via the jsDelivr CDN, falling back to `raw.githubusercontent.com`, and
caches it in your browser's IndexedDB. Exactly seven data files are fetched,
projected down to the fields the app uses before caching:

| File                      | Used for                                   |
| ------------------------- | ------------------------------------------ |
| `characters.json`         | pal names, elements, rarity, work, icons   |
| `skills.json`             | passive names, ranks and descriptions      |
| `work_suitability.json`   | work-type display names                    |
| `fast_travel_points.json` | landmarks, and naming bases by nearest one |
| `items.json`              | item names, icons, rarity, weight, stacks  |
| `world.json`              | structure names and icons                  |
| `pal_exp_table.json`      | the levelling curve behind player XP bars  |

Plus `game_data/icons/**` on demand — one request per icon actually shown —
and `assets/maps/T_WorldMap.webp`, which is baked into 341 tiles across five
zoom levels and stored in IndexedDB so the second visit needs no network.

The World Tree map (`T_TreeMap.webp`) is **not** fetched: entities in that
coordinate space are counted but not plotted.

When none of it is reachable the app degrades to raw asset ids and a
coordinate grid, with every position and count still exact. The underlying
game assets remain © Pocketpair, Inc.

## Derived from PalworldSaveTools

Several pieces of logic are ports of, or were derived by reading,
PalworldSaveTools (MIT — credited here rather than vendored):

| This project                      | PalworldSaveTools                                   |
| --------------------------------- | --------------------------------------------------- |
| `src/domain/coords.ts`            | `src/palworld_coord/__init__.py`                    |
| `src/parse/ownership.ts`          | `src/palworld_aio/inventory/container_ownership.py` |
| `src/parse/sav/container.ts`      | `src/palsav/palsav/compressor/*`                    |
| `src/parse/sav/farchive.ts`       | `src/palsav/palsav/archive.py`                      |
| `src/parse/sav/gvasHeader.ts`     | `src/palsav/palsav/gvas.py`                         |
| `src/parse/sav/rawdata.ts`        | `src/palsav/palsav/rawdata/*.py`                    |
| `src/parse/sav/typeHints.ts`      | `src/palsav/palsav/paltypes.py`                     |
| `src/parse/sav/concreteModels.ts` | `src/palsav/palsav/rawdata/map_concrete_model.py`   |

The last two are generated data rather than logic, and
`scripts/gen-sav-tables.ts` regenerates them from a PalworldSaveTools checkout
when the game format moves.

PalworldSaveTools is itself downstream of
[cheahjs/palworld-save-tools](https://github.com/cheahjs/palworld-save-tools)
(MIT) by way of [oMaN-Rod](https://github.com/oMaN-Rod/palworld-save-pal).

## Third-party runtime dependencies of note

- [`ooz-wasm`](https://github.com/SnosMe/ooz-wasm) — GPL-3.0-or-later (see above)
- [Pixi.js](https://pixijs.com/) — MIT
- Fonts: Bricolage Grotesque, Instrument Sans, Martian Mono — all SIL OFL,
  self-hosted rather than loaded from a CDN.

## Privacy

Save files — raw `.sav` and converted `.json` alike — are decompressed and
parsed entirely in a Web Worker on your own machine, and are never uploaded
anywhere. There is no server, no account, no analytics and no telemetry.

The only network requests the app makes are for the game reference data and art
described above, and none of them carry anything about your save: they are
fixed URLs for the same public files every user fetches.

After the first visit the data files and the map tiles come from IndexedDB, and
the UI never waits on the network again — a background revalidation runs and
failing is harmless. Individual icons are ordinary `<img>` requests rather than
IndexedDB entries, so offline they fall back to the same monogram tiles used
for the pals that have no art at all.
