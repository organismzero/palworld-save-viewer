# Cross-view links, surfacing parsed data, and honest recommendations

**Status, 2026-10-07.** Every item below was re-checked against the code on this date. Only 0g had been done. Since the original review the app gained the shared hover-card layer (`src/components/cards/`), dropped JSON loading in favour of raw `.sav` only, split the Builds tab into `parts.tsx` and `ProductionBuilds.tsx`, added four Builds purposes (fishing, food, cake, ranch) and added Pick-a-pair to Breed. Items those changes made obsolete are removed, items they half-built are shrunk to what remains, and code is named by symbol because the original line numbers had all drifted. Eight items were taken by the utility tray work, listed under "Utility tray" below and marked **(tray)** where they appear. That work is done, so those eight are done; everything else here is still open.

## Context

A review on 2026-09-19 ran the app headless, screenshotted every tab, and read every view and the shell. Everything in `docs/improvements.md` is shipped except `PalWorldSettings.ini` and save comparison; those two stay on that document and are not re-planned here.

What the review found falls into four kinds of work:

1. **Finished features that are invisible or slightly wrong.** Deep links exist but nothing offers to copy one. Focus jumps exist but only the palette uses them. Exports and the palette print names the views already resolve better. Keyboard shortcuts fire behind open dialogs. Two views say "reference data unavailable" during a normal load.
2. **Data the parser already produces that no view shows.** Pal hunger, sanity, friendship, health, current work, experience, storage location; per-stat condensing ranks outside the CSV export; item durability and ammo beyond a hover card; guild map markers; player records outside the Summary tables.
3. **Recommendations that claim more than they compute.** Builds says condensing orders your pals and three of its four sort chains never read a rank field. Breed prices passives precisely and gender not at all.
4. **Complementary features** that reuse existing selectors: map layers driven by the Pals filter, item hits plotted on the map, a guild contribution board, a base triage list, a condense advisor, a plan tracker, a sample world.

Phone-width layout is explicitly out of scope: save files cannot be loaded from a phone. Desktop keyboard and accessibility work is in scope.

The three constraints from the previous document still bind: privacy is load-bearing, `signal` is the only UI accent, and the app says what it does not know rather than guessing. One more is added here:

- **A recommendation's footnote must describe what the code does.** Where the two disagree, either the code grows to match or the footnote shrinks. Never the reverse.

Sizes below are S (an hour or two), M (half a day to a day), L (several days). Every item names the files it touches so the phases can be split into commits on `main`.

---

## Utility tray

**Done.** A fly-out tray, opened from the header or with `T`, available on every tab. It opens as an overlay over the right edge and can be pinned so the view narrows instead. It holds reference sheets and saved breeding paths. Built in this order:

1. **Shell plumbing**: 0c, 0d and 1g from this document.
2. **Tray shell**: the frame, tabs, pin, shortcut.
3. **Passive cheat sheet**: all 115 passives, searchable by name and effect, grouped by what they affect.
4. **Saved breeding paths**: a path is the Breed view's params plus a name, kept in `localStorage` when the user clicks Save. Includes 2f.
5. **Passive search cache**: so switching paths does not rerun a multi-second search. Includes 7e.
6. **Path progress and step ticks**: includes 7d.
7. **Cheat sheet actions**: carrier counts and "add to path".
8. **Types tab**: 8c.
9. **Auto-restore**: 1h.

---

## Phase 0 — Shared plumbing

Nothing user-visible on its own, but every later phase leans on it.

### 0a. Widen `Focus` — done

