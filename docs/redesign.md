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

_Files:_ `src/components/primitives.tsx`

Rewrite against `components/core/` and `components/data/`, keeping every export name and signature so no call site changes:

`Panel` (+ `CornerTicks`, `PanelTitleBar`; additive props per decision 6; glass by default per decision 2) · `SectionHeading` · `StatTile` · `ElementBadge` · `IVBar` (square 3px bars, single signal cyan, `ivColor` deleted) · `PassiveChip` · `MonogramTile` · `RawId` · `Pill` (+ `danger` tone) · `OnlineDot` (`animate-ping` → the slow pulse, which is also cheaper) · `Table` (restyled as the system's `DataTable`: micro-label head, mono columns, optional row selection).

New here, because several views hand-roll them: `Meter`, `Field`, `KeyHint`.

Visible immediately in Summary and Guild, which are almost entirely primitives.

### Stage 3 — the controls

_Files:_ `src/components/controls.tsx` (new), `src/components/ExportMenu.tsx`

The controls the views currently write inline become named components: `Button` (tones `default|signal|primary|danger|ghost`, sizes `sm|md|lg`, `keyHint`, `icon`) · `IconButton` · `TextInput` · `Checkbox` · `SelectControl` · `RangeControl` · `TabBar` · `SegmentBar` · `MenuButton` · `ListRow` · `Modal` · `ConfirmDialog`.

`TabBar` and `SegmentBar` carry the ARIA wiring from decision 7 — roving `tabindex`, arrow keys, `aria-controls` — so the shell and the player panel both get it from one place.

`Modal` wraps the existing `<dialog>` rather than replacing it: Escape, backdrop click and focus containment come free from the platform, where the system's version re-implements all three on a `<div>`. It gains the scrim blur, corner ticks and outboard `×`.

`ExportMenu` is restyled in place, keeping its `rows` + `columns` API.

Additive apart from `ExportMenu`, so this stage is cheap to review and unblocks 4–9.

### Stage 4 — the shell

_Files:_ `src/App.tsx`, `src/app/AppShell.tsx`, `DropZone.tsx`, `Dialogs.tsx`, `CommandPalette.tsx`, `Diagnostics.tsx`, `ErrorBoundary.tsx`

52px header on the dark bar, wordmark in Titillium 200 uppercase tracked, sheared tab strip on `TabBar` with the full tab/tabpanel wiring, and Search / About / Load another lifted onto `Button`. The keep-this-save bar moves onto `Button`s. A footer `PromptBar` appears with the global keys from decision 8 — new furniture, not a restyle.

Landing screen: `ScreenTitle` for the wordmark, the drop target as a dashed frame with corner ticks and a cyan edge while dragging, the three buttons and the reopen affordance as `Button`s, the save-location `<details>` restyled.

Dialogs and the command palette move onto `Modal` and the sunken-input treatment; the diagnostics popover becomes a `Panel` with its amber/green badge reading exactly as it does today.

The `h-[calc(100dvh-3.25rem)]` in five views is tied to the 52px header. It becomes a token here so the views stop hard-coding it and the footer bar's height is accounted for once.

### Stage 5 — Pals

_Files:_ `src/views/pals/PalsView.tsx`

Filter rail at `--rail-width` on `TextInput` / element pip toggles / `RangeControl` / `SelectControl` / `Checkbox`, with `ExportMenu` still at its foot. Card grid onto the system's `PalCard` shape — element wash from the bottom-left corner, monogram or icon top-right, IV bars, badge row — with HP as a bare number per decision 3. `CARD_HEIGHT` re-measured after the 11px floor lands. The virtualiser, params codec and hash sync are untouched.

**Glass checkpoint.** This is the stage where decision 2 gets tested: ~40 blurred panels mounted and recycled while scrolling 1,400 cards. Measure before merging; if it drags, the pal card takes `solid` and everything else keeps its blur.

### Stage 6 — Bases

_Files:_ `src/views/bases/BasesView.tsx`, `ContainerGrid.tsx`, `src/components/ItemSlot.tsx`, `src/components/GameIcon.tsx`

The three-pane explorer. Source rail onto `MenuButton`, structure and orphan rows onto `ListRow` (34px, selection as the blue fade), group headers as the pale title strip. `ItemSlot` to 52px cells on a 4px gutter with 3px radius, rarity in the frame, sunken well behind the art, wear bar and passive dot kept. Global item search onto `TextInput` with results in a glass `Panel`. `GameIcon` keeps its lazy load and per-URL failure memo untouched — only the fallback tile's styling changes. `StructureDetail` gains a real `Meter` for condition, which is the one place HP has a genuine maximum.

The two capacity notes and the attribution copy stay verbatim.

### Stage 7 — Guild

_Files:_ `src/views/guild/GuildView.tsx`, `PlayerDetailPanel.tsx`, `Paldex.tsx`, `src/components/charts.tsx`

Stat tiles, player cards with real XP meters, element distribution, and the roster panels. Charts keep their hand-rolled SVG and pick up the new line and signal tokens; the radar axis keeps `fontSize={8}` with the comment from decision 10. `PlayerDetailPanel`'s tab pair becomes `SegmentBar`. Paldex cells become square slots with the lucky ring and the alpha mark.

### Stage 8 — Map

_Files:_ `src/views/map/MapView.tsx`, `src/views/map/MapController.ts`

Search, layer filter, hover card and selection card all become glass `Panel`s — the one place the system's blur is unarguable. The map area gets the framed treatment with corner ticks, the coordinate readout top-left and the degraded-mode notice top-right. The layer list becomes a `Panel` titled **Filter** with `Checkbox` rows and counts.

Two new keys per decision 9: `F` toggles that panel, `R` centres and zooms on the base nearest the viewport centre and cycles outward on repeat presses. Both land in the map's `PromptBar` row as `F Filter · R Snap to base`.

`MapController` holds its own numeric colour table for Pixi (`0x0a0d12` background, `0x1e293b`/`0x334155` grid, `0x22d3ee` selection, and a nine-element hex table duplicating `lib/color.ts`). Those move to the new ground, signal and select values, or the canvas and the chrome disagree. Contained change, no behavioural surface.

### Stage 9 — Breed

_Files:_ `src/views/breed/BreedView.tsx`, `PlanSteps.tsx`

Two rails onto the new controls, `StockPanel` onto `Field` rows, the species list onto `ListRow` with its depth pills, step rows onto `Panel` with the `→` route glyph. The footnote and every "why there is no route" paragraph stay verbatim — they are the most load-bearing copy in the app.

### Stage 10 — cleanup

_Files:_ `src/index.css`, sweep across `src/`, `README.md`

Drop the `--color-surface` / `--font-sans` aliases and `.raised-edge` if `--edge-raised` has replaced it. Grep for stragglers: `rounded-[10px]`, `rounded-[6px]`, `rounded-[4px]`, raw `oklch(…)` literals in views that should be tokens, any surviving sub-11px DOM type. Update the README's design-system paragraph.
