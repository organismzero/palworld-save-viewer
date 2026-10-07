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

### 0b. Map params codec — M

Map is the only view with no `params.ts`, so it forgets zoom, layers, fog and selection on every tab switch and cannot be linked to.

- New `src/views/map/params.ts` with `MapParams { layers: Set<LayerId>; fog: boolean; fogOpacity: number; zoom?: number; mx?: number; my?: number; selected?: { layer: LayerId; id: string }; query: string }` and `mapCodec()`. Layers encode as a list of ids (`l=players,bases`), the viewport as three rounded numbers, the selection as `sel=pals:<shortId>`.
- Replace the `useState` cluster in `MapView` with `useViewParams(mapCodec, ...)`.
- Wire `onView` (currently `() => {}`) to publish zoom and centre; the controller already emits them from `emitView`, and `useHashSync` already throttles param writes to 400 ms.
- On mount, after `controller.mount()`, apply `visible`, fog and viewport, then resolve `selected` through the controller's entity index and `focus()` it.
- Consume the new `map` focus kind here: `focus(entity)` after mount.
- Player-save merge currently rebuilds the controller; with the viewport in params the rebuild restores where the user was, which is enough. A true incremental update is a separate item (5f).

Tests: `test/unit/mapParams.test.ts` round-trip, defaults omitted, unknown layer ids dropped, malformed numbers ignored.

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

### 0f. Combobox hook — S

Three typeaheads are lists of buttons with no keyboard or ARIA: item search (`ItemSearch` in `BasesView`), map search (`MapView`, silently limited to 8 by the controller), passive picker (`PassivePicker`, silently sliced to 40). Add `useCombobox({ items, onPick })` to `controls.tsx` returning input props (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, Arrow/Enter/Escape handlers) and option props (`role="option"`, ids). Close on click outside. Each caller also renders a "showing N of M" line when a limit truncated results, with a "show more" that raises the limit.

Tests: Testing Library and jsdom are dev dependencies but no vitest project runs in jsdom, and the repo has no component tests. Keep the key handling in a pure reducer (`comboboxKey(state, key)`) and test that in the node project.

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

Done, except the two pieces that wait on other items. `Jump` in `src/components/Jump.tsx` is a button that calls `jump(view, focus)` and still raises the hover card of whatever it names. It has a `quiet` form for names inside list rows, where the text keeps its own colour and only the arrow is in the accent.

- **2a. Pal drawer.** Owner opens the player in Guild, position shows the pal on the Map, and under the species name are `breed →` (a real link into Breed) and `fight →` (Builds, Fight, against that species). The **Where** row is 3a's and its link goes in with it.
- **2b. Map selection card.** "Open in Pals", "Open in Guild" or "Open in Bases" by what is selected. Landmarks, dungeons and pins get none.
- **2c. Breed and Builds.** A step's parent pal and a borrowed parent's owner are links, as are the owned-pal rows in Builds. The "owned" pill opens Pals on that species for that player.
- **2d. Guild.** The player panel's bases, best pals and position are links. The marker chips wait on 5c, which plots them.
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

### 4a. Item detail columns — S

The slot's hover card is keyboard-reachable and already shows durability against `ItemInfo.durability`, ammo against `magazine`, and item passives; empty slots are already unfocusable. What remains is the tabular half: the contents table in `ContainerGrid` gains durability and ammo columns, and so do `CONTAINER_COLUMNS` and `ITEM_HIT_COLUMNS`.

### 4b. Bases filters and base overview — M

