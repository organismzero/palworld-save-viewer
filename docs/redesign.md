# Redesign: field survey terminal → the game's own UI

## Context

`.claude/skills/palworld-save-viewer-design/` is a complete design system for this app in a new visual language: dark translucent glass panels over the world, hairline edges with corner tick marks, sheared tabs, one cyan signal colour and one selection blue, HUD meters, square inventory cells. It ships 35 framework-free components, seven token files, 15 foundation cards and an interactive recreation of the landing screen plus all six views (`ui_kits/save-viewer/index.html`).

The UI kit only renders over HTTP — it fetches its `.jsx` files with XHR, which `file://` blocks — so `python3 -m http.server` from the skill root and open `/ui_kits/save-viewer/index.html`.

**What changes:** every surface treatment. Colour, type, spacing, edges, depth, motion, and the shape of the header, rails and drawers.

**What does not change:** the information architecture, the six views and their panes, the domain vocabulary, the copy, the data rules, the store, the worker, the virtualiser, and anything under `src/parse/`. No new dependencies.

## Decisions

Thirteen places where the system and the codebase disagreed. All are settled; each entry records the choice and what follows from it.

1. **Fonts — vendor the files.** The system loads Titillium Web and JetBrains Mono from Google Fonts (`tokens/fonts.css`). This app deliberately self-hosts (`src/main.tsx`: _"the premise of this app is that nothing leaves your machine"_), and a CDN request on every cold load would also break the "second visit needs no network at all" claim. Both families are SIL OFL 1.1, so they ship as `.woff2` under `src/fonts/` with local `@font-face` rules and an entry in `SOURCES.md`.

2. **Glass everywhere, as the system writes it.** `Panel` sets `backdrop-filter: blur(14px) saturate(115%)` by default — including Summary's dozen panels and every card in the Pals grid. The `solid` opt-out stays on the component for anything that later needs it. This is the one decision with a cost attached: blur is a composited layer per panel, and the Pals grid mounts ~40 of them at a time while scrolling. Stages 5 and 8 carry an explicit scroll-performance check, and if it bites, the fix is per-surface `solid`, not a token change.

3. **Pal cards show IV bars and a bare HP number.** The kit fakes its HP meter by passing `hp` as both value and max, which is why every card in the screenshots reads `1299/1299`. Pal records carry `hp` and no maximum (`src/domain/types.ts`), so a meter would need an invented denominator. Structures _do_ record `hpCurrent`/`hpMax`, so `Meter` is honest in `StructureDetail`, and player XP has a real denominator whenever `expTable` has loaded (`levelProgress`).

4. **IV bars are a single signal cyan.** Not the element hues the system uses (`--pw-el-grass`/`-electric`/`-fire`), which would couple two unrelated data scales, and not today's four-step threshold ramp either. Three bars, length carries everything, one accent — the strictest reading of "one UI accent". `ivColor` in `primitives.tsx` goes away. The item durability bar is unaffected: wear genuinely is a good/warning/bad scale and keeps status colours (`--color-hp` / `--color-stamina` / `--color-danger`).

5. **Component signatures stay ours where they carry domain logic.** The system's `ItemSlot` takes flat props, `GameIcon` takes `src`, `ExportMenu` takes `count` + `onExport`. Ours keep `contents: SlotContents`, `path`, and `rows` + `columns`, because they resolve against `refdata`, memo icon failures per URL, and guarantee CSV/JSON equivalence from one column list. We adopt the visuals, not the signatures.

6. **`Panel`'s API is additive.** `title` / `action` / `ticks` / `solid` / `padded` join the existing signature, with `padded` defaulting to `false` so the ~20 call sites that pass their own padding keep working.