`Focus` has four more kinds: `structure` (Bases opens the base or world list the structure is in, on it), `map` (the Map selects and centres whatever was plotted with that id, turning its layer on if it was off, and says so when the thing has no position), `species` (Pals filters to one species, optionally one player's) and `fight` (Builds opens Fight against a species). The `map` kind carries an id and no layer: the controller finds the entity on whichever layer drew it, so a caller does not have to know that a player-built chest is on a different layer from a loot chest.

Doing it turned up a race in `useHashSync`. A view change pushes the hash, the push fires `hashchange`, and the handler adopted that echo as if it were a navigation, re-decoding the destination view from a hash that had no params yet. Whether a jump's focus survived depended on whether the view mounted before the event arrived. The hook now ignores the echo of its own push.

### 0b. Map params codec — done

`src/views/map/params.ts` holds `MapParams` and `mapCodec`: layers (`l=bases,players`, or `l=none`), fog and its opacity, the viewport as one param (`at=mx,my,zoom`), the selection (`sel=pals:<shortId>`) and colour by guild (`by=guild`). `MapView` reads all of it through `useViewParams`.

Three things differ from the plan:

- The codec is not bound to the save. A marker id only means something once the controller has plotted its entities, and fast-travel points come from reference data that has not arrived when `decode` runs, so the selection is carried unresolved and `MapView` resolves it against the controller after mount. A link naming a marker that is not there raises a notice.
- The search text is not in the link. It empties itself when a result is picked, and what was picked is the selection.
- Zoom is quoted against a 4096px map, so a link means the same thing whatever size the art was baked at. A map nobody has moved has no viewport in its link, and Fit goes back to that.

The controller reports the viewport only for movement the user made, and the view publishes it 250 ms after the last one, so a drag is not a render per frame.

### 0c. Notice channel — S **(tray)**

There is no way to tell the user something happened without a dialog. Add to `uiStore`: `notices: Notice[]`, `notify(text, { tone?: 'info' | 'warn'; ttl?: number })`, `dismiss(id)`. Render `<Notices/>` in `AppShell` above the footer: a stack of hairline panels, `role="status" aria-live="polite"`, auto dismissed after the ttl, click to dismiss. Reduced motion: no slide, just appear.

First callers: rejected files while a world is open (today they reach the ledger only), "N player saves merged", "export saved as …" (`ExportMenu`), the quota flip in `writeSnapshot` (which today reverses the user's consent with only a `console.warn`), "link copied", "path saved".

### 0d. Escape stack and modal-aware shortcuts — S **(tray)**

- `useShortcuts` in `AppShell` reads none of the open flags today, so digits switch views and `?` opens Shortcuts while About is open. It returns early when About or Shortcuts is open. ⌘K only ever opens the palette; make it toggle. The palette is cmdk's `Command.Dialog` in a portal, not a native `<dialog>`; About and Shortcuts are the native top-layer ones.
- Add `escapeStack` to `uiStore`: `pushEscape(fn): () => void`. A `useEscape(active, onClose)` hook registers while a drawer is open. The global handler calls the top of the stack on Escape when no modal is open. Register it in the pal drawer (`PalDetail`), player panel (`PlayerDetailPanel`), map selection card, the utility tray and the diagnostics popover (replacing its own listener). The container grid and passive picker overlay can follow with 0f.
- The hover-card layer has its own capture-phase Escape handler in `hoverCard.ts`. It stays: it only hides the card and does not stop the event, so a drawer under a card closes on the same press.
- The footer's `Esc Close` prompt shows whenever the stack is non-empty or a modal is open.
- `useDrawerFocus(ref, open)`: on open, focus the drawer's first heading or close button; on close, return focus to `document.activeElement` at open time. Give each drawer `role="region"` and an `aria-label`.

### 0e. Shared name resolvers — done

`src/domain/names.ts` holds `speciesName`, `itemName`, `structureName`, `skillName` and `baseNames(index, refdata)`. The exports pass the real resolvers, so a saved file reads "Wooden Chest" and "Base 3 · near Sea Breeze Archipelago" as the screen does, and the palette matches a base by its full label, landmark included. Tested in `test/unit/names.test.ts`.

### 0f. Combobox hook — done

`useCombobox` in `src/components/combobox.ts`, used by the map search, the Bases item search and the Breed passive picker. Arrow keys move a highlight, Enter takes it or the best match, Escape and a press outside close the list, and focus stays in the field. The key handling is the pure `comboboxKey`, tested in `test/unit/combobox.test.ts`. `MoreResults` in `controls.tsx` is the "showing 8 of 17 · show more" row all three end with.

### 0g. README shortcut table — done

The README, the footer and the shortcuts dialog all say `1`–`7`.

---

## Phase 1 — Small correctness fixes

Done. 1d was removed as obsolete. Three landed differently from how they were written:

- **1i.** The degraded-mode note is one component, `RefdataNote`, rendered once by the shell above whichever view is open, not once per view. Views keep only the consequence that is theirs (Builds has nothing to recommend, the passive picker has no list). The status covers two failures, and the note tells them apart: no game data at all, or data present and only the map art missing, which is said on the Map alone.
- **1j.** `ParamCodec` gained an optional `missing(raw)`, which every codec with ids implements, Bases included. `useViewParams` turns what it returns into one notice: "This link names a player and a pal that are not in this save." An ambiguous prefix counts as missing, as it does in `decode`. Builds also says so when its opponent is not a species in the game data. The unused `selectionMissing()` is gone.
- **1l.** The tab's shape moved to two spans inside the button, and the focus ring is the same parallelogram in the frame cyan with the fill stepped 2px inside it, so the ring follows the shear. `--surface-select-fill` did fail: white on it was 2.4:1 at the top stop and 3.7:1 at the bottom. Its stops now mix towards `--color-select-deep` and give 4.7:1 and 5.6:1, which darkens primary buttons, selected menu entries and ticked checkboxes as well. The `opacity-75` on tab hints is gone. The `/70` on the diagnostics kind line and on `RawId` stays: it measures 4.95:1 on the solid panel, and `--color-faint`, which the item proposed instead, is 4.3:1.

---

## Phase 2 — Cross-view links

Done; the two pieces that waited on other items went in with 3a and 5c. `Jump` in `src/components/Jump.tsx` is a button that calls `jump(view, focus)` and still raises the hover card of whatever it names. It has a `quiet` form for names inside list rows, where the text keeps its own colour and only the arrow is in the accent.

- **2a. Pal drawer.** Owner opens the player in Guild, position shows the pal on the Map, and under the species name are `breed →` (a real link into Breed) and `fight →` (Builds, Fight, against that species). The **Where** row is 3a's and its link goes in with it.
- **2b. Map selection card.** "Open in Pals", "Open in Guild" or "Open in Bases" by what is selected. Landmarks, dungeons and pins get none.
- **2c. Breed and Builds.** A step's parent pal and a borrowed parent's owner are links, as are the owned-pal rows in Builds. The "owned" pill opens Pals on that species for that player.
- **2d. Guild.** The player panel's bases, best pals and position are links. The marker chips open the map on their marker (5c).
- **2e. Base plan.** The dots are named buttons with a stroke focus ring, and the plan is one tab stop with arrow keys, Home and End inside it, not one stop per dot: a single base in the reference save has 1,372 structures.
- **2f. Copy link.** Done with the tray.

Found on the way: a character that has never moved records its position as exactly x 0, y 0, and 292 pals in the reference save were being plotted on that one spot and given its coordinates in their detail panel. The reader now reads that as no position, and `SNAPSHOT_VERSION` went to 4 so a remembered save does not bring the pile back.

---

## Phase 3 — Surface what is parsed: Pals

Done. The shared logic is `src/domain/palState.ts` (where a pal is kept, what condition it is in, its level in a job) and `src/views/pals/filter.ts` (the grid's filter and sort, moved out of the view so it can be tested). Tests are `palState.test.ts`, `palsParams.test.ts` and the export cases in `names.test.ts`.

- **3a. Drawer.** New rows: progress to the next level, soul enhancements by stat, **kept in** (party and slot, palbox page and slot, or the base, which links to Bases), guild, and a **condition** block with what it is working at, health, sickness, sanity, hunger and trust. Work suitability goes through `workLevel()`, the rule Builds uses: none of the 21 work bonuses in the reference save sits on a job its species lacks, so a bonus alone does not make a job.
- **3b. Card badge.** The worst condition, first in the badge column: dying, injured, sick, starving or low sanity. The hover card lists all of them.
- **3c. Filters and sorts.** Gender, maximum level, a job at a minimum level, "needs attention", and two owners that are not players: base workers and nobody. Sorts add HP, species and owner, and any sort can be reversed. The text filter matches a passive's display name.
- **3d. Export.** IV total, elements, health, hunger, sanity, friendship, current work, caught date, location, equipped and learned moves, and one column per job.

What the save turned out not to support, and what was done instead:

- **Hunger and friendship are numbers, not meters.** A pal's full stomach differs by species and the reference data carries no maximum; friendship is a running total of points. Sanity is the only one with a scale, and the save leaves it out at 100, so only 12 pals in the reference save have a value.
- **"Starving" is an empty stomach, and "low sanity" is below 50.** The first is the game's own boundary. The second is ours, and the number is always shown beside the flag.
- **The four per-stat ranks are soul enhancements**, not condensing, so they are a row of their own, labelled so.
- **Most pals have no "kept in" without a player save.** `Level.sav` records which container a pal is in, but not whose party or palbox it is; only the 53 base workers resolve from the level alone. The row is hidden otherwise.

---

## Phase 4 — Surface what is parsed: Bases and items

Done.

- **4a. Item detail columns.** The contents table gives a stack with wear, a loaded magazine or passives its own row instead of merging it, with condition and ammo columns that appear only when the container has something to put in them. `CONTAINER_COLUMNS` gains `durability`, `durability_full`, `ammo` and `magazine`; `ITEM_HIT_COLUMNS`, which is one row per place, gains the most worn of the item there.
- **4b. Bases filters and base overview.** The structure list narrows to a builder, to damaged and to locked, and can be ordered fullest first. The overview names the guild and camp level and has a health block. The plan is coloured by builder, with a legend, when more than one player built there. The colours are the eight the map uses for guilds, now in `src/lib/categorical.ts`.
- **4c. Durability audit.** "Worn gear" in the Bases rail: every item at or under a share of its full durability (a slider, 25% by default), worst first, each with its container. Exportable.
- **4d. Show item hits on the map.** An expanded search result has a "Show on map" row. The map marks each container holding the item, sized by how much, and a row above the layers names the item and clears it. It is carried as `item=` in the Map's link rather than as a layer, so it survives a tab switch.

Where this departs from the plan as written:

- **Fullness is stacks held, not a share of capacity.** `Container.slotCount` equals `usedSlots` for all 4,599 containers in the reference save: the save lists only occupied slots, so there is no capacity to divide by.
- **"Workers present against the roster" became workers needing care.** The save has the roster but nothing that says who is present, so the health block counts the sick, hungry, hurt and low on sanity among it, using `conditions()`.
- **The marks are not a layer.** A mark is a second sprite over the structure's own, and clicking it selects that structure, so there are no new entities and nothing new in `l=`.

Not seen in the reference save, which has no damaged structure inside a base: the "list" link beside a non-zero damaged count.

---

## Phase 5 — Map

Done, apart from 5f, which stays optional.

- **5a. Controls.** Zoom buttons beside Fit; the map is a tab stop with arrow keys to pan and `+`/`-` to zoom; all, none and invert for the layers; the Dungeons row is hidden while it counts zero.
- **5b. Input.** A press that moves more than 4 px before release is a drag and selects nothing. Search matches a marker's owner (a pal's owner, a structure's builder, a base's guild) and a container's contents, and says which.
- **5c. Guild markers.** On the pins layer, named for the guild and who placed them. The Guild tab's marker chips open the map on them, which closes 2d.
- **5d. Pals layer follows the Pals filter.** `filteredPalIds` in `src/views/pals/filter.ts` reads the Pals tab's link from the store and the controller hides the pals it leaves out. The row reads "9 of 3,292 · following the Pals filter" with a "clear" that takes the filter off on the Pals tab too, keeping its sort and its open pal.
- **5e. Colour by guild.** Bases, their radius, player-built structures and guild markers. Offered only when the save has more than one guild; the reference save has one, so this was checked by setting `by=guild` in the link and not with a second guild's colours side by side.

Found on the way:

- The map's tiles were stacked coarsest on top, so once the fitted view had loaded, zooming in never got sharper.
- A pal, player or guild marker in the World Tree had a "show on the map" link that opened the map only for it to say the thing was not on it. `MapJump` shows those coordinates as text marked "World Tree" instead.
- A selection made from the search box never drew the ring; only a click on the canvas did. The ring was also sized in map pixels, a speck when fitted and enormous zoomed in.

### 5f. Incremental index update — M, optional

`MapController.setIndex(index)` that diffs pals and players by id and updates sprites in place, so a player-save merge does not rebuild ~2,800 sprites. Only worth it if 0b's viewport restore is not enough in practice.

---

## Phase 6 — Guild

Done.

- **6a. Contribution board.** `Table` takes a plain value per cell (`sort.keys`) and its headings become buttons; `sortOrder` and `nextSort` in `src/lib/sortRows.ts` are the testable half. Summary's Progression table uses it. Guild has a board under the player cards: member, role, level, last seen, built, pals, then the player-save columns, opening with whoever has been away longest on top. `builtBy(index)` in `guild.ts` is worked out once per save and used by `playerSummary`, the board and `PlayerDetailPanel`; the summaries are memoised in `GuildView`.
- **6b. Base triage.** "Needs attention" lists each base with a damaged structure or an ailing worker, the workers by name with what is wrong. The base opens in Bases, the damaged count opens it narrowed to damaged (`basesLink` in `src/views/bases/params.ts`), a worker opens in Pals.
- **6c. Empty states.** A guild with no pals shows the Roster heading and says so; the paldex panel says when there is no member to measure.
- **6d. Work coverage.** `workCoverage` gives `best` and `atBest` beside the sum. The radar draws the best level and a list under it gives the level and how many pals are at it.
- **6e. Paldex.** The fraction counts only species with a paldex number. Alpha-held and lucky-held bars. A search box, "missing only" and "breedable only". A cell the player holds is a button that opens those pals; one they can breed is a link to the Breed plan, badged with its generations; anything else is inert. The reach comes from the Breed view's own cache with its default settings, so the badge and the plan agree.

Where this departs from the plan as written:

- **Last seen sorts on the uptime clock for everyone.** It is the one clock every member has. Mixing it with the dates player saves give would order two different things against each other.
- **Locked chests are not in the triage.** A lock is a choice, not a fault. The Bases overview still counts them.
- **A species with no paldex number is shown only when the player has it.** The reference data has 450 of them, mostly bosses and humans, and greying them all out under the real paldex was most of the grid. The member bars drop from "of 753" to "of 303" for the same reason.
- **Work coverage no longer counts a bonus toward a job the species is known not to do**, the rule `workLevel` follows. Without reference data nothing is known about any species, and the bonuses alone still fill the chart.

Not seen in the reference save: the damaged link in the triage (no base has a damaged structure) and the two empty states (the guild has pals and members).

---

## Phase 7 — Breed

Done. 7d and 7e went with the utility tray.

- **7a. Sex in the egg estimate.** `applyGender` in `src/domain/breeding.ts` runs over a finished step list. An egg that must come out one sex, because it is paired with a held pal that exists in one sex only or with another bred pal, counts as two hatches; one then paired with its own kind counts as three. The step that pays is the one that makes the egg, and it carries `gender` saying why and for which later step. `BreedingPlan.expectedEggs` includes it and `genderEggs` is that share, so a species-only plan can show a hatch count too.
- **7b. Child IV forecast.** `src/domain/ivForecast.ts`. Pick a pair shows each parent's IVs, the mean of a hatch, and the chance of matching the better parent, per stat and for all three. A plan shows the mean IVs of each step, carried down through eggs that do not exist yet, which is exact because the mean is linear in the parents' values. Among pals equal on IV total, `ownedNode` now prefers one that is not sick or hurt, then the one with more souls in it.
- **7c. Borrow list.** "Who to ask" under the steps, one line per owner, with "Copy as text". `borrowGroups` and `borrowText` in `src/views/breed/ownerText.ts`.
- **7f. Species list filters.** Element, reachable, not held, nearest first, in the link as `le`, `lr`, `ln` and `ls` and stripped from a saved path. `filterSpecies` in `src/views/breed/speciesFilter.ts`. The element pips are now `src/components/ElementToggles.tsx`, used by Pals, the species list, the pair picker and the Builds opponent list.
- **7g. Egg and incubation.** Spiked and stopped: the mirror has no egg size or incubation time for a species. What was checked is in `SOURCES.md`.

Where this departs from the plan as written:

- **The cost of sex lands on the step that makes the egg, not on the self-pair step.** The plan said a self-pair step's hatches "roughly double". Nothing extra is hatched at the step that uses the pair; it is the step before it that has to be run until it has given a male and a female, and that is three good hatches on average, not two. The old "needs both genders" pill sat on the wrong step and is gone.
- **Two bred parents of different species cost a hatch too.** The plan named self-pairs and single-sex stock. Any pair of bred pals has to differ in sex, so the cheaper of the two is counted twice.
- **Sex corrects the estimate and not the route.** The search still minimises eggs and passive odds. Putting sex in the search would multiply its state space to change a route that rarely changes.
- **The IV weights are 3:2:1, from the game's files.** The rest of the model is `tylercamp/palcalc`'s reading of about 190 hatches, and the 0 to 100 range for a fresh roll is this project's assumption. Both screens say it is a model.
- **"Sum of per-stat ranks" was read as the four soul ranks.** They do not pass down, so they come after health and only break a tie.
- **Builds and the pair picker get the element filter only.** Reach and "not held" are about what can be bred; an opponent is met and the picker lists pals already held.

Not checked by hand: "Copy as text" (the headless browser has no clipboard, as with Copy link), and the hatch estimate on a plan with passives selected, which is covered by `applyGender`'s unit test.

---

## Phase 8 — Builds

Done. 8c went with the utility tray, and 8b was removed before any of this: partner skills are typed effects, scored for the fishing, food, cake and ranch purposes, and shown in the species hover card on every row.

- **8a. Make the footnote true.** `rank` is the condenser stars; `rankAttack`, `rankHp`, `rankDefence` and `rankCraftSpeed` are soul enhancements, a different thing the original item ran together. `ownedFighters` breaks ties on level, condenser rank, attack and health souls, then attack IV; `ownedWorkers` on work-speed souls, then condenser rank. The footnote names all four and `recommend.test.ts` pins each tie-break.
- **8d. Pool the guild.** The "also count" controls from Breed, under the same link keys (`gp`, `gb`, `gm`), from the same `stockFor` with no breeding table. The picker is now `src/views/breed/PoolPicker.tsx`. A pal that is not the selected player's is tagged with whose it is, and `breedHref` carries the pool across.
- **8e. Fight improvements.** `opponentPool` adds tower and raid bosses to the opponent list. `OwnedFighter.learnedMoves` flags a strong move that is learned and not equipped, from `learnedNotEquipped` in `palState.ts`, which the Pals drawer now uses too. "Longer lists" in the rail raises every list from 5 and 3 to 12 and 8 (`more=1`).
- **8f. Party loadout.** `partyAdvice` and `mountGaps` in `recommend.ts`; `src/views/builds/Party.tsx`. Fight shows who stays and who to swap for whom, with a reason taken from `FIGHT_ORDER`, the same list the ranking sorts by. Travel shows, per kind of mount, whether the fastest on offer is carried.
- **8g. Condense.** A ninth purpose. `condensePlan` in `src/domain/condense.ts`: for each species held more than once, the one to keep and the rest, with any duplicate that already has stars or souls called out.

Where this departs from the plan as written:

- **The opponent pool is not "every species with a paldex number".** That set is 303 against the breeding table's 304 and adds oil-rig and quest variants, not bosses. Tower and raid bosses have no paldex number; they are found by their `gym_` and `raid_` ids, one per name and element set. Alphas and rampaging pals are left out: 371 rows that repeat the ordinary species.
- **"Show more" is one switch for the tab, not a control per list.** There are a dozen lists on a page, and one that is longer than the rest is rarely what is wanted.
- **The party strip keeps the party's size.** It pairs off who is carried against the same number from the top of the ranking and does not fill empty slots.
- **Condense counts only the selected player's own pals**, whatever is ticked under "also count", and says nothing about how far the duplicates go. The cost of a star is not in the game data this app reads.

Found on the way:

- **Condenser stars were one too many everywhere.** The save's `Rank` counts from one, so a one-star pal read "★2" and a finished one "★5". `condenserStars` in `palText.ts` converts, and the CSV's `condenser_rank` column now holds stars.

Not seen in the reference save: a "not equipped" flag on a fighter (none of the players' top fighters has an unused strong move), and the party strip without a player save.

---

## Phase 9 — Shell

Done.

- **9a. Sample world.** `pnpm sample` writes `public/demo/sample.json` from `test/fixtures/level.mini.json` through `buildIndexes`. `loadSample` in `src/store/sample.ts` fetches it and goes straight to `buildSaveIndex`. `SaveState.isSample` keeps it from being offered for remembering or written to storage, and the header says "sample" where the file name goes. `sample.test.ts` fails when the committed file has fallen behind the fixture, and the leak guard walks `public/demo/`.
- **9b. Settings dialog.** `src/app/Settings.tsx`: the session toggle, "Forget this save", "Forget saved paths" and the cache button, moved from About; the tab to open on, whether the tray is docked and the map's starting layers, kept by `src/store/prefs.ts`; and a game data block with the upstream ref, `SLIM_VERSION`, when the cached copy was fetched (a `meta@…` record beside the data) and a Refresh that awaits the fetch and reports the outcome.
- **9c. Palette.** Recents, shown when the box is empty. Actions: settings, add files, load another, copy link, toggle the tray, toggle each map layer, clear cached game data, forget the kept save. New things to find: species nobody holds (to Breed), structures and storage by name, fast-travel points, passives (to the tray's cheat sheet), saved breeding paths. Pals are ranked by match then level, by `rankPals` in `src/app/paletteSearch.ts`.
- **9d. Parse screen.** The GVAS read reports bytes done about fifty times over the file (`FArchiveReader.onProgress`), the worker's progress message carries `done` and `total`, and the bar fills. Cancel terminates the worker and returns to the drop zone.

Where this departs from the plan as written:

- **A preference seeds a view and never changes what a link means.** The plan had Settings hold "the map's default layer set". Changing the codec's defaults would make a link with no `l=` show different layers to different people. So the preference is applied only to a map that has no link state yet, and those layers then appear in the link.
- **About is inside Settings, not beside it.** A ninth header button pushed "Load another" off the edge at 1280 wide.
- **Only the read phase has a determinate bar.** The plan asked for decompress as well. Oodle decompression is one call into the decoder with nothing to report until it returns, so it keeps the pulse.
- **No "export current view" action.** Each view builds its own export from its own state; there is nothing global for the palette to call.
- **"Containers by name" is the storage half of structures.** A container has no name but its structure's, so one group covers both, the player's own and fullest first.
- **Recents are per open save and in memory.** They name pals and players, which is not something to put in `localStorage` for a convenience.

Found on the way:

- **A jump to something in the view already open did nothing.** A view reads its focus once, as it mounts. `uiStore.jumpSeq` counts jumps and the shell keys the view on it. This was true of ⌘K from the start, not only of the new results.

Worth knowing about the sample: it is the fixture as committed, so it shows that fixture's fourteen guild markers and one base at their real coordinates. The leak guard passes, since positions are not identifiers, but they are places from the save the fixture was cut from.

---

## Implementation order

1. ~~**The utility tray**~~, done. It took 0c, 0d, 1g, 1h, 2f, 7d, 7e and 8c with it.
2. ~~**8a**~~, done.
3. ~~**What is left of Phase 1**~~, done.
4. ~~**0a and 0e, then Phase 2**~~, done. ~~**Phase 3**~~, done.
5. ~~**0b and 0f, then Phase 5** (5a–5e)~~, done. ~~**Phase 4**~~, done. ~~**Phase 6**~~, done. ~~**Phase 7**~~ and ~~**Phase 8**~~, done. Each phase is independently shippable.
6. ~~**Phase 9**~~, done.
7. Then the two items left on `docs/improvements.md`: ~~`PalWorldSettings.ini`~~, done, and save comparison. The notice channel (0c) and settings dialog (9b) give the latter a place to live.

## Verification

Every commit: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:golden`. The golden project is not only for `src/parse/`: the guard that fails when an identifier from a real save reaches a committed file lives there, and new test files are exactly what it is for.

There are no component tests, and the committed fixtures are JSON the app no longer loads. So each phase is checked by hand in the running app: copy a save from `data/` to a scratch directory outside the repo, run `pnpm dev`, load it, and walk the changed views. Specific checks:

- 0b: switch Map → Pals → Map; zoom, layers and selection survive. Paste the hash into a fresh load; the same viewport appears.
- 0d: open About, press `3`: nothing happens. Open a pal drawer, press Escape: it closes and focus returns to the card.
- 0e: export a container; the `where` column reads the display name. Type a landmark name into ⌘K; the base appears.
- 2x: every link listed lands on the right entity with the right view state, and its hover card still opens.
- 3a: a pal in a worker roster shows "Base N workers" and the link opens that base. Work levels in the drawer match Builds for the same pal.
- 5d: set an element filter in Pals; the map's Pals layer shows only those.
- 7a: a self-pair route's expected hatches rise.
- 8a: a unit test fails if the rank tie-break is removed.
- 9a: a fresh profile clicks "Try a sample world" and lands on the map with no network beyond refdata.

New unit tests, all with synthetic ids: map params codec; `names.ts` resolvers; pals codec; `palFilter.ts` against the fixture; gender factor and IV forecast in `breeding.test.ts`; rank tie-breaks in `recommend.test.ts`; `builtByPlayer` and best-level work coverage in `guild.test.ts`; paldex denominator in a new `paldex.test.ts`; the combobox key reducer.
