# Palworld Save Viewer

[![CI](https://github.com/organismzero/palworld-save-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/organismzero/palworld-save-viewer/actions/workflows/ci.yml)
[![Licence: GPL-3.0-or-later](https://img.shields.io/badge/licence-GPL--3.0--or--later-blue.svg)](LICENSE)

A visual browser for Palworld save files. Drop in a save and get an interactive
map of your world, a browsable collection of every pal you own, a guild and
player dashboard, and a base and inventory explorer with global item search.

**Raw `.sav` files are read directly — there is no conversion step**, and
everything is parsed in your browser. Your save never leaves your machine.

## What it does

Five views, switchable with the tabs or the number keys:

- **Map** — the whole island, rendered with Pixi. Players, bases, player-built
  structures, world objects, loot chests, pals and fast-travel points as
  independently toggleable layers, with hover names, click-to-inspect and a
  live coordinate readout.
- **Pals** — every pal you own in a virtualised grid. Filter by element, level,
  IV total, owner, alpha/rare/nicknamed; sort by IV, level, rarity or capture
  date; click through to a detail drawer with passives, work suitability and an
  IV percentile against your own collection.
- **Bases** — a three-pane storage explorer. Bases (named by nearest landmark,
  because the game's own name is a Japanese placeholder), the structures in
  them with a top-down plan and who built each one, and any container's
  contents as a game-style inventory grid. Global item search answers "where
  are my Ancient Civilization Parts?" across every container in the world.
- **Guild** — guild totals, per-player cards with real XP bars, and five
  aggregate charts over your roster: level distribution, elements, top species,
  work-suitability coverage and passive frequency. Opening a player shows their
  pals, what they build, and their inventory.
- **Summary** — the full read-out of what the save contains, plus parse
  diagnostics.

Press <kbd>⌘K</kbd> to search pals, items, players and bases from anywhere.

## Using it

Drop `Level.sav` on the window, or the whole save folder at once. On Steam,
saves live under:

```
%LOCALAPPDATA%\Pal\Saved\SaveGames\<steamid>\<worldid>\
```

Adding the `Players` folder is worth it: container attribution goes from
inferred to exact, positions become real rather than last-jump estimates, and
paldex progress, technology points and true last-online times appear. Without
it the app says so rather than guessing silently.

JSON converted by
[PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools)
works too, and the two paths produce the same result — a golden test asserts
that entity for entity against a real world.

| Key                       | What it does                       |
| ------------------------- | ---------------------------------- |
| <kbd>⌘K</kbd>             | Search pals, items, players, bases |
| <kbd>1</kbd>–<kbd>5</kbd> | Switch view                        |
| <kbd>?</kbd>              | Keyboard shortcuts                 |
| <kbd>Esc</kbd>            | Close whatever is open             |

<kbd>⌘</kbd> is <kbd>Ctrl</kbd> on Windows and Linux. Number keys are ignored
while a text field has focus.

### Privacy

Your save is never uploaded. There is no server, no account, no analytics and
no telemetry — saves are decompressed and parsed entirely in a Web Worker on
your own machine, and closing the tab discards everything.

The app does fetch Palworld's own names, icons and map art at runtime, because
none of it is in this repository: from `cdn.jsdelivr.net`, falling back to
`raw.githubusercontent.com`, cached in IndexedDB so a second visit needs no
network. Those requests are fixed URLs for the same public files every user
fetches and carry nothing about your save. See [SOURCES.md](SOURCES.md).

If they fail, the app runs in a **degraded mode** rather than breaking: raw
asset ids instead of names, a coordinate grid instead of the map. Every
position and count stays exact. "Clear cached game data" in the About dialog
resets it.

### Browser requirements

A current Chromium, Firefox or Safari. Specifically the app needs
`WebAssembly` (Oodle decompression), `OffscreenCanvas` and `createImageBitmap`
(the map tile bake), `DecompressionStream` (zlib saves) and `<dialog>`.

The tile bake also uses `createImageBitmap`'s `resizeWidth`, whose support is
uneven; the bake feature-detects it and falls back to a full decode plus a
canvas resize, so an engine without it is slower on first load and no different
afterwards.

## Limitations

Things that are true today and worth knowing before filing a bug. Counts come
from the reference save this project is developed against — a 10-player
dedicated-server world.

- **Fog of war is not supported.** The explored-area mask lives in
  `LocalData.sav`, a per-machine client file, not in the world save or the
  player saves. There is no server-side record of who explored what.
- **Item authorship is not recorded by the game.** Nothing in the save links an
  item to whoever crafted it, so the app does not guess. Structures _are_
  attributed — the Bases view shows who built each one.
- **Container capacity is not in the save.** Only occupied slots are stored, so
  an inventory grid's empty cells are a floor on the real size, not the
  capacity. Gaps between items are real. The UI says so.
- **The map's Dungeons layer is always empty.** All 149 dungeons parse, but
  `DungeonSaveData` carries no transform of its own — a position would have to
  be derived from each dungeon's nested map objects, which is not implemented.
- **World Tree entities are not drawn on the overworld map.** They live in a
  separate coordinate space with its own map image; plotting them on the island
  would scatter them. They are still counted everywhere else.
- **Guild `last_online_real_time` is not a wall clock.** Its epoch is
  unidentified and it stops while the server is down, so without player saves
  the app shows "1.5d of uptime ago" rather than inventing a date.
- **351 of 1,317 containers cannot be attributed from a level save alone**, and
  88 of those resolve to no owner at all. Loading player saves fixes most of
  it; the rest appear under "Unattributed storage" rather than being hidden.

## How `.sav` reading works

A Palworld save is a 12-byte header and a compressed payload. Three formats
exist: `PlZ` and `CNK` are zlib, which browsers decompress natively, and `PlM`
is Oodle Kraken, which they cannot — so the app bundles
[`ooz-wasm`](https://www.npmjs.com/package/ooz-wasm), a WebAssembly build of a
clean-room Kraken decompressor.

Every save in the reference set is `PlM`, including per-player files. An 861 KB
`Level.sav` decompresses to 13.8 MB of GVAS in about 25 ms, and the binary
reader in `src/parse/sav/` turns that into exactly the tree a converted `.json`
parses to. Both paths then run the same indexer, which is what makes them
checkable against each other rather than merely similar.

`ooz-wasm` is GPL-3.0-or-later, which is why this project is too — see
[Licence](#licence). Both it and the GVAS reader are dynamically imported, so a
session that only opens `.json` never downloads either.

Two lookup tables — struct type hints and map-object model classes — are
generated from a PalworldSaveTools checkout by `pnpm gen:sav-tables`. They
drift when the game updates; a stale table costs `Structure.concreteModelType`
for newly added objects and nothing else.

## Development

Requires **Node ≥ 20.19 or ≥ 22.12** (Vite 7's floor) and **pnpm**.

```sh
pnpm install
pnpm dev
```

| Script                      | What it does                                               |
| --------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                  | Vite dev server                                            |
| `pnpm build`                | Typecheck, then production build                           |
| `pnpm preview`              | Serve the production build (see note below)                |
| `pnpm test`                 | Unit tests — fixtures only, no save file needed            |
| `pnpm test:watch`           | The same, in watch mode                                    |
| `pnpm test:golden`          | Full pipeline over a real save; auto-skips without one     |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                          |
| `pnpm typecheck`            | `tsc -b --noEmit`                                          |
| `pnpm fixture`              | Regenerate the redacted test fixture from a real save      |
| `pnpm gen:sav-tables`       | Regenerate the `.sav` lookup tables from PalworldSaveTools |
| `pnpm verify:coords`        | Re-validate the map coordinate transform                   |

### Layout

```
src/
  app/         shell, drop zone, command palette, dialogs, error boundaries
  components/  the design system — icons, charts, item slots, primitives
  domain/      the slim model, coordinate transform, per-view selectors
  lib/         formatting, the element palette, class-name helpers
  parse/       GVAS readers, ownership inference, file sniffing
    sav/       container, Oodle, the binary GVAS reader and its rawdata blobs
    worker/    the parse worker and the readers that build the domain model
  refdata/     runtime game data and art, slimmed and cached in IndexedDB
  store/       zustand stores: save, refdata, UI
  views/       map, pals, bases, guild
```

A save is parsed in a worker that retains the ~170 MB raw tree; what crosses to
the UI is a ~1.8 MB slim payload.

### Testing

Two tiers, and the split is deliberate:

- **`pnpm test`** runs against committed fixtures and needs no save file. This
  is what CI runs, and it is the bar for a pull request.
- **`pnpm test:golden`** runs the real pipeline over `data/`. It self-skips
  when that is absent, which is exactly why it is **not** in CI — running it
  there would report a false pass. Run it locally before changing anything
  under `src/parse/`.

`test/golden/leak.golden.test.ts` is a second local-only guard: it reads your
real save and fails if any identifier _or name_ from it has reached a committed
test file. It has caught real leaks three times. Run it before committing test
changes, and never commit anything from `data/`.

### Working with a real save

`data/` is gitignored and must stay that way — it holds other people's names,
positions and platform ids. To run the golden tests or exercise the app against
real data, put a save there:

```
data/Level.sav     # the raw save — read directly
data/Level.json    # the same world converted, so the two paths can be compared
data/Players/      # per-player saves, either extension
```

Only `Level.sav` is needed to use the app. The converted `.json` is what lets
the cross-check in `savPipeline.golden.test.ts` work, so keep both if you
intend to change anything under `src/parse/sav/`.

### Configuration

There is no config file. Three things are worth knowing:

| Where                            | What                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `VITE_BASE`                      | Public base path. Defaults to `/palworld-save-viewer/` for GitHub Pages; use `/` for a root |
| `PST_REF` in `src/refdata/`      | Which PalworldSaveTools ref the game data is pulled from                                    |
| `SLIM_VERSION` in `src/refdata/` | Bump to invalidate every cached projection at once after changing one                       |

### Viewing the production build

**Opening `dist/index.html` directly will show a blank page.** That is expected,
not a build failure. Two things prevent it:

- The app is an ES module, and browsers refuse to load modules over `file://`
  for security reasons.
- `vite.config.ts` sets `base` to `/palworld-save-viewer/` for GitHub Pages, so
  the built HTML references absolute paths that only resolve when served from
  that path.

Use `pnpm preview`, which serves `dist/` at the right base path:

```sh
pnpm build && pnpm preview
```

To build for a domain root instead: `VITE_BASE=/ pnpm build`.

### Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/pages.yml` — enable Pages for the repository with "GitHub
Actions" as the source and it needs no further configuration. A fork under a
different repository name sets `VITE_BASE` rather than editing
`vite.config.ts`.

> **If you fork and publish, the GPL applies to you too.** This is a
> client-side app, so every visitor's browser downloads and runs the bundled
> GPL-3.0 decompressor — that is conveying object code, not the
> server-side-service case the GPL leaves alone. Publishing a build means
> recipients must be able to get the corresponding source. Keeping your fork's
> source public is the simplest way to satisfy that.

## Contributing

Issues and pull requests are welcome.

- `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass; CI runs all three
  plus a build.
- Run `pnpm test:golden` locally if you touch anything under `src/parse/`. It
  needs a real save, which CI does not have.
- **Never commit anything from `data/`**, including in tests or screenshots.
  The leak guard exists because this has gone wrong before.
- Contributions are accepted under GPL-3.0-or-later, the same licence as the
  project.

If you are reporting a save that does not parse, the Summary view's
diagnostics panel lists the parse warnings — those are far more useful than a
screenshot, and they contain no personal data.

## Credits

Built on the format work of
[PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools)
(MIT), itself downstream of
[cheahjs/palworld-save-tools](https://github.com/cheahjs/palworld-save-tools).
Several readers here are ports of theirs; [SOURCES.md](SOURCES.md) lists which,
file by file.

Oodle decompression uses [`ooz-wasm`](https://github.com/SnosMe/ooz-wasm), a
WebAssembly build of [`powzix/ooz`](https://github.com/powzix/ooz).

## Licence

**GPL-3.0-or-later** — see [LICENSE](LICENSE).

The only open-source Oodle decompressor able to read modern Palworld saves in a
browser is GPL-3.0, and this project bundles it, so the combined work is
GPL-3.0-or-later too. [SOURCES.md](SOURCES.md) has the full reasoning, the
per-file credits, and a note on the licensing caveats worth knowing before
redistributing.

**No Pocketpair intellectual property is in this repository** — no map images,
no icons, no extracted game tables. All of it is fetched at runtime and cached
locally. Palworld is © Pocketpair, Inc. This project is not affiliated with or
endorsed by Pocketpair.
