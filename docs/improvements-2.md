# Cross-view links, surfacing parsed data, and honest recommendations

## Context

A review on 2026-09-19 ran the app headless over the committed fixtures,
screenshotted every tab, and read every view and the shell. Everything in
`docs/improvements.md` is shipped except `PalWorldSettings.ini` and save
comparison; those two stay on that document and are not re-planned here.

What the review found falls into four kinds of work:

1. **Finished features that are invisible or slightly wrong.** Deep links exist
   but nothing offers to copy one. Focus jumps exist but only the palette uses
   them. Exports and the palette print names the views already resolve better.
   Keyboard shortcuts fire behind open dialogs. Two views say "reference data
   unavailable" during a normal load.
2. **Data the parser already produces that no view shows.** Pal hunger, sanity,
   friendship, health, current work, experience, per-stat condensing ranks,
   learned moves, storage location; item durability and ammo beyond a tooltip;
   guild map markers; player records outside the Summary tables.
3. **Recommendations that claim more than they compute.** Builds says condensing
   orders your pals and never reads a rank field. Breed prices passives
   precisely and gender not at all.
4. **Complementary features** that reuse existing selectors: map layers driven
   by the Pals filter, item hits plotted on the map, a guild contribution board,
   a base triage list, a condense advisor, a plan tracker, a sample world.

Phone-width layout is explicitly out of scope: save files cannot be loaded from
a phone. Desktop keyboard and accessibility work is in scope.

The three constraints from the previous document still bind: privacy is
load-bearing, `signal` is the only UI accent, and the app says what it does not
know rather than guessing. One more is added here:

- **A recommendation's footnote must describe what the code does.** Where the
  two disagree, either the code grows to match or the footnote shrinks. Never
  the reverse.

Sizes below are S (an hour or two), M (half a day to a day), L (several days).
Every item names the files it touches so the phases can be split into PRs.

---

## Phase 0 — Shared plumbing

Nothing user-visible on its own, but every later phase leans on it. Do first,
in one PR or two.

### 0a. Widen `Focus` — S

`src/store/uiStore.ts:18` has five focus kinds. Add:

```ts
| { kind: 'structure'; id: Guid }              // Bases: locate() already routes it
| { kind: 'map'; layer: LayerId; id: string }  // Map: controller.focus(entity)
| { kind: 'species'; id: string }              // Pals: filter to one species
| { kind: 'fight'; species: string }           // Builds: open Fight with an opponent
```

`LayerId` lives in `MapController.ts:40`; move the type to
`src/views/map/layers.ts` so `uiStore` does not import Pixi-adjacent code.
Consumers: `BasesView.tsx:141` (add `structure` beside `container`),
`MapView.tsx` (new, see 0b), `PalsView.tsx:83` (`species` sets `query` to the
species name and no `selectedId`), `BuildsView.tsx:119` (`fight` seeds goal
and opponent). The Guild comment at `GuildView.tsx:376` about a positional
focus member is resolved by the `map` kind.

### 0b. Map params codec — M

Map is the only view with no `params.ts`, so it forgets zoom, layers, fog and
selection on every tab switch (`MapView.tsx:72-92`) and cannot be linked to.

- New `src/views/map/params.ts` with `MapParams { layers: Set<LayerId>; fog:
boolean; fogOpacity: number; zoom?: number; mx?: number; my?: number;
selected?: { layer: LayerId; id: string }; query: string }` and `mapCodec()`.
  Layers encode as a list of ids (`l=players,bases`), the viewport as three
  rounded numbers, the selection as `sel=pals:<shortId>`.
- Replace the `useState` cluster with `useViewParams(mapCodec, ...)`.
- Wire `onView` (currently `() => {}` at `MapView.tsx:111`) to publish zoom and
  centre; `useHashSync` already throttles param writes to 400 ms.
- On mount, after `controller.mount()`, apply `visible`, fog and viewport, then
  resolve `selected` through the controller's entity index and `focus()` it.
- Consume the new `map` focus kind here: `focus(entity)` after mount.
- Player-save merge currently rebuilds the controller (`MapView.tsx:100-122`);
  with the viewport in params the rebuild restores where the user was, which is
  enough. A true incremental update is a separate item (5f).

Tests: `test/unit/mapParams.test.ts` round-trip, defaults omitted, unknown
layer ids dropped, malformed numbers ignored.