7. **Full tab semantics, everywhere.** `role="tablist"` / `role="tab"` / `aria-selected` on the view switcher as the system writes it — which means doing it properly: the view container gets `role="tabpanel"` with an id, each tab gets `aria-controls`, and the strip gets roving `tabindex` and arrow-key navigation, since a tablist that ignores arrow keys is a worse lie than a nav was. The 1–6 number shortcuts stay exactly as they are. `PlayerDetailPanel`'s overview/paldex pair becomes `SegmentBar`, also with real semantics.

8. **The footer prompt bar prints only keys that work.** Globally: `⌘K Search`, `1–6 Switch view`, `? Shortcuts`, and `Esc Close` when something is open.

9. **The map's prompt row is `F Filter · R Snap to base`.** `F` toggles the layer panel — which is already the game's filter panel, and the kit titles it "Filter" — so that key needs only wiring. `R` keeps the game's wording and gets real behaviour: centre and zoom on the base nearest the viewport centre, repeated presses cycling outward through the rest, which is a small addition on top of the existing `controller.focus()`. `E Marker` is dropped: the viewer never writes to a save, so there is no marker to place.

10. **11px type floor, heights re-measured.** All 23 sub-11px DOM sites go to 11px, then `CARD_HEIGHT` (168) and `ROW_HEIGHT` (40) are re-measured against real content rather than guessed. Explicit exception: the radar's `fontSize={8}` axis labels stay as they are — 11px axis text overlaps at the current chart size, and growing the chart is a layout change for a different day. Noted in the component rather than left to be rediscovered.

11. **Line tokens bake their own alpha; the modifiers go.** As the system defines them (`rgba(158,205,222,0.22)` and friends). 56 of the 108 `var(--color-line)` call sites carry an opacity modifier (`/60` ×35, `/40` ×15, `/30` ×4, plus a `/50` and a `/70`) which would otherwise multiply hairlines into invisibility, so they are stripped in the same commit — `/40` and `/30` becoming `--color-line-faint`. Mechanical, no judgement calls, and stage 1 looks right the moment it lands.

12. **Namespaced tokens in `@theme`, everything else in `:root`.** `--color-*`, `--font-*`, `--text-*`, `--radius-*`, `--tracking-*`, `--blur-*`, `--shadow-*`, `--ease-*` and `--animate-*` go in `@theme` so utilities generate. `--space-*`, `--weight-*`, `--edge-*`, `--sheen-panel`, `--tick-*`, `--glow-*`, `--dur-*` and the fixed measures go in a plain `:root` below it — they are not Tailwind namespaces, and one of them is actively dangerous inside one: `--spacing-*` _is_ a namespace, so naming the spacing steps `--spacing-6` would silently redefine `p-6` from 24px to 16px across the whole app. Two token-file bugs get fixed on the way in: `--type-data` references an undefined `--weight-500`, and `--weight-*` collides with Tailwind's `--font-weight-*` if ported literally.

13. **Global utility overrides accepted.** `--ease-out` and `--leading-normal` in `@theme` redefine every `ease-out` and `leading-normal` utility in the app to the system's values (`cubic-bezier(0.2,0.7,0.3,1)` and `1.45`). That is what a design system is for; it is a change that shows up everywhere at once, including in code nobody revisited.

14. **The skill folder stays untracked.** `.claude/` is added to the eslint ignores, `.prettierignore` and `.gitignore`, so `pnpm lint` passes, `pnpm format` leaves it alone, and it can never be staged by accident. Consequence worth knowing: this document references files that only exist on your machine, so anyone else reviewing a stage is reviewing it against the screenshots and this text.

## Verification, every stage

There are no component tests (`test/` is domain-only), so `pnpm test` will stay green no matter what the UI does. The real guard is:

```sh
pnpm lint && pnpm typecheck && pnpm test    # must pass before each merge
pnpm dev                                    # then drop test/fixtures/level.mini.json
```

