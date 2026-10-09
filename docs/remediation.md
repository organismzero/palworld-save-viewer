# Remediation plan for the October 2026 code review

## Context

A whole-codebase review on 2026-10-08 looked for security issues, bugs and performance problems. It found no critical issues, 7 high-severity ones and about 35 medium or low. This plan covers all of them, grouped into eight work packages that can each land as one or a few commits on `main`.

Seventeen of the findings already have a test that states the correct behaviour and is marked `it.fails`, plus one `it.todo`. Fixing a finding means removing the `.fails` in the same commit; if the fix is right the test passes, and if the marker is left on by mistake the suite goes red. The tests are in `test/unit/farchive.test.ts`, `sav.test.ts`, `settings.test.ts`, `export.test.ts`, `readers.test.ts`, `breeding.test.ts`, `passiveBreeding.test.ts` and `test/golden/oodleSize.golden.test.ts`.

How each finding was established is marked as **reproduced** (triggered by a script, now a test where noted), **code checked** (the cited code was read and matches, nothing run) or **reported** (one reviewer's reading only). Reported findings should be confirmed in the app before the fix is written.

## Status: implemented 2026-10-09, not yet committed

Every item below has been addressed in the working tree. All 17 `it.fails` tests and the `it.todo` are now ordinary passing tests. `pnpm test` is 841 passed, `pnpm test:golden` 387 passed and 1 skipped, typecheck and lint are clean, and `pnpm audit` reports nothing.

What each fix rests on:

- **Covered by tests:** 1.1 to 1.7, 1.9, 2.1 to 2.5, 3.1 to 3.3, the 3.5 cache key, 4.1, 4.5, 6.1, 6.2, 6.6, 7.10.
- **Checked in a production build in a browser**, against a scratch copy of real saves: 2.1 (keep, forget, hide the tab, reload: nothing comes back), 2.6 (the policy is in place and the app parses a save, draws the map and exports under it with no violations), 4.1 (a folder whose backup is larger than its live level opens the live one), 5.1 (a zoomed-in "view" export is exactly the size of the viewport), 5.2 (adding LocalData with a pin selected keeps the selection and does not crash), 5.4 (the "all" export is 4096 px square), and all seven views open without an error.
- **Implemented but not exercised in the running app:** 3.4, 3.6, 3.7, 4.2, 4.3, 4.4, 5.3, 5.5, 5.6, 6.3, 6.4, 6.5, 6.7, 7.1 to 7.9, 8.1. These typecheck and lint, and the manual checks listed under their packages are still worth doing. None of the performance items was profiled.

Where the work differs from the plan as written:

- **1.3:** the size cap is in. Re-creating the Oodle module after a failure is not: `ooz-wasm` instantiates once at import and offers no way to do it again. The cap removes the one input shown to corrupt it.
- **1.8:** an empty storage slot is now dropped as soon as it is read, which removes the memory spike. The read takes as long as before, about a second a file, because the format gives a struct no length to skip by.
- **3.2:** dominance is now on an equal mask. The benchmark did not move (about 10 s for four passives on the pooled reference save, as before), and on the one-player stock the four-passive plan improved from about 43 expected eggs to about 40. The "strongest goal" skip is kept and documented as a shortcut: removing it gave identical plans on both reference stocks and took 26 s instead of 10.
- **3.4:** the order-free match is in, but has no test. Two different pens tying for cheapest could not be constructed in the passive planner, because routes to the same state keep only the first.
- **3.7:** the store now follows the `storage` event, so each tab's list is current before it writes. It does not merge by id, which could not tell a deletion from an addition.
- **4.1:** files left out are reported in one notice with a count, not as ledger rows. The ledger is keyed by file name, and fifty-six rows called `Level.sav` would have overwritten each other and the row for the level that was opened.
- **5.4:** the export loads the level whose tiles are at least as sharp as the export, drops the ones it loaded afterwards, and reports progress on the button.
- **6.2:** `speciesCounts` returns the save's own spelling of each id for display and is looked up lowercased. `EXPECTED.species` is now 265.
- **7.7:** the opponent search is debounced and `Owned` no longer recomputes advice it is given. `Fight` itself is not memoised.
- **8.2:** `@xmldom/xmldom` was updated within range, with no override needed, and vitest is on 4.1. Both suites pass on it unchanged.
- **Session snapshot version** is bumped to 5 for the `Boss_` change, so a save kept by an older build is discarded once and has to be opened again.

Noticed along the way and left alone:

- A map controller destroyed while its renderer is still initialising leaks that renderer. It can happen when the art arrives mid-mount.
- jsDelivr answered 403 for `characters.json` during the browser check and the app fell back to the GitHub mirror, as designed. If that persists it is worth knowing that every first visit is taking the slower path.
- Captures continuing after a player's last-online value (see 6.5).

## Verifying each package

- `pnpm test`, `pnpm test:golden`, `pnpm typecheck` and `pnpm lint` after every package. Judge the golden suite by its "Tests N passed" line, not its exit code.
- The UI has no tests. Anything in `src/app`, `src/views` or `src/components` is verified by running the app against a copy of `data/` placed in a scratch directory, never the originals.
- Prettier on touched files only.

## Order

1. Package 1, parser hardening. Highest severity, smallest change, fully covered by tests.
2. Package 2, privacy and secrets. These break promises the README makes.
3. Package 3, breeding correctness. Wrong answers presented as optimal.
4. Package 4, ingest. Wrong world loaded, stuck drops.
5. Package 5, map.
6. Package 6, data correctness.
7. Package 7, performance.
8. Package 8, robustness, dependencies and CI.

Packages 1, 3, 5 and 6 are independent of each other. Package 4 should follow package 2, because both change `saveStore.ts`/`session.ts` and the generation counter added in 4 is what package 2's forget fix should also check.

---

## Package 1: parser hardening

| #   | Finding                                                                                                                                             | Severity | Status                | Where                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------- | ------------------------------------------------------------------ |
| 1.1 | Reads past end-of-file succeed silently, so a file-supplied array count drives an unbounded loop and allocation                                     | High     | Reproduced, tested    | `src/parse/sav/farchive.ts:68`, `:172`, `:180`                     |
| 1.2 | zlib output is fully buffered before its length is checked (decompression bomb, compounded for `PlZ`)                                               | High     | Reproduced, `it.todo` | `src/parse/sav/decode.ts:88-109`, `:131-136`                       |
| 1.3 | Oodle is handed an unchecked declared size; near 2^32 it corrupts the WASM heap for every later decode                                              | Medium   | Reproduced, tested    | `decode.ts:61`, `src/parse/sav/oodle.ts:34`                        |
| 1.4 | `PlZ` with type byte 0x31 (single zlib) is refused                                                                                                  | Low      | Reproduced, tested    | `decode.ts:90`                                                     |
| 1.5 | UTF-8 decoder is not fatal, so the latin1 fallback never runs                                                                                       | Low      | Reproduced, tested    | `farchive.ts:25`, `:164`                                           |
| 1.6 | A zero-length fog mask yields `size: 0` and `NaN`, then `createImageData(0, 0)` throws in the map                                                   | Low      | Reported              | `src/parse/worker/readers/localData.ts:129-147`                    |
| 1.7 | Player batch uses the module-level `payload` after an await; a level parsed in between gets the wrong world's details, or the request never settles | Low      | Reported              | `src/parse/worker/parse.worker.ts:253-277`                         |
| 1.8 | Each `_dps.sav` builds a 376 MB tree to read a handful of pals                                                                                      | Low      | Reproduced (measured) | `src/parse/worker/readers/dimensionStorage.ts:46-82`               |
| 1.9 | Container grid size comes from an unbounded slot index                                                                                              | Low      | Reported              | `src/domain/bases.ts:119`, `src/views/bases/ContainerGrid.tsx:100` |

**Fixes**

- 1.1: make `read` and `skip` throw when `n < 0` or `offset + n > size`. In `tarray` and the two array loops at `farchive.ts:514` and `:541`, reject a count larger than the bytes remaining before allocating. The parser reviewer ran the strict `read` over all 16 reference saves with identical output, so no real file depends on the clamp. Check `guildTail`'s "consumes the bytes exactly" test at `rawdata.ts:277` still means what it says once an over-run throws.
- 1.2: replace `new Response(stream).arrayBuffer()` with a reader loop that sums chunk lengths and cancels the stream once the total passes the expected length (`compressedLength` for the first `PlZ` pass, `uncompressedLength` otherwise), plus an absolute cap. A ratio cap will not work: a legitimate 36 KB `_dps.sav` expands to 73 MB. Have the function report how many bytes it produced before stopping, and turn the `it.todo` in `sav.test.ts` into a real test on that number.
- 1.3: in `decodeSav`, refuse an `uncompressedLength` above a cap (1 GB is far above the 244 MB DPS file) before importing Oodle. Also drop and re-create the Oodle module instance after any failure, so a file that fails another way cannot poison the next.
- 1.4: key the second inflate on `container.type === 0x32` rather than the magic. No such file is in `data/`: every save there, including both server worlds added on 2026-10-09, is `PlM` (Oodle). The change follows PalworldSaveTools' `zlib.py`, which inflates a second time only when the type byte is 0x32. It cannot affect any file that decodes today, because every `PlZ` this app accepts already has type 0x32; it only changes what happens to a file that is currently refused.
- 1.5: `new TextDecoder('utf-8', { fatal: true })`.
- 1.6: treat `pixels === 0` as malformed in the reader, and guard `applyFog` against a zero size.
- 1.7: capture `const world = payload` at the top of `handleParsePlayerSav`, post an error if `payload !== world` after the batch, and wrap the handler in try/catch that posts `error` so the request always settles.
- 1.8: give `SaveParameterArray` a custom reader that peeks `CharacterID` per element and skips empty slots. Measure with the DPS golden test before and after; this is an optimisation, so drop it if the reader gets fragile.
- 1.9: clamp `slotGridSize` to a few hundred cells and note the highest slot beyond it, or drop out-of-range indices in `readers/containers.ts`.

**Tests to un-mark:** the four in `farchive.test.ts`, both `it.fails` in `sav.test.ts`, `oodleSize.golden.test.ts`. **New tests:** the 1.2 byte-count test, a zero-mask case in `localData.test.ts`, a `slotGridSize` clamp case in `bases.test.ts`.

---

## Package 2: privacy and secrets

| #   | Finding                                                                                   | Severity | Status             | Where                                              |
| --- | ----------------------------------------------------------------------------------------- | -------- | ------------------ | -------------------------------------------------- |
| 2.1 | "Forget this save" is written back the next time the tab is hidden                        | High     | Code checked       | `src/store/session.ts:201`, `:339`, `:437-442`     |
| 2.2 | Merges into a restored session are never scheduled for writing                            | Low      | Reported           | `session.ts:433`, `src/store/saveStore.ts:288-296` |
| 2.3 | An escaped quote in `PalWorldSettings.ini` carries `AdminPassword` past the secret filter | Medium   | Reproduced, tested | `src/parse/settings.ts:100-124`                    |
| 2.4 | A commented-out `;OptionSettings=(` line wins over the real one                           | Low      | Reproduced, tested | `settings.ts:68`                                   |
| 2.5 | CSV formula injection from save-supplied names                                            | Medium   | Reproduced, tested | `src/lib/export.ts:32`                             |
| 2.6 | No Content-Security-Policy                                                                | Medium   | Reported           | `index.html`                                       |

**Fixes**

- 2.1 and 2.2 together. Add a module-level `dirty` flag in `session.ts`, set by `scheduleWrite` and cleared after a successful write; `flushSessionWrite` returns unless dirty. `forgetSession` clears the flag, cancels the pending write, and bumps a generation that `writeSnapshot` checks before `writeDescriptor`, so an in-flight put cannot re-create the descriptor. Then change the `restoredFrom` early return at `:433` so a merge after restore does set the flag; without that, 2.1's fix loses those merges. This also stops the unconditional re-write on every tab hide, the wrong `savedAt`, and most of the two-tab overwrite.
- 2.3: in `splitTopLevel`, treat a backslash as escaping the next character. As defence in depth, after splitting, withhold any kept value matching `/(password|token|secret)\s*=/i`.
- 2.4: find `OptionSettings=(` only at the start of a line that does not begin with `;` or `#`.
- 2.5: in `cell`, when the raw value is a string beginning with `=`, `+`, `-`, `@`, tab or CR, prefix `'` before quoting. Numbers and booleans are left alone; the test for `-5` is already in place.
- 2.6: add a `<meta http-equiv="Content-Security-Policy">` to `index.html`. Starting point: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net https://raw.githubusercontent.com; img-src 'self' blob: data: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'`. Tune it against a production build with the map open, a save parsed, and a PNG exported, watching the console for violations. Vite's dev server needs a looser policy, so apply it at build time only.

**Tests to un-mark:** both in `settings.test.ts`, the one in `export.test.ts`. **New tests:** in `session.test.ts`, forget followed by a flush writes nothing; a merge after restore is written.

**Manual check for 2.1:** keep a save, forget it, switch tabs and back, reload; the reopen button must be gone.

---

## Package 3: breeding correctness

| #   | Finding                                                                                 | Severity | Status             | Where                                                                          |
| --- | --------------------------------------------------------------------------------------- | -------- | ------------------ | ------------------------------------------------------------------------------ |
| 3.1 | Passive search prunes without regard to gender, missing the direct route                | High     | Reproduced, tested | `src/domain/passiveBreeding.ts:369`, `:392-402`, `:559-579`                    |
| 3.2 | Superset-mask dominance is unsound; the answer depends on pal order                     | Medium   | Reproduced, tested | `passiveBreeding.ts:418-425`, `:570-574`                                       |
| 3.3 | "Assume unknown gender" counts each such pal twice                                      | Low      | Reproduced, tested | `src/domain/breeding.ts:459-471`, `:1011`, `:1364`                             |
| 3.4 | A pinned route is matched order-sensitively in the passive planner                      | Low      | Reported           | `passiveBreeding.ts:815-822`                                                   |
| 3.5 | Answer cache keyed on pick order; a failed answer is sticky                             | Medium   | Code checked       | `src/views/breed/usePassiveSearch.ts:75`, `:94-107`                            |
| 3.6 | Player panel computes a breeding reach in render and shares Breed's 6-entry stock cache | Medium   | Code checked       | `src/views/guild/PlayerDetailPanel.tsx:85-97`, `src/views/breed/stockCache.ts` |
| 3.7 | Two tabs overwrite each other's saved paths                                             | Medium   | Reported           | `src/views/breed/pathsStore.ts:68-85`                                          |

**Fixes**

- 3.1: a held state may dominate another only if it has both sexes, or the dominated state is also held and its sexes are a subset. When a root × root pairing fails the sex check, fall back to the `alt` cost as a bred, either-sex copy instead of `continue`.
- 3.2: dominate only on an equal mask, or count wanted bits the consumer does not need as junk. At minimum make tie-breaks deterministic. This enlarges the state space, so run `pnpm bench:passives` before and after (baseline on the reference save: 93 ms, 444 ms, 2.1 s and 9.4 s for one to four passives) and decide from the numbers. If equal-mask dominance is too slow, the fallback is the junk-accounting variant.
- 3.1 and 3.2 change which plans the search returns, so some existing expectations in `passiveBreeding.test.ts` may shift. Each shift must be a cheaper or equal plan; a dearer one means the fix is wrong.
- 3.3: have `buildStock` empty `unknown` when it folds them in, or build the owned lists from `male + female` plus only the unknowns not already folded. Keep `skippedNoGender` reporting as it is.
- 3.4: compare `pairKey(prefer.a, prefer.b)` with `pairKey(r.pair.a, r.pair.b)`. Add a test with the pair reversed.
- 3.5: key on the sorted, lowercased first four ids, and sort at the picker boundary in `BreedView.tsx:338` so chips and URL agree. Exclude failed answers from `answered`, or clear them in `retry`.
- 3.6: compute the reach only when the paldex tab is open, and keep those stocks out of Breed's LRU (a separate small cache, or a larger shared one).
- 3.7: re-read `localStorage` inside `commit` and merge by id, and subscribe to the `storage` event.

**Tests to un-mark:** three in `passiveBreeding.test.ts`, two in `breeding.test.ts`. **New tests:** 3.4, the 3.5 key function, a `pathsStore` merge.

---

## Package 4: ingest

| #   | Finding                                                                                           | Severity | Status       | Where                                                                                          |
| --- | ------------------------------------------------------------------------------------------------- | -------- | ------------ | ---------------------------------------------------------------------------------------------- |
| 4.1 | A world folder with backups loads the largest `Level.sav` and feeds the rest to the player reader | High     | Code checked | `src/store/saveStore.ts:316-333`, `src/app/filePicker.tsx:56-61`, `src/parse/sniff.ts:219-235` |
| 4.2 | One unreadable file strands the whole drop at "parsing"                                           | Medium   | Reported     | `saveStore.ts:386-411`, `:439-456`, `:713-721`                                                 |
| 4.3 | Cancel does not stop the rest of the drop; sidecar files attach to the next world                 | Medium   | Reported     | `saveStore.ts:692-705`                                                                         |
| 4.4 | Summary's "Load another", drop-replace and the Files panel skip the view-param cleanup            | Low      | Reported     | `src/app/SaveSummary.tsx:130`, `src/app/AppShell.tsx:363-374`                                  |
| 4.5 | `+` in a search value comes back as a space                                                       | Low      | Code checked | `src/app/viewParams.ts:78`                                                                     |

**Fixes**

- 4.1: carry the relative path through (`webkitRelativePath` from the picker, the entry path from a drop). Choose the shallowest non-UID `.sav` as the level, discard files outside its directory tree or under a `backup` path, and de-duplicate same-named player files by keeping the one beside the chosen level. Never send a second non-UID `.sav` to the player reader; reject it by name with a ledger row saying why. Size remains the tie-break only when paths are unavailable.
- 4.2: read buffers with `Promise.allSettled`, mark failures as rejected ledger rows with the reason, and wrap each stage of `acceptFiles` in try/catch so later stages still run. Add a `messageerror` listener on the worker and a rejection handler on the Reopen button in `DropZone.tsx:185`.
- 4.3: capture `loadGen` at the top of `acceptFiles`, bump it in `reset()` as well as `cancelLoad`, and bail after each await when it has changed, including before the `set` in `parsePlayerSavs`, `parseLocal` and `applyLevelMeta`.
- 4.4: move `loadAnother` into a store action and call it from all three places; call `clearViewParams` when `acceptSavs` starts a new level.
- 4.5: add `+` to the escaped set in `escapeValue`. Add a round-trip case to `viewParams.test.ts`.

**New tests:** the level-selection rule as a pure function over `{ name, path, size }` in `sniff.test.ts`; 4.5.

**Manual checks:** pick a copy of `data/` (56 backup folders) and confirm the live level loads promptly with the backups listed as ignored; drop a folder, cancel, drop a different `Level.sav` alone and confirm no settings or fog carried over.

---

## Package 5: map

| #   | Finding                                                                         | Severity | Status       | Where                                                                      |
| --- | ------------------------------------------------------------------------------- | -------- | ------------ | -------------------------------------------------------------------------- |
| 5.1 | "View" PNG export renders the whole scene, not the viewport, and fails silently | High     | Code checked | `src/views/map/MapController.ts:1178`, `src/views/map/MapView.tsx:394-404` |
| 5.2 | Adding LocalData.sav with a pin selected crashes the map                        | High     | Code checked | `MapController.ts:374-383`, `:465`, `:525`                                 |
| 5.3 | Tile textures leak on every Map mount                                           | Medium   | Code checked | `MapController.ts:946-951`, `:1269`                                        |
| 5.4 | Island export bakes in whichever tile level is loaded                           | Medium   | Reported     | `MapController.ts:1181-1201`                                               |
| 5.5 | Whole view re-renders on every pointer move                                     | Medium   | Code checked | `MapView.tsx:538-540`                                                      |
| 5.6 | Right-click can leave the map stuck dragging                                    | Low      | Reported     | `MapController.ts:986-995`                                                 |

**Fixes**

- 5.1: pass `{ target: this.app.stage, frame: new Rectangle(0, 0, screen.width, screen.height), clearColor: GROUND }`; pass `clearColor` to the island export too. Add a `catch` in `savePng` that notifies.
- 5.2: in `buildMarkers`, if `selectedMarker` belongs to the markers layer, clear it before destroying and re-resolve it by entity id afterwards. Add `localData` to the selection effect's deps in `MapView.tsx:366-386`.
- 5.3: build tile textures directly (`createImageBitmap(blob)` into an `ImageSource`, as the fog does at `:438`), keep them in a list, and destroy them in `destroy()`. Revoke the blob URLs if any remain.
- 5.4: before extracting, await loading of the tile level that matches the export scale, then extract. Show progress, since level 0 is 256 tiles.
- 5.5: move the cursor readout into a small child that writes `textContent` through a ref, throttled to animation frames.
- 5.6: ignore `pointerdown` unless `e.button === 0`, use `setPointerCapture`, and clear `dragging` on `pointercancel`, `contextmenu` and window `blur`.

**Manual checks** (all on a scratch copy of `data/`): zoom in and export "view", confirm the file matches the screen; select a pin, add LocalData.sav, confirm no error boundary; switch tabs twenty times with the memory panel open and confirm textures do not accumulate; export "all" from the fitted view and confirm sharp art; right-click then move the mouse.

---

## Package 6: data correctness

| #   | Finding                                                                                           | Severity | Status                  | Where                                                                                            |
| --- | ------------------------------------------------------------------------------------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| 6.1 | `Boss_` prefix matched case-sensitively                                                           | Medium   | Reproduced, tested      | `src/parse/worker/readers/characters.ts:81`                                                      |
| 6.2 | Species grouped case-sensitively                                                                  | Medium   | Reproduced, tested      | `src/domain/index.ts:108`, `:150-157`, `src/parse/worker/buildIndexes.ts:173`                    |
| 6.3 | Guild "most common species" shows world-wide counts                                               | Medium   | Code checked            | `src/views/guild/GuildView.tsx:640-650`                                                          |
| 6.4 | Player panel shown against the wrong guild                                                        | Medium   | Reported                | `GuildView.tsx:82-106`, `:162-169`, `src/views/guild/PlayerDetailPanel.tsx:57-66`                |
| 6.5 | Capture times are host-local wall clock but shown as UTC instants; last-online is UTC and is fine | Low      | Measured on two servers | `src/domain/exportRows.ts:104`, `src/views/pals/PalsView.tsx:829`, `src/app/SaveSummary.tsx:481` |
| 6.6 | "N a base worker" for plural base workers                                                         | Low      | Code checked            | `src/views/breed/ownerText.ts:65`                                                                |
| 6.7 | Unticking the last Builds job re-ticks the defaults                                               | Low      | Reported                | `src/views/builds/BuildsView.tsx:192-201`, `:781-786`                                            |

**Fixes**

- 6.1: `/^boss_/i.test(rawId)`, slice 5. Not peculiar to the reference save: the two server worlds added on 2026-10-09 hold 3 and 19 pals with a mixed-case prefix.
- 6.2: do 6.1 first (the same two worlds have 1 and 3 species split by casing), then key `palsByCharacterId` and the `stats.species` set by lowercased id, and lowercase at the three lookup sites (`SaveSummary.tsx:420`, `GuildView.tsx:642`, `PalsView.tsx:654`). Do not rewrite `characterId` itself in the reader: names, export and condense already lowercase on their own and the golden counts are pinned to the raw values. `EXPECTED.species` in `test/golden/level.golden.test.ts:36` is pinned at 272 and will drop: by 3 for the casing pairs, and by up to 4 more for the `Boss_` ids from 6.1, depending on whether each base species is also held. Update it in the same commits, to the number the fixed code produces, after checking the difference is exactly those ids.
- 6.3: tally from the guild's own `pals` by lowercased `characterId`, sort, take ten.
- 6.4: when a player jump seeds `openPlayerId`, also set `selectedId` to that player's `groupId`; clear `openPlayerId` when the guild select changes.
- 6.5: confirmed, and narrower than first reported. Measured on 2026-10-09 against two servers in `data/`, one hosted on a UTC clock and one on an Australian-eastern clock:
  - **The level `Timestamp` is the host's local wall clock.** On the local-time server it read 09:12:51 for a file downloaded at 22:13:53 UTC, which is 09:13:53 at UTC+11. On the UTC server the two agree to the minute.
  - **`OwnedTime` is in that same local frame.** No capture time on any of the three worlds is later than its level `Timestamp`.
  - **`LastOnlineDateTime` is UTC.** On the UTC server each player's captures begin 0.0 hours after their last-online value. On the local-time server there are none for exactly 10.0 hours and then a burst, for both players; UTC+10 was that host's offset on those dates.
  - So `lastSeen.at` is a real instant and `relativeTime(seen.at)` against `Date.now()` is correct as it stands. Leave `lastSeen.ts`, `GuildView.tsx:590`, `SaveSummary.tsx:839`, `PlayerCard.tsx:149` and `PlayerDetailPanel.tsx:199` alone.
  - The fix is for `ownedTime` only: in `PalsView.tsx:829` and `SaveSummary.tsx:481` express it relative to the level's `savedAtTicks` ("caught 9 days before this save"), which is a same-frame difference and exact; in `exportRows.ts:104` write it with `saveClock` or a zone-less ISO string, not `toISOString()` with its `Z`.
  - Never subtract a last-online value from `savedAtTicks`, or compare the two: they are in different frames and the answer is off by the host's offset. Check `lastSeen.ts`'s "logged out 30 minutes before the level was written" comment against this; it was measured on a UTC host, where the frames happen to coincide.
  - Side observation, not a finding: captures continue for up to about three hours after a player's last-online value, so it looks like a value written at login and not kept current through the session. If so, "Last online" understates by one session. Worth a look when this code is next touched.
  - Correct the note in `src/lib/format.ts:24-38`, which says tick counts in general are a naive wall clock; that is true of `Timestamp` and `OwnedTime` and not of `LastOnlineDateTime`.
  - Tests: a unit test that the CSV `caught` column carries no `Z`, and one for the "before this save" wording.
- 6.6: `${workers} base ${workers === 1 ? 'worker' : 'workers'}`. Add a case to `borrowText.test.ts`.
- 6.7: disable the last ticked box, so the set can never become empty. Decided 2026-10-09. An empty `w` in an old link keeps meaning "use the goal's defaults".

**Tests to un-mark:** both in `readers.test.ts`.

---

## Package 7: performance

| #    | Finding                                                                               | Severity | Status                | Where                                                                                       |
| ---- | ------------------------------------------------------------------------------------- | -------- | --------------------- | ------------------------------------------------------------------------------------------- |
| 7.1  | Reference data re-fetched and re-projected on every cached load                       | Medium   | Reproduced (measured) | `src/refdata/refdata.ts:823-828`, `:869-884`                                                |
| 7.2  | Blocked IndexedDB forces degraded mode with a working network                         | Low      | Reported              | `refdata.ts:821`, `:899`                                                                    |
| 7.3  | Old refdata cache versions never deleted; tile set key tied to the projection version | Low      | Reported              | `refdata.ts:767-769`, `:897`                                                                |
| 7.4  | Pals grid re-filters and re-sorts on every selection                                  | Medium   | Reported              | `src/views/pals/PalsView.tsx:160-168`, `src/views/pals/filter.ts:90-105`                    |
| 7.5  | Bases recomputes derived data on every render and keystroke                           | Medium   | Reported              | `src/views/bases/BasesView.tsx:130-135`, `:420`, `:517-536`, `:929-944`                     |
| 7.6  | Pair picker unvirtualised, re-sorting on every parent render                          | Medium   | Reported              | `src/views/breed/PairPicker.tsx:75-99`, `:153-196`, `src/views/breed/BreedView.tsx:118-119` |
| 7.7  | Builds Fight recomputes rankings per opponent-search keystroke                        | Low      | Plausible             | `src/views/builds/BuildsView.tsx:306`, `:468-485`                                           |
| 7.8  | Hover-card layer re-renders on every scroll event                                     | Low      | Reported              | `src/components/cards/hoverCard.ts:260-272`                                                 |
| 7.9  | Whole-store `useSaveStore()` subscriptions in the shell                               | Low      | Reported              | `src/App.tsx:22-32`, `src/app/AppShell.tsx:355`, `src/app/SaveSummary.tsx:62-71`            |
| 7.10 | `w=` and `pv=` URL lists uncapped                                                     | Low      | Reported              | `src/views/builds/params.ts:108`, `src/views/breed/params.ts:205-207`                       |

**Fixes**

- 7.1: skip `revalidate` when the stored `cachedAt` is younger than 24 hours, and run it from `requestIdleCallback` or the existing tiles worker when it does run. This also makes the "second visit needs no network" claim in About and `SOURCES.md` true again, icons aside.
- 7.2: wrap the cache read and write in try/catch and fall through to `fetchAndSlim()`, holding the result in memory.
- 7.3: give the tile set its own version constant, and delete non-current `refdata@*` and `meta@*` keys after a successful store.
- 7.4: key the memo on the filter and sort fields only, not `selectedId`; precompute sort keys once per pal with a shared `Intl.Collator`; pass `query` through `useDeferredValue`.
- 7.5: `useCallback` the three name functions; give `ExportMenu` a thunk evaluated on click instead of prebuilt rows; memoise the rail totals on `index`; `memo` `BasePlan` and `BaseOverview`.
- 7.6: memoise `speciesText(data)` and `passiveText(data)` in `BreedView`, then virtualise the list with `@tanstack/react-virtual` as Pals does.
- 7.7: keep the search text in local state inside `OpponentPicker` and publish it debounced; pass computed advice into `Owned` rather than recomputing. Measure first on the pooled reference save; skip if it is not noticeable.
- 7.8: in `hideHoverCard`, return early when nothing is open.
- 7.9: per-field selectors or `useShallow`; stop writing `phase` and `progressLabel` once status is `ready`.
- 7.10: filter `w` against the `WORK_TYPES` ids; cap `pv` at `MAX_SLOTS` after sorting. Add cases to `buildsParams.test.ts` and `breedParams.test.ts`.

**Verification:** React DevTools profiler before and after for 7.4 to 7.9 on the reference save with the guild pooled; network panel on a warm reload for 7.1.

---

## Package 8: robustness, dependencies and CI

| #   | Finding                                                                            | Severity | Status     | Where                                         |
| --- | ---------------------------------------------------------------------------------- | -------- | ---------- | --------------------------------------------- |
| 8.1 | Tray, command palette and hover-card layer sit outside the per-view error boundary | Low      | Plausible  | `src/app/AppShell.tsx:531-549`                |
| 8.2 | `pnpm audit`: 23 advisories, 10 in production via `pixi.js` → `@xmldom/xmldom`     | Low      | Reproduced | `package.json`                                |
| 8.3 | Pages workflow holds `contents: write` and uses actions by mutable tag             | Low      | Reported   | `.github/workflows/pages.yml:12-13`, `:38-44` |
| 8.4 | Reference data pulled from a mutable `@main` ref                                   | Low      | Reported   | `refdata.ts:32`                               |

**Fixes**

- 8.1: wrap `<Tray>` and `<HoverCardLayer>` each in their own `ErrorBoundary`.
- 8.2: add a pnpm override for `@xmldom/xmldom` at 0.8.15 or later, and bump vitest to a release that clears the `tinypool` advisories. A vitest major bump can change config and snapshot behaviour, so do it in its own commit and run both suites. Separately, check whether Pixi's browser bundle includes xmldom at all (search the built `pixi` chunk); if it does not, the production exposure is nil and the override is hygiene.
- 8.3: pin `actions/checkout`, `actions/setup-node` and `pnpm/action-setup` to commit SHAs. Reduce `contents: write` to `read` if the deploy uses the Pages artifact flow and does not push a branch.
- 8.4: no code change. Decided 2026-10-09: keep following upstream `main`, so new game content appears without a release of this app. Say so in `SOURCES.md`, with the reason it is safe: everything from that data renders as text and icon paths cannot leave the CDN prefix.

---

## Decisions

Still open:

1. **1.4:** whether to make this change at all without a real file to test it on. See the note in package 1; the recommendation is to make it, since it only affects files that are refused today.
2. **3.2:** equal-mask dominance versus junk accounting, to be decided from the benchmark.

Settled on 2026-10-09:

- **6.5:** measured; capture times are local wall clock, last-online is UTC. Fix as described.
- **6.7:** disable the last ticked box.
- **8.4:** keep following upstream `main`.

## Found clean, no action

No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere in `src`. No analytics or beacons, and no save-derived string in any URL. Parser widths, signedness and string conventions match the Python reference. Probability maths in `passives.ts`, `pairOutcomes.ts` and `ivForecast.ts` sums to 1. `data/` is gitignored and no `.sav` is tracked.