### 0c. Notice channel — S

There is no way to tell the user something happened without a dialog. Add to
`uiStore`: `notices: Notice[]`, `notify(text, { tone?: 'info' | 'warn';
ttl?: number })`, `dismiss(id)`. Render `<Notices/>` in `AppShell` above the
footer: a stack of hairline panels, `role="status" aria-live="polite"`, auto
dismissed after the ttl, click to dismiss. Reduced motion: no slide, just
appear.

First callers: rejected files while a world is open
(`saveStore.ts:662-673`), "N player saves merged", "export saved as …"
(`ExportMenu.tsx:39`), quota flip (`session.ts:174-178`, which today
reverses the user's consent silently), refdata degraded on any view.

### 0d. Escape stack and modal-aware shortcuts — S

- `useShortcuts` (`AppShell.tsx:186`) returns early when
  `paletteOpen || aboutOpen || shortcutsOpen`, except for ⌘K when only the
  palette is open (so it can toggle). This fixes digits switching views under a
  dialog and ⌘K opening the palette behind the native `<dialog>` top layer.
- Add `escapeStack` to `uiStore`: `pushEscape(fn): () => void`. A
  `useEscape(active, onClose)` hook registers while a drawer is open. The global
  handler calls the top of the stack on Escape when no modal is open. Register
  it in the pal drawer (`PalsView.tsx:563`), player panel
  (`PlayerDetailPanel.tsx:81`), container grid (`ContainerGrid.tsx:74`), map
  selection card (`MapView.tsx:456`), passive picker overlay, diagnostics
  popover (replace its own listener at `Diagnostics.tsx:35`).
- The footer's `Esc Close` prompt (`AppShell.tsx:510-519`) shows whenever the
  stack is non-empty or a modal is open.
- `useDrawerFocus(ref, open)`: on open, focus the drawer's first heading or
  close button; on close, return focus to `document.activeElement` at open
  time. Apply to the same four drawers. Give each drawer `role="region"` and an
  `aria-label`.

### 0e. Shared name resolvers — S

`BasesView.tsx:293-298` holds working `nameOfStructure` and `nameOfBase`
closures; `exportRows.ts:115-116,167-168` stub them to the asset id and the
literal `Base`; `CommandPalette.tsx:177` matches `Base ${i + 1}`. Extract
`src/domain/names.ts`:

```ts
structureName(refdata, s: Structure): string
baseName(index, refdata, base: Base, i: number): string   // uses nearestLandmark
speciesName(refdata, characterId): string
skillName(refdata, wazaTail): string
```

Use them from Bases, exports, palette, Builds and Breed. Exports then read
"Wooden Chest" and "Base 3 · near Sea Breeze Archipelago", and typing a
landmark into ⌘K finds the base.

Tests: extend `export.test.ts` to assert the `where` column for a fixture
container is the structure's display name.

### 0f. Combobox hook — S

Three typeaheads are divs of buttons with no keyboard or ARIA: item search
(`BasesView.tsx:1106-1188`), map search (`MapView.tsx:287-308`), passive picker
(`PassivePicker.tsx:596-656`). Add `useCombobox({ items, onPick })` to
`controls.tsx` returning input props (`role="combobox"`, `aria-expanded`,
`aria-activedescendant`, Arrow/Enter/Escape handlers) and option props
(`role="option"`, ids). Close on click outside. Each caller also renders a
"showing N of M" line when a limit truncated results, with a "show more" that
raises the limit.

### 0g. README shortcut table — S

`README.md:79` says `1`–`5`. The app binds `1`–`7`.

---

## Phase 1 — Small correctness fixes

Each is a few lines. One PR.

| #   | Fix                                                                                                                                                                                                                                                                                                                                                                                       | Where                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1a  | Guild tests `data` truthiness and prints "reference data unavailable" during a normal load. Read `status === 'degraded'` like Breed and Builds.                                                                                                                                                                                                                                           | `GuildView.tsx:59,134-138`                                            |
| 1b  | Pals with an element filter shows "No pals match" while refdata loads, and `sort: 'rarity'` is a no-op. Add a loading branch and skip the element test until `data` exists.                                                                                                                                                                                                               | `PalsView.tsx:144-163,348-354`                                        |
| 1c  | Bases empty state always says "Nothing here holds items" even with storage-only off. Branch on the toggle and offer to switch it.                                                                                                                                                                                                                                                         | `BasesView.tsx:570-573`                                               |
| 1d  | Landing error copy says "Drop a converted Level.json"; the headline is raw `.sav`. Say `Level.sav` or `Level.json`.                                                                                                                                                                                                                                                                       | `saveStore.ts:683`                                                    |
| 1e  | Landing drop zone lights up for text drags and flickers over children. Check `dataTransfer.types`, set `dropEffect = 'copy'`, use the shell's depth counter.                                                                                                                                                                                                                              | `DropZone.tsx:29-33` vs `AppShell.tsx:218,242`                        |
| 1f  | Folder walk stops at 64 files silently. Emit a ledger row "stopped after 64 files" and raise the cap to 256.                                                                                                                                                                                                                                                                              | `dropEntries.ts:15-16`                                                |
| 1g  | "Load another" keeps the old world's hash params. `reset()` clears `viewParams` and the hash.                                                                                                                                                                                                                                                                                             | `saveStore.ts:574`, `AppShell.tsx:181-188`                            |
| 1h  | The remember offer says the save "comes back after a reload" but restore needs a click. Auto-restore when the pref is `on`, with a "Restoring …" status line and the drop zone still reachable via "Load another".                                                                                                                                                                        | `session.ts:217`, `App.tsx`, `DropZone.tsx:149`                       |
| 1i  | Summary never calls `ensure()`, so a deep link to `#/summary` leaves refdata cold. Call it. Add a shared `<RefdataNote/>` shown on every view in degraded mode.                                                                                                                                                                                                                           | `SaveSummary.tsx:43`, new `components/RefdataNote.tsx`                |
| 1j  | Bad `p=`/`pl=`/opponent in a URL is silently dropped. Show "no player with that id in this save" like Breed does for species.                                                                                                                                                                                                                                                             | `GuildView.tsx:92`, `BreedView.tsx:95`, `BuildsView.tsx:119,151`      |
| 1k  | Diagnostics badge ignores rejected files. Fold rejected count into `attention` and the badge text.                                                                                                                                                                                                                                                                                        | `Diagnostics.tsx:48-56`                                               |
| 1l  | Tab focus ring is clipped by the shear. Move `clipPath` to a wrapper span; the button gets an inset `box-shadow` ring on `:focus-visible`. Check `--surface-select-fill` reaches 4.5:1 for white 15 px text and darken the stops if not; drop the `opacity-75` on tab hints and `/70` on the diagnostics kind line in favour of `--color-faint`. Record the change in `docs/redesign.md`. | `controls.tsx:215-240`, `index.css:57,213-217`, `Diagnostics.tsx:144` |
| 1m  | `index.html` has no favicon, `theme-color` or Open Graph tags. Add them with a generated SVG favicon in the app's own style, no game art.                                                                                                                                                                                                                                                 | `index.html`, `public/`                                               |

---

## Phase 2 — Cross-view links

The `jump()` plumbing exists and is used only by the palette. This phase makes
every named thing clickable. One `<Jump view focus>` primitive in
`primitives.tsx` renders an inline link-styled button with the `signal` accent
and a right-arrow glyph, matching the `breed →` link Builds already draws.

### 2a. Pal drawer — S

`PalsView.tsx:600-690`:

- Owner → Guild with `{kind:'player'}`. "unowned" stays text.
- Position → Map with `{kind:'map', layer:'pals', id}`.
- New **Where** row (see 3a) → Bases with `{kind:'base'}` when it is a worker
  roster.
- Species name → Breed (`breedHref` from `buildsText.ts:106` already builds the
  URL) and → Builds Fight with `{kind:'fight'}`.

### 2b. Map selection card — S

`MapView.tsx:456-494`: by entity kind, a link to Pals (`pal`), Bases
(`container`, `structure`, `base`), Guild (`player`). Landmarks and markers get
none.

### 2c. Breed and Builds — S

- `PlanSteps.tsx:325-424` `ParentChip` becomes a `<Jump>` to Pals with the pal
  id. `BorrowedPal` owner names → Guild.
- `BuildsView.tsx:713-763` owned rows → Pals; the "owned" pill at `:670-682`
  opens the same list filtered to that species (`{kind:'species'}`).

### 2d. Guild — S

- `PlayerDetailPanel.tsx:155-170` base list → Bases; `:201-245` pals → Pals;
  position → Map.
- `GuildView.tsx:356-382` markers → Map with a positional focus (needs the
  markers plotted, item 5c). "Open map" then centres on the first marker.

### 2e. Base plan — S

`BasePlan.tsx:88-111`: `<circle>` gains `tabIndex={0}`, `role="button"`,
`aria-label` from `structureName`, Enter/Space to select, and a visible focus
ring (stroke change, not outline, since it is SVG). `<title>` uses the display
name.

### 2f. Copy link — S

A header button after Search: copies `location.href` and notifies "Link
copied". This is the only thing that makes the deep-link work discoverable.
Also offered in the palette as an action.

---

## Phase 3 — Surface what is parsed: Pals

### 3a. Drawer additions — M

`PalsView.tsx` detail aside, in this order after the existing rows:

- **Where**: resolve `containerId` through `charContainerById` →
  `ownerSlot` and `ownerBaseId` to "Party · slot 2", "Palbox", or "Base 3
  workers" (`types.ts:286-296`). Use `locator()` from `recommend.ts:525`,
  extended to return the base id and slot as well as the `Where` kind.
- **Condition**: `fullStomach`, `sanity`, `friendship` as HUD meters (existing
  meter primitive), `physicalHealth`, `sickness`, `currentWork` as text. Hide
  the block when every field is absent.
- **Experience**: a bar from `levelProgress(level, exp, table)` using
  `ExpLevel.palTotal` (`refdata.ts:233`). Guild already does this for players.
- **Condensing**: the four per-stat ranks beside the star, from
  `rankAttack/rankDefence/rankHp/rankCraftSpeed`.
- **Work suitability**: use `workLevel(data, pal, id)` (`recommend.ts:559`) so
  the per-pal bonus is included. Today the drawer shows the species baseline
  and disagrees with Builds and Guild.
- **Moves**: equipped and learned, each resolved through `refdata.skills` to
  name, element dot and power; raw tail as fallback.
- **Guild**: `groupId` resolved to the guild name.
- **HP** stays a bare number; the maximum is a formula the app does not carry.

### 3b. Card badges — S

A condition badge on the card when `physicalHealth`, `sickness`, or a hunger or
sanity value below a threshold is present: "dying", "sick", "starving",
"depressed". Thresholds are the game's own state boundaries where known,
otherwise a plain "low" with the number in the drawer.

### 3c. Filters and sorts — M

`src/views/pals/params.ts` gains: `gender`, `maxLevel`, `work: { id, min }`,
`attention: boolean`, `preset?: string`, `dir: 'asc' | 'desc'`, and `owner`
accepts two sentinel values, `none` (no owner) and `base` (worker rosters).
Sort keys add `hp`, `species`, `owner`. The rail gets the controls; the
existing `clearAll` at `PalsView.tsx:181` covers them. The preset filter reads
`LocalDataPayload.presets` (`types.ts:461`) and is shown only when client data
is loaded.

Tests: extend the pals codec tests for the new fields.

### 3d. Export columns — S

`exportRows.ts:61-87` adds IV total, elements, caught date, location, work
suitability (one column per job with the bonus applied), equipped and learned
moves, hunger, sanity, friendship, health, sickness, current work.

---

## Phase 4 — Surface what is parsed: Bases and items

### 4a. Item detail — M

`ContainerGrid.tsx:93-98` renders `ItemSlot` buttons with no handler, so a
40-slot chest is 40 dead tab stops with hover-only detail. Clicking or pressing
Enter on a slot opens a small popover anchored to it: name, count, description,
durability against `ItemInfo.durability`, ammo against `magazine`, item
passives (`DynamicItem`, `types.ts:298-305`). Empty slots are not focusable.
The contents table gains durability and ammo columns; so do
`CONTAINER_COLUMNS` and `ITEM_HIT_COLUMNS`.

### 4b. Bases filters and base overview — M

- Structure list filters: builder (select from players who built here),
  damaged, locked; sort by fullness (`usedSlots` against `slotGridSize`'s
  floor, with the existing honesty caveat).
- `BaseOverview` (`BasesView.tsx:660-692`) names the owning guild, camp level
  and coordinates together (the rail currently shows guild _or_ position), and
  adds a **health** block: structures damaged (`hpCurrent < hpMax`, computed
  inline twice today at `:742,:945`), locked chests, workers present against
  the roster.
- `BasePlan` dots tinted per builder with a legend, colours from the neutral
  categorical ramp (never element hues).

### 4c. Durability audit — S

A "Wear" section in the Bases rail under Elsewhere: every `DynamicItem` with
durability under a threshold slider, with its container location via
`containerLocation()`, sorted worst first, with a jump to the container.
Exportable.

### 4d. Show item hits on the map — S

Item search results (`BasesView.tsx:1078`) gain a "Show on map" button that
jumps to Map with a new transient `hits` layer: one marker per container that
holds the item, sized by count, resolved through `structureByContainer` →
`Structure.pos`. The layer is cleared by the next search or by its own layer
toggle.

---

## Phase 5 — Map

### 5a. Controls — S

Zoom in and out buttons beside Fit; `tabIndex={0}` on the host with arrow keys
panning and `+`/`-` zooming; layer panel gains all, none and invert; the
Dungeons row is removed from the panel while its count is zero by design
(README Limitations) rather than shown as a permanently empty layer.

### 5b. Input polish — S

- Drag threshold: a `pointerup` within 4 px of `pointerdown` is a click;
  otherwise not (`MapController.ts:707-764`).
- Tooltip clamped to the viewport (`MapView.tsx:441-453`).
- Search matches owner name and container contents, not only the label
  (`MapController.ts:875`), and uses the combobox hook.

### 5c. Plot guild markers — S

`Guild.markers` (`types.ts:172-177`) are listed as text and never drawn. Add
them to the `markers` layer with the guild's tint and the owner's name as
`sub`. Guild view's marker chips then jump to them.

### 5d. Pals layer driven by the Pals filter — M

Read `uiStore.viewParams.pals`, decode with `palsCodec(index)`, compute the
same filtered set the Pals view shows (extract the filter from `PalsView.tsx:
135-167` into `src/domain/palFilter.ts` so both use one function), and pass
the id set to `controller.setPalFilter(ids)`. The layer row reads "Pals · 41
of 1,204 (filtered)" with a "clear" link. Nothing changes when no filter is
set.

### 5e. Colour by guild — S

A mode toggle on the structures and bases layers: tint by `groupId` with a
legend of guild names. Multi-guild dedicated servers become readable.

### 5f. Incremental index update — M, optional

`MapController.setIndex(index)` that diffs pals and players by id and updates
sprites in place, so a player-save merge does not rebuild ~2,800 sprites. Only
worth it if 0b's viewport restore is not enough in practice.

---

## Phase 6 — Guild

### 6a. Contribution board — M

A sortable `Table` under the player cards: member, role, level, last seen,
structures built, pals owned, and from `PlayerRecord` when a player save is
loaded: pals caught, bosses, items crafted, pals condensed. Cells without a
player save show "—" with the existing "add player saves" hint. Sort by any
column, default last seen. This answers "who is inactive and what did they
leave behind".

Precompute `builtByPlayer: Map<Guid, number>` once per index in `guild.ts`
and use it from `playerSummary` (`guild.ts:242-245`) and
`PlayerDetailPanel.tsx:61-65`, both of which scan every structure per player
per render today. Memoise the summaries in `GuildView.tsx:436`.

### 6b. Base triage — M

Per base: damaged structures, locked chests, and pals in the worker roster that
are sick, dying, starving or depressed, from the same fields as 3b. Rendered as
a compact list with jumps to Bases and Pals. Shown in Guild because it is the
"what needs doing" view; the Bases overview (4b) shows the structure half for
one base.

### 6c. Empty states — S

`GuildView.tsx:639` and `:738` return `null`. Render the section heading with
"no pals in this guild yet" and "no paldex progress without player saves".

### 6d. Work coverage — S

`workCoverage` (`guild.ts:160`) sums suitability levels, which says four
level-one miners equal one level-four. Show best level per job as the primary
figure and the count of pals at that level as the hint; keep the sum out of
the radar.

### 6e. Paldex — M

- Denominator counts only species with a `zukan` number (`refdata.ts:64`);
  variants without one are shown but not counted.
- Alpha and lucky sub-bars from `PaldexCell.alpha`/`lucky`.
- Filters: missing only, breedable only. Search box.
- Cells become focusable buttons. Owned → Pals with `{kind:'species'}`;
  missing and breedable → Breed via `breedHref`, with the generation count as
  the badge (`reachFrom().depth`, computed once per player).

---

## Phase 7 — Breed

### 7a. Gender in the egg estimate — M

`expectedEggs` is passive-only. Add a gender factor: a self-pair step needs
both sexes from its own hatches, so its expected hatches roughly double; a step
whose parent species is in `Stock.singleGender` for the needed sex is flagged.
Surface as a per-step badge ("needs both sexes", "only males held") and fold
into the plan total. Footnote at `BreedView.tsx:1079-1085` is rewritten to
state the arithmetic rather than say "expect more".

Tests: `breeding.test.ts` cases for a self-pair route and a single-gender
stock, asserting the factor against the passive-only figure.

### 7b. Child IV forecast — M

Per step, from the chosen parents' `ivHp/ivAttack/ivDefense`, show an
expected and best-case band for the egg, labelled as a model with its
assumption stated. Parent choice at `breeding.ts:1236-1243` already prefers
the higher IV total; add a tie-break on the sum of per-stat ranks and on
health (`sickness`, `physicalHealth` absent first).

### 7c. Borrow list — S

`BreedingPlan.borrowed` grouped by owner: "ask Waffle for Foxparks ♀ and
Gumoss ♂". A "copy as text" button, so the pooled plan is something you can
paste to a guildmate.

### 7d. Plan tracker — M

Per-step "done" checkboxes persisted in `localStorage` under
`psv.plans.<fileName>.<target>`, holding only step indices and species ids.
When a later save loads, `BreedStep.progress` re-matches what is held and the
tracker reconciles: a step whose `meets` is true is shown done regardless. The
footnote asking the user to "save and reload after each generation" is
replaced by a line naming which steps the current save already satisfies.

### 7e. Search feedback — S

`BreedView.tsx:484-489` prints a static sentence. Show elapsed time from the
`ms` `usePassiveSearch.ts:90` already captures, a cancel button that
terminates the worker, and a visible banner when `truncated` is set rather
than a clause in the footnote.

### 7f. Species list filters — S

Element, reachable only, not yet owned, sort by generations (`reach.depth`).
Same controls on the Builds opponent list.

### 7g. Egg and incubation — spike

Refdata carries no egg size or incubation time. Check whether the
PalworldSaveTools mirror exposes them; if so add a projection and show the egg
size per step and the wall-clock cost with and without incubation passives. If
not, record that in SOURCES.md and stop.

---

## Phase 8 — Builds

### 8a. Make the footnote true — S

`BuildsView.tsx:1036-1039` says level, IVs and condensing order your pals.
`recommend.ts` reads no rank field. Add to the sort chains: `ownedFighters`
(`:631`) `rankAttack + rankHp` after passive score; `ownedWorkers` (`:589`)
`rankCraftSpeed` then `ivAttack`; `ownedMounts` (`:665`) level then IV total.
Tests in `recommend.test.ts` pin each tie-break.

### 8b. Partner skills — S

`SpeciesInfo.partnerSkill` is parsed and only regexed for a mount kind. Show it
on every species row as a hint line. Scoring it is out of scope: the text is
free-form.

### 8c. Element chart panel — S

Draw `typeChart.BEATS` as the matrix it is, in a collapsible panel under Fight,
with the selected player's element coverage from `elementDistribution`
overlaid as counts per row. The ×2 and ×0.5 assumption the footnote warns
about becomes inspectable.

### 8d. Pool the guild — S

Builds reads one player's pals (`BuildsView.tsx:123-126`). Add the "also from"
toggle Breed has, reusing `buildStock`'s `includeMembers`, and mark borrowed
rows with the owner's name.

### 8e. Fight improvements — M

- Opponent pool: every species with a `zukan` number, not only breedable ones
  (`recommend.ts:335`), so tower bosses and alphas that do not breed appear.
- `masteredWaza` read for owned fighters: a strong skill the pal already knows
  but has not equipped is flagged "learned, not equipped".
- Show more on the `TOP`/`MINE` caps (`BuildsView.tsx:95-96`).

### 8f. Party loadout — M

Under Fight and Travel, a "your party now" strip from
`PlayerDetail.otomoContainerId` via `locator()`, compared against the
recommendation: which slots the advice would change and why.

### 8g. Condense goal — M

A fifth purpose, **Condense**: for each species held more than once, the best
instance to keep (by IV total, passives, ranks) and the duplicates that would
feed it, with the rank fields shown. Uses `palsByCharacterId` and the seven
condensing fields the app parses and never shows. Rows jump to Pals.

---

## Phase 9 — Shell

### 9a. Sample world — M

Copy `test/fixtures/level.mini.json` and `player.mini.json` to `public/demo/`
(they are already redacted; the leak guard covers them). A "Try a sample
world" link under the drop zone fetches both and calls `acceptFiles`. The
header shows "sample" beside the filename and the remember offer is
suppressed. Costs nothing to anyone who does not click.

### 9b. Settings dialog — M

Move the session toggle and cache button out of About into a Settings dialog
opened from the header and the palette. Add: default view, a **game data**
line (PST ref, `SLIM_VERSION`, cached-at timestamp stored in the IDB meta
record, and a Refresh button calling `ensure(true)`), and the map's default
layer set. Theme and name language are deliberately not offered: the design is
dark by construction (`docs/redesign.md`) and the refdata source is English
only; say so in the dialog rather than leave the absence unexplained.

### 9c. Palette — M

- Recents: the last eight jumps, kept in memory for the session, shown when
  the query is empty.
- Actions: load another, add files, copy link, export current view, forget
  this save, clear cached game data, toggle each map layer, open settings.
- Entities: structures by display name, fast-travel points, containers by
  name, species not owned (jump to Breed).
- Pal results ranked by match quality then level, instead of the first six in
  array order (`CommandPalette.tsx:115-131`).
- Base labels via `baseName()` from 0e.

### 9d. Parse screen — S

A cancel button that terminates the worker and returns to the drop zone
(`App.tsx:35-37`). Replace the fixed pulsing strip with the real phase label
and a determinate bar where the worker reports bytes (decompress and read
phases can), indeterminate otherwise. Under reduced motion the indeterminate
state shows the phase text alone.

---

## Implementation order

1. **Phase 0** in two PRs: 0a + 0c + 0d + 0e + 0g, then 0b + 0f. Everything
   later assumes them.
2. **Phase 1** as one PR. All small, all user-visible, no design decisions
   beyond 1l.
3. **Phase 2**, then **Phase 3**. Links first because they make every later
   addition reachable; the drawer additions because they are the cheapest new
   value in the document.
4. **Phase 8a** on its own, early: it is a correctness fix to a claim the app
   makes today.
5. **Phase 4**, **Phase 5** (5a–5e), **Phase 6**, **Phase 7**, remaining
   **Phase 8**, in that order. Each phase is independently shippable.
6. **Phase 9** last, except 9a, which can go any time after Phase 1 and is
   worth doing early for the project's front page.
7. Then the two items left on `docs/improvements.md`: `PalWorldSettings.ini`
   and save comparison. The notice channel (0c) and settings dialog (9b) give
   the latter a place to live.

## Verification

Every PR: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Nothing here touches
`src/parse/`, so the golden suite is not required, but run it once after Phase
0 and once after Phase 3 because `exportRows` and `locator` read index fields
that only a real save exercises fully.

Headless walkthrough per phase with the `run-palworld-save-viewer` skill,
against the fixtures, screenshotting the changed views. Specific checks:

- 0b: switch Map → Pals → Map; zoom, layers and selection survive. Paste the
  hash into a fresh load; the same viewport appears.
- 0d: open About, press `3`: nothing happens. Open a pal drawer, press Escape:
  it closes and focus returns to the card.
- 0e: export a container; the `where` column reads the display name. Type a
  landmark name into ⌘K; the base appears.
- 2x: every link listed lands on the right entity with the right view state.
- 3a: a pal in a worker roster shows "Base N workers" and the link opens that
  base. Work levels in the drawer match Builds for the same pal.
- 5d: set an element filter in Pals; the map's Pals layer shows only those.
- 7a: a self-pair route's expected hatches rise; the badge names the step.
- 8a: a unit test fails if the rank tie-break is removed.
- 9a: a fresh profile clicks "Try a sample world" and lands on the map with
  two players and no network beyond refdata.

New unit tests, all fixture-based: map params codec; `names.ts` resolvers;
pals codec new fields; `palFilter.ts` against the fixture; gender factor and
IV forecast in `breeding.test.ts`; rank tie-breaks in `recommend.test.ts`;
`builtByPlayer` and best-level work coverage in `guild.test.ts`; paldex
denominator in a new `paldex.test.ts`; combobox hook keyboard handling with
Testing Library, which is already a dependency.