`test/fixtures/level.mini.json` is a redacted, committed Level.json subset, so every view can be driven and screenshotted with no real save present. Compare each screen against its counterpart in `ui_kits/save-viewer/`. Three things to check on every stage: it still renders with reference data unavailable (degraded mode, monogram tiles, raw ids), nothing below 11px crept back in, and — for the stages that add glass over scrolling content — the Pals grid still scrolls smoothly.

## The stages

Each stage is independently mergeable and leaves the app coherent. Stages 5–9 touch one view each and can be reordered or split.

### Stage 0 — unblock the toolchain

**Landed.** _Files:_ `eslint.config.js`, `.prettierignore`, `.gitignore`

Add `.claude` to all three. Ends with `pnpm lint` passing for the first time since the skill landed (it had been failing on the design system's own `ElementBadge.d.ts`).

### Stage 1 — tokens

**Landed.** _Files:_ `src/index.css`, `src/main.tsx`, `src/fonts/` (new), `SOURCES.md`, `package.json`

Vendor Titillium Web and JetBrains Mono as `.woff2` with local `@font-face` rules, replacing the three `@fontsource-variable` imports in `main.tsx`. Record the substitution in `SOURCES.md`.

Landed as: Titillium Web 200/400/600/700 and the JetBrains Mono variable cut, `latin` and `latin-ext` each — ten files, 160 KB. Titillium 300 is not included because nothing uses it, no italics because nothing in the product is italic, and mono needs only the one variable file per subset. The three now-unused `@fontsource-variable` packages were removed from `package.json` rather than left installed.

Two notes on what was not ported. The package's `--type-*` composites are `font:` shorthands, which reset every font property they omit — including the `tabular-nums` that `.num` exists to set — so type is said with utilities plus `.num` and `.label`, as this codebase already does. `--blur-panel` lands as a bare `14px` because Tailwind's namespace wants a length; the `saturate(115%)` half of the system's value belongs on the component in stage 2.

Replace the `@theme` block per decision 12. In `@theme`: `--color-*` for ground, lines, ink, accents, status, rarity and the nine element hues; `--font-display|ui|mono`; `--text-2xs … --text-title`; `--radius-slot|control|panel`; `--tracking-title|label`; `--blur-panel`; `--shadow-modal`; `--ease-out|in-out|snap`; `--animate-pulse-dot`. In `:root`: `--space-*`, `--slot-size`, `--slot-gap`, `--row-height`, `--tab-height`, `--panel-pad`, `--rail-width`, `--detail-width`, `--header-height`, `--edge-raised|sunken|panel`, `--sheen-panel`, `--tick-size|color`, `--glow-signal|select`, `--dur-*`, `--weight-*`.

The element hues transfer 1:1 — all nine of the system's `--pw-el-*` values are identical to the current `--color-el-*`, so `src/lib/color.ts` needs no change at all.

Also here: keep `--color-surface` and `--font-sans` as aliases so nothing breaks mid-migration (removed in stage 10); redefine `.num` and `.label` (`.label` moves from Martian Mono to Titillium 600 / 11px / 0.09em — one intended change visible at 355 call sites); set the body's single wide radial from `#123243` to `#04090e`; focus ring to 1px at 2px offset; add the `pw-pulse` and `pw-panel-in` keyframes; keep the existing `prefers-reduced-motion` block, which is already the system's rule with a better comment.

Then the line-token sweep from decision 11: 56 modifier strips, `/40` and `/30` to `--color-line-faint`.

### Stage 2 — the primitives

**Landed.** _Files:_ `src/components/primitives.tsx`, `src/index.css`, and two knock-on edits in `src/views/guild/GuildView.tsx` and `src/app/SaveSummary.tsx`

Rewritten against `components/core/` and `components/data/`, keeping every export name and signature so no call site changed:

`Panel` (+ `PanelTitleBar`; additive props per decision 6; glass by default per decision 2) · `SectionHeading` · `StatTile` · `ElementBadge` · `IVBar` (square 3px bars, single signal cyan, `ivColor` deleted) · `PassiveChip` · `MonogramTile` · `RawId` · `Pill` (+ `danger` tone) · `OnlineDot` (`animate-ping` → the slow pulse, which is also cheaper) · `Table` (restyled as the system's `DataTable`: micro-label head, mono columns, optional row selection).

New here, because several views hand-roll them: `Meter`, `Field`, `KeyHint`.

**`CornerTicks` is a CSS utility, not a component.** The package draws the four marks as four child spans, which does not survive contact with this codebase: children land inside the `divide-y` that six Panel call sites already pass, and five extra DOM nodes per panel is real money in a grid of a thousand cards. `.corner-ticks` in `index.css` draws all four from eight background layers on one pseudo-element at `z-index: -1`, which is the same paint order. `.panel-sheen` does the gloss the same way. Colour is overridable per surface with `[--tick-color:…]`, which is what selected `MenuButton`s will want in stage 3.

Two knock-ons, both forced and both small. Adding `danger` to `PillTone` broke `GuildView`'s `RING_TONES`, which is an exhaustive `Record<PillTone, string>` — it gains a `danger` entry, and its other three tones move from raw oklch literals onto the tokens, which is what its own comment ("the same tones as `Pill`") already promised. And `StatTile` now carries its own hairline, so the two grids in `SaveSummary` that faked tile borders with `gap-px` over a line-coloured background become plain `gap-2` — otherwise every separator was 3px of stacked border.

Also worth recording: **`SaveSummary.tsx` was missing from this plan entirely.** It is the Summary view but lives in `src/app/`, so it fell between the shell and the views. It is folded into stage 4, which already touches every other file in that directory. Stage 2 leaves it 90% right for free, since it is almost nothing but primitives.

### Stage 3 — the controls

**Landed.** _Files:_ `src/components/controls.tsx` (new), `src/components/ExportMenu.tsx`, `src/app/Dialogs.tsx`, `src/index.css`, `src/lib/utils.ts`

The controls the views currently write inline become named components: `Button` (tones `default|signal|primary|danger|ghost`, sizes `sm|md|lg`, `keyHint`, `icon`) · `IconButton` · `TextInput` · `Checkbox` · `SelectControl` · `RangeControl` · `TabBar` · `SegmentBar` · `MenuButton` · `ListRow` · `Modal` · `ConfirmDialog`.

`TabBar` and `SegmentBar` carry the ARIA wiring from decision 7 — roving `tabindex`, arrow keys, `aria-controls` — so the shell and the player panel both get it from one place.

`Modal` wraps the existing `<dialog>` rather than replacing it: Escape, backdrop click and focus containment come free from the platform, where the system's version re-implements all three on a `<div>`. It gains the scrim blur, corner ticks and outboard `×`.

`ExportMenu` is restyled in place, keeping its `rows` + `columns` API.

Additive apart from `ExportMenu` and `Dialogs.tsx`, which drops its private `Modal` for the shared one — so this stage is cheap to review and unblocks 4–9.

Landed with four notes. **Manual activation** on both tab strips: arrows and Home/End move focus, and only Enter, Space or a click selects, because automatic activation would mount the Pixi map chunk on the way past it. **`tabId` lives in `lib/utils.ts`**, not beside `TabBar`, because exporting a function from a component module costs a `react-refresh` warning and this repo has none. **`ListRow` is a real `<button>`** when clickable rather than the package's `<div role="button">`, which no keyboard can reach; **`Checkbox` drives a styled span from a hidden input** through `peer-*`, since its tick is a `✓` character and pseudo-elements on a replaced element are not worth betting a checkbox on.

Two bugs the throwaway render caught, both invisible to typecheck. The modal's close cross did not appear at all: the UA stylesheet sets `dialog { overflow: auto }`, which clips a child floating above the frame, so the dialog is now explicitly `overflow-visible`. And the entrance animation had to move to `dialog[open]` in `index.css` — on a class it would fire once at mount rather than on every open, because `display: none` → `block` is what restarts an animation.

**`ConfirmDialog` is deliberately absent.** The package defines it because the game asks before it acts; nothing in this app asks. _Forget this save_ and _Clear cached game data_ both act immediately, and adding a confirmation step is a behaviour change rather than a restyling. It is fifteen lines on top of `Modal` if a surface ever needs one.

### Stage 4 — the shell

**Landed.** _Files:_ `src/App.tsx`, `src/app/AppShell.tsx`, `DropZone.tsx`, `Dialogs.tsx`, `CommandPalette.tsx`, `Diagnostics.tsx`, `ErrorBoundary.tsx`, `SaveSummary.tsx`, `src/components/primitives.tsx`, and a one-line height change in each of the five views

52px header on the dark bar, wordmark in Titillium 200 uppercase tracked, sheared tab strip on `TabBar` with the full tab/tabpanel wiring, and Search / About / Load another lifted onto `Button`. The keep-this-save bar moves onto `Button`s. A footer `PromptBar` appears with the global keys from decision 8 — new furniture, not a restyle.

Landing screen: `ScreenTitle` for the wordmark, the drop target as a dashed frame with corner ticks and a cyan edge while dragging, the three buttons and the reopen affordance as `Button`s, the save-location `<details>` restyled.

Dialogs and the command palette move onto `Modal` and the sunken-input treatment; the diagnostics popover becomes a `Panel` with its amber/green badge reading exactly as it does today.

The `h-[calc(100dvh-3.25rem)]` in five views is tied to the 52px header. It becomes a token here so the views stop hard-coding it and the footer bar's height is accounted for once.

`SaveSummary.tsx` is the Summary view and belongs here rather than with the other views, because it sits in `src/app/` with the rest of the shell. Stage 2 already gave it its stat tiles, tables and panels; what is left is its header, the "Load another" button, the `rounded-[10px]` wrappers and a handful of raw oklch literals in the diagnostics list.

Landed with three things worth recording.

**The shell became a real fixed-height flex column** (`h-dvh`, `main` at `min-h-0 flex-1`), so the five views dropped `h-[calc(100dvh-3.25rem)]` for `h-full` — one line each, and the reason the keep-this-save bar no longer pushes the layout past the fold. That immediately exposed a bug: `SaveSummary` had always relied on the _document_ scrolling, so under a fixed shell it was clipped at the fold. It now scrolls itself, which is what every other view already did.

**`ScreenTitle` and `PromptBar` joined `primitives.tsx`** rather than being written inline in the landing screen and the shell. `ScreenTitle` uppercases in CSS, so the copy stays sentence case.

**The tab wiring was verified in the browser, not just typechecked**: the panel's `aria-labelledby` resolves to the selected tab, roving `tabindex` leaves exactly one tab in the page's tab order, and `ArrowRight` moves focus to the next tab while the selection and the hash both stay put until Enter. The `Esc` prompt appears in the footer only while something is open — confirmed by counting the keycaps in the row with the palette open and closed. (Watch out when checking that by hand: `ShortcutsDialog` is a permanently mounted `<dialog>`, so its ten keycaps are always in the DOM.)

### Stage 5 — Pals

**Landed.** _Files:_ `src/views/pals/PalsView.tsx`

Filter rail at `--rail-width` on `TextInput` / element pip toggles / `RangeControl` / `SelectControl` / `Checkbox`, with `ExportMenu` still at its foot. Card grid onto the system's `PalCard` shape — element wash from the bottom-left corner, icon top-right, `Lv.` prefix on the name row, IV bars, badge row — with HP as a bare number per decision 3. The local `Field` and `Range` are gone in favour of the primitives. The virtualiser, params codec and hash sync are untouched.

**The glass checkpoint came out moot**, which is worth knowing before stage 8 worries about it: the design system's own `PalCard` is a _tinted button_, not a blurred `Panel` — translucent, hairline, raised edge, no `backdrop-filter` anywhere. A DOM sweep of the scroll container confirms 0 of 263 elements filter their backdrop. Decision 2's cost only ever lands on real `Panel`s, and the grid contains none.

**`CARD_HEIGHT` and `CARD_MIN_WIDTH` were measured, not guessed.** Freed of grid stretch, the new card wants 96–131px depending on nickname and passive count, so 148 (a 136px box after the 12px gutter) fits the tallest with slack and puts about a seventh more cards on screen than the old 168. The minimum width went 210 → 230, set by the one row that cannot compress: 72px of IV bars, the IV total and two element pips.

Two fixes the render forced. The owner was truncating to a single letter beside three badges, so it moved onto the species line — both are secondary metadata, and that line was empty for any pal without a nickname. And the column count was being recomputed in the grid's `onScroll`, so opening the 340px detail drawer took a third of the width away without firing a scroll event and squeezed every card until you happened to scroll; a `ResizeObserver` on the scroll container covers both that and a window resize.

### Stage 6 — Bases

**Landed.** _Files:_ `src/views/bases/BasesView.tsx`, `ContainerGrid.tsx`, `BasePlan.tsx`, `src/components/ItemSlot.tsx`

The three-pane explorer, **reproportioned to the design system's own layout**: the rail keeps its width, the structure list becomes a fixed 300px column, and the detail pane takes everything left so the item grid and the contents table can sit side by side as the kit draws them. Rail rows are `ListRow`s inside titled panels and keep all three of their mono sub-lines. `ItemSlot` goes to 52px cells on the `--slot-gap` gutter with 3px radius, rarity in the frame, a sunken well behind the art, wear bar and passive dot kept. Global item search onto `TextInput` with a `Checkbox`, its results overlaying the detail pane at 560px because three columns of information do not fit in a 300px column. `GameIcon` needed no change at all — its lazy load and per-URL failure memo are untouched, and stage 2 had already restyled the monogram it falls back to.

`StructureDetail` gains the one honest `Meter` in the app: a structure records `hpCurrent` and `hpMax`, so condition is a bar with a real denominator rather than an invented one.

**The base plan moved into the detail pane** as its resting state. It used to be a 288px column beside the structure list, and the new proportions leave no room for a fourth pane — but as the pane's default it has space to be read, gains the base's facts as a `Field` list, and every dot is still a shortcut into its structure. `BasePlan`'s raw oklch literals became tokens on the way, since it is now the first thing you see in a base rather than a thumbnail.

Two duplications the render exposed, both of them the same mistake — saying something twice because two components each thought they owned it. The structure header and the nested container header both named the container and its base, so `ContainerGrid`'s `title` became optional and `StructureDetail` passes neither. And condition appeared as a `Field` row _and_ as the new meter directly beneath it; the row is gone and the meter's label carries the percentage, which is the part a bar cannot say.

`ROW_HEIGHT` stays at 40 rather than dropping to the system's 34: these rows carry two lines, a name and a position, where the system's 34px row carries one.

The two capacity notes and the attribution copy stay verbatim.

### Stage 7 — Guild

**Landed.** _Files:_ `src/views/guild/GuildView.tsx`, `PlayerDetailPanel.tsx`, `Paldex.tsx`, `src/components/charts.tsx`

Stat tiles, player cards with real XP meters, element distribution, and the roster panels. The guild picker and the system-groups toggle move onto `SelectControl` and `Checkbox`; every aggregate `Panel` takes `padded` instead of its own classes.

**Player XP is a real `Meter`** — tone `xp`, no printed value — but only when `levelProgress` has the levelling curve to divide by. Without it the card still prints the raw figure, because that is all the save knows.

Charts keep their hand-rolled SVG and pick up the tokens. Their bars and the histogram lose `rounded-full` and `rounded-t`, because a squared bar is the system's rule and only a floating HUD meter is a pill; the progress ring drops its round stroke cap for the same reason. The radar axis keeps `fontSize={8}` with decision 10's reasoning written next to it, so it reads as a decision rather than an oversight.

`PlayerDetailPanel` narrows to `--detail-width`, drops its private `Field`, and its tab pair becomes a `SegmentBar` with the same real semantics as the view strip — verified by watching the panel's `aria-labelledby` follow the selection from `player-tab-overview` to `player-tab-paldex`. Paldex cells become square slots in a sunken well, with the lucky ring turned into a signal border and glow.

**The 11px floor is now complete outside stage 9**: the last sub-11px sites in this view (the ring's `sub`, the member monograms, a status figure, a level in the best-pals list) are all raised, leaving only `PlanSteps.tsx` for the Breed stage.

### Stage 8 — Map

**Landed.** _Files:_ `src/views/map/MapView.tsx`, `src/views/map/MapController.ts`

Search, layer filter, hover card, selection card and the loading and degraded notices are all glass `Panel`s — the one place the system's blur is unarguable, since the world genuinely is behind them. The map area itself becomes a framed screen: inset by 8px, hairline, four corner ticks. The layer list becomes a `Panel` titled **Filter** with `Checkbox` rows and counts, which is what it always was — the game's own name for that panel, and the reason `F` had somewhere to go.

Two new keys per decision 9. `F` opens and closes the filter panel. `R` centres a base: the nearest one to what you are looking at on the first press, then the next in world order on each press after. That rule is deliberate — "nearest to wherever I just moved you" ping-pongs between two bases, where "nearest, then next" is predictable and eventually visits all of them. Both are guarded by the same `isTyping` check the global shortcuts use, so typing "for" in the map's search box does not close the panel and jump the world; verified by typing into the box and watching nothing move.

The prompts and the coordinate readout share one dark bar on the frame's bottom edge. That is not decoration: they sit directly on map art, which is warm, bright and unpredictable, and bare text over it was unreadable at the first zoom I tried.

`MapController` keeps its own numeric colour table because Pixi needs numbers, but the four chrome values are now named constants matching the tokens — `GROUND` at `--color-void`, the grid and its edge in the line family over that ground, `SELECTION` at signal cyan — with a comment saying they are kept in step by hand. The nine layer colours are left alone: they are a data palette chosen for distinguishability, not chrome. `entitiesOfKind` is the one new line of API, so the view can ask for the bases without duplicating the coordinate transform.

### Stage 9 — Breed

**Landed.** _Files:_ `src/views/breed/BreedView.tsx`, `PlanSteps.tsx`

Two rails onto the new controls, `StockPanel` onto `Field` rows, the species list onto `ListRow` with its depth pills, step rows and the tree onto padded `Panel`s. The two "off by default" toggles — pooling the guild, and counting pals whose gender the save does not record — become `Checkbox`es with their full explanations intact, because those sentences are the reason the toggles are off. The tied-route buttons become `Button tone="signal"` for the active one, which is the same selected-versus-not language as everything else.

The footnote and every "why there is no route" paragraph are verbatim. They are the most load-bearing copy in the app and the redesign has no opinion about them.

`PlanSteps` held the last two sub-11px sites in the codebase, so **the 11px floor is now complete**: `grep` for `text-[10px]` or `text-[9px]` across `src/` returns nothing.

### Stage 10 — cleanup

_Files:_ `src/index.css`, sweep across `src/`, `README.md`

Drop the `--color-surface` / `--font-sans` aliases and `.raised-edge` if `--edge-raised` has replaced it. Grep for stragglers: `rounded-[10px]`, `rounded-[6px]`, `rounded-[4px]`, raw `oklch(…)` literals in views that should be tokens, any surviving sub-11px DOM type. Update the README's design-system paragraph.