- Structure list filters: builder (select from players who built here), damaged, locked; sort by fullness (`usedSlots` against `slotGridSize`'s floor, with the existing honesty caveat).
- `BaseOverview` names the owning guild, camp level and coordinates together, and adds a **health** block: structures damaged (`hpCurrent < hpMax`, computed inline twice today; extract it), locked chests, workers present against the roster.
- `BasePlan` dots tinted per builder with a legend, colours from the neutral categorical ramp (never element hues).

### 4c. Durability audit — S

A "Wear" section in the Bases rail under Elsewhere: every `DynamicItem` with durability under a threshold slider, with its container location via `containerLocation()`, sorted worst first, with a jump to the container. Exportable.

### 4d. Show item hits on the map — S

Item search results gain a "Show on map" button that jumps to Map with a new transient `hits` layer: one marker per container that holds the item, sized by count, resolved through `structureByContainer` → `Structure.pos`. The layer is cleared by the next search or by its own layer toggle.

---

## Phase 5 — Map

### 5a. Controls — S

Zoom in and out buttons beside Fit; `tabIndex={0}` on the host with arrow keys panning and `+`/`-` zooming; layer panel gains all, none and invert; the Dungeons row is removed from the panel while its count is zero by design (README Limitations) rather than shown as a permanently empty layer.

### 5b. Input polish — S

- Drag threshold: a `pointerup` within 4 px of `pointerdown` is a click; otherwise not. Today a separate `click` listener always selects.
- Search matches owner name and container contents, not only the label, and uses the combobox hook.

The map's own tooltip was replaced by the shared hover card, which already flips and shifts to stay in the viewport, so the clamp fix is gone.

### 5c. Plot guild markers — S

`Guild.markers` are listed as text and never drawn; `buildMarkers()` draws only `LocalData` pins. Add them to the `markers` layer with the guild's tint and the owner's name as `sub`. Guild view's marker chips then jump to them.

### 5d. Pals layer driven by the Pals filter — M

Read `uiStore.viewParams.pals`, decode with `palsCodec(index)`, compute the same filtered set the Pals view shows (extract the filter from `PalsView` into `src/domain/palFilter.ts` so both use one function), and pass the id set to `controller.setPalFilter(ids)`. The layer row reads "Pals · 41 of 1,204 (filtered)" with a "clear" link. Nothing changes when no filter is set.

### 5e. Colour by guild — S

A mode toggle on the structures and bases layers: tint by `groupId` with a legend of guild names. Multi-guild dedicated servers become readable.

### 5f. Incremental index update — M, optional

`MapController.setIndex(index)` that diffs pals and players by id and updates sprites in place, so a player-save merge does not rebuild ~2,800 sprites. Only worth it if 0b's viewport restore is not enough in practice.

---

## Phase 6 — Guild

### 6a. Contribution board — M

Summary's Progression table already shows the `PlayerRecord` columns (caught, bosses, crafted, condensed and more), fixed-sorted by pals caught, for every player in the save. `Table` has no sorting. So:

- Add sorting to `Table` (a `sort` prop and clickable headers), and turn it on in Summary.
- In Guild, a board under the player cards scoped to the guild: member, role, level, last seen, structures built, pals owned, then the same `PlayerRecord` columns. Cells without a player save show "—" with the existing "add player saves" hint. Default sort last seen. This answers "who is inactive and what did they leave behind".

Precompute `builtByPlayer: Map<Guid, number>` once per index in `guild.ts` and use it from `playerSummary` and `PlayerDetailPanel`, both of which scan every structure per player per render today. Memoise the summaries in `GuildView`.

### 6b. Base triage — M

Per base: damaged structures, locked chests, and pals in the worker roster that are sick, dying, starving or depressed, from the same fields as 3b. Rendered as a compact list with jumps to Bases and Pals. Shown in Guild because it is the "what needs doing" view; the Bases overview (4b) shows the structure half for one base.

### 6c. Empty states — S

`Aggregates` and `PaldexRollup` in `GuildView` return `null`. Render the section heading with "no pals in this guild yet" and "no paldex progress without player saves".

### 6d. Work coverage — S

`workCoverage` in `guild.ts` sums suitability levels, which says four level-one miners equal one level-four. Show best level per job as the primary figure and the count of pals at that level as the hint; keep the sum out of the radar.

### 6e. Paldex — M

- Denominator counts only species with a `zukan` number; variants without one are shown but not counted.
- Alpha and lucky sub-bars from `PaldexCell.alpha`/`lucky`.
- Filters: missing only, breedable only. Search box.
- Cells become focusable buttons that keep their hover card. Owned → Pals with `{kind:'species'}`; missing and breedable → Breed via `breedHref`, with the generation count as the badge (`reachFrom().depth`, computed once per player).

---

## Phase 7 — Breed

### 7a. Gender in the egg estimate — M

The per-step "needs both genders" pill already ships, from `step.selfPair`. The arithmetic does not: `expectedEggs` is passive-only. Add a gender factor: a self-pair step needs both sexes from its own hatches, so its expected hatches roughly double; a step whose parent species is in `Stock.singleGender` for the needed sex is flagged "only males held" or "only females held". Fold both into the plan total. The plan footnote's gender sentence is rewritten to state the arithmetic rather than say "expect more".

Tests: `breeding.test.ts` cases for a self-pair route and a single-gender stock, asserting the factor against the passive-only figure.

### 7b. Child IV forecast — M

Start in Pick-a-pair, where both parents are concrete: from their `ivHp/ivAttack/ivDefense`, show an expected and best-case band for the egg, labelled as a model with its assumption stated. `PairPane`'s footnote, `pairOutcomes.ts` and the README all say IVs are not predicted and must change with it.

Then per plan step. Parent choice in `ownedNode` already prefers own pals, then the higher IV total; add a tie-break on the sum of per-stat ranks and on health (`sickness`, `physicalHealth` absent first). This only affects species-only plans: with passives selected, the search pins the parent.

### 7c. Borrow list — S

`BreedingPlan.borrowed` shows today as a count pill, a summary sentence and a pill on each borrowed parent. Add a list grouped by owner: "ask Waffle for Foxparks ♀ and Gumoss ♂", with a "copy as text" button, so the pooled plan is something you can paste to a guildmate.

### 7d. Plan tracker — M **(tray)**

Per-step "done" checkboxes. The original key, `psv.plans.<fileName>.<target>`, cannot work: every save is named `Level.sav` and a save carries no world identity. Ticks live on a saved breeding path instead, keyed by the step's child species and parent pair, since step numbers shift as the plan shortens. When a later save loads, `BreedStep.progress` re-matches what is held and the tracker reconciles: a step whose `meets` is true is shown done regardless, and ticks for steps no longer in the plan are dropped. The footnote asking the user to "save and reload after each generation" is replaced by a line naming which steps the current save already satisfies.

### 7e. Search feedback — S **(tray)**

`PassiveHeader` prints a static sentence while the search runs. Show elapsed time from the `ms` `usePassiveSearch` already captures and nothing displays, a cancel button that terminates the worker, and a visible banner when `truncated` is set rather than a clause in the footnote.

### 7f. Species list filters — S

Element, reachable only, not yet owned, sort by generations (`reach.depth`). Same controls on the Builds opponent list. The Pick-a-pair pal picker lists pals rather than species; it gets the element filter only.

### 7g. Egg and incubation — spike

Refdata carries no egg size or incubation time. Check whether the PalworldSaveTools mirror exposes them; if so add a projection and show the egg size per step and the wall-clock cost with and without incubation passives. If not, record that in SOURCES.md and stop.

---

## Phase 8 — Builds

### 8a. Make the footnote true — done

The Fight footnote said level, IVs and condensing order your pals, and only `ownedPartners` read a rank field. `rank` is the condenser stars; `rankAttack`, `rankHp`, `rankDefence` and `rankCraftSpeed` are soul enhancements, a different thing the original item ran together. `ownedFighters` now breaks ties on level, condenser rank, attack and health souls, then attack IV; `ownedWorkers` on work-speed souls, then condenser rank. `ownedMounts` is unchanged, since nothing in the save makes the same mount faster. The footnote names all four, and `recommend.test.ts` pins each tie-break.

### 8c. Element chart — S **(tray)**

Draw `typeChart.BEATS` as the matrix it is, with the selected player's element coverage from `elementDistribution` overlaid as counts per row. It lives in the utility tray as a reference tab rather than under Fight, so it is reachable from every view. The ×2 and ×0.5 assumption the footnote warns about becomes inspectable.

### 8d. Pool the guild — S

Builds reads one player's pals. Add the "also from" toggle Breed has, reusing `buildStock`'s `includeMembers`, and mark borrowed rows with the owner's name.

### 8e. Fight improvements — M

- Opponent pool: every species with a `zukan` number, not only breedable ones (`speciesPool` uses the breeding table and falls back to zukan only when that failed to load), so tower bosses and alphas that do not breed appear.
- `masteredWaza` read for owned fighters: a strong skill the pal already knows but has not equipped is flagged "learned, not equipped". The Pals drawer already derives this list; share the function.
- Show more on the `TOP`/`MINE` caps in `buildsText.ts`.

### 8f. Party loadout — M

Under Fight and Travel, a "your party now" strip from `PlayerDetail.otomoContainerId` via `locator()`, compared against the recommendation: which slots the advice would change and why.

### 8g. Condense goal — M

A ninth purpose, **Condense**: for each species held more than once, the best instance to keep (by IV total, passives, ranks) and the duplicates that would feed it, with the rank fields shown. Uses `palsByCharacterId` and the per-stat condensing fields, which today appear only in the CSV export. Rows jump to Pals.

8b (show partner skills on species rows) is removed: partner skills are now typed effects, scored for the fishing, food, cake and ranch purposes, and shown in the species hover card on every row.

---

## Phase 9 — Shell

### 9a. Sample world — M

The app no longer accepts `.json`, and the redacted player fixture was deleted, so fetching fixtures into `acceptFiles` cannot work. Instead ship a redacted `SlimPayload` as `public/demo/sample.json`, generated by a script from `test/fixtures/level.mini.json`, and load it through the path `restoreSession()` already uses: `buildSaveIndex(payload)` straight into the store, no parser. A "Try a sample world" link under the drop zone fetches it. The header shows "sample" beside the filename and the remember offer is suppressed. Costs nothing to anyone who does not click. The leak guard must cover `public/demo/`.

### 9b. Settings dialog — M

Move the session toggle, the cache button and "Forget saved paths" out of About into a Settings dialog opened from the header and the palette. Add: default view, whether the utility tray opens pinned, a **game data** line (PST ref, `SLIM_VERSION`, cached-at timestamp stored in the IDB meta record, and a Refresh button calling `ensure(true)`), and the map's default layer set. Theme and name language are deliberately not offered: the design is dark by construction (`docs/redesign.md`) and the refdata source is English only; say so in the dialog rather than leave the absence unexplained.

### 9c. Palette — M

- Recents: the last eight jumps, kept in memory for the session, shown when the query is empty.
- Actions: load another, add files, copy link, toggle the utility tray, export current view, forget this save, clear cached game data, toggle each map layer, open settings.
- Entities: structures by display name, fast-travel points, containers by name, species not owned (jump to Breed), saved breeding paths (open the path), passives (open the tray's cheat sheet at that passive).
- Pal results ranked by match quality then level, instead of the first six in array order.
- Base labels via `baseLabel()`.

### 9d. Parse screen — S

A cancel button that terminates the worker and returns to the drop zone. The phase label is already real. A determinate bar needs byte counts added to the worker's progress message, which today carries only a phase and a label; add them for the decompress and read phases and keep the strip indeterminate otherwise. Under reduced motion the indeterminate state shows the phase text alone. This one touches `src/parse/worker/`.

---

## Implementation order

1. ~~**The utility tray**~~, done. It took 0c, 0d, 1g, 1h, 2f, 7d, 7e and 8c with it.
2. ~~**8a**~~, done.
3. ~~**What is left of Phase 1**~~, done.
4. ~~**0a and 0e, then Phase 2**~~, done. ~~**Phase 3**~~, done.
5. **0b and 0f, then Phase 5** (5a–5e), **Phase 4**, **Phase 6**, **Phase 7**, remaining **Phase 8**, in that order. Each phase is independently shippable.
6. **Phase 9** last, except 9a, which can go any time after Phase 1 and is worth doing early for the project's front page.
7. Then the two items left on `docs/improvements.md`: `PalWorldSettings.ini` and save comparison. The notice channel (0c) and settings dialog (9b) give the latter a place to live.

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
