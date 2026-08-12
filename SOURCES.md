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
caches it in your browser's IndexedDB. Exactly eight data files are fetched,
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
| `breedingdata.json`       | combi ranks and the unique breeding combos |

`breedingdata.json` is the one projected most aggressively: 7.1 MB on disk down
to ~67 KB cached. Only two of its six sections are read — the per-species combi
rank and the 253 hand-authored combos. The other four are precomputed
pair→child tables, and the formula in `src/domain/breeding.ts` reproduces all
46,355 of their entries from those two sections, so caching them as well would
be redundant. `pnpm verify:breeding` re-checks that claim against the upstream
file.

It is also the most expensive fetch: 343 KB of the 666 KB total, so it roughly
doubles the one-time reference-data transfer for a feature only the Breed view
uses. It is fetched eagerly with the rest anyway, to keep one cache entry and
one code path — and unlike the other seven it is allowed to fail on its own, so
a bad or moved file costs breeding paths rather than every name and icon in the
app. If cold start ever needs defending, this is the file to move behind a
lazy `loadBreeding()` under its own IndexedDB key.

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

## Fonts

Two families, both [SIL OFL 1.1](https://openfontlicense.org), vendored as
`.woff2` under `src/fonts/` with their licence text beside them, as the OFL
requires. They are neither loaded from a CDN nor installed as a package: a
webfont request on every cold load would make the game-art fetch above the
second exception to "nothing leaves your machine" rather than the only one, and
would break the promise that a second visit needs no network at all.

- [Titillium Web](https://fonts.google.com/specimen/Titillium+Web) — © 2009–2011
  Accademia di Belle Arti di Urbino and students of the MA course in Visual
  design. Weights 200, 400, 600 and 700, `latin` and `latin-ext`.
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) — © 2020 The
  JetBrains Mono Project Authors. Variable weight axis, `latin` and `latin-ext`.

**Both are substitutions.** Palworld's own UI typeface is not redistributable
and is not in this repository; Titillium Web is the closest freely available
match to its squarish humanist letterforms, and JetBrains Mono carries the save
data. Files were taken from [Fontsource](https://fontsource.org) via jsDelivr.
The previous stack — Bricolage Grotesque, Instrument Sans and Martian Mono —
belonged to the design this one replaced.

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
