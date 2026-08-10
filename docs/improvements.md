# Persistence, quick wins, and save comparison

## Context

Palworld Save Viewer is already a strong tool — raw `.sav` read in-browser via
WASM Oodle, a zero-copy worker boundary, five views, a deliberate design
system, and a golden-test tier with a leak guard. Reviewing it for improvement
opportunities surfaced fifteen candidates; three were selected for
implementation.

The problems being solved:

1. **Nothing survives a reload.** `saveStore` is in-memory only and
   `useHashSync` (`src/app/AppShell.tsx`) mirrors only the view id. Refreshing
   the tab throws away a parsed world, every filter and every selection — and
   there is no way to link a colleague to "this pal" or "that base".
2. **Data goes in and nothing comes out.** There is no export anywhere, no way
   to save a map image, `WorldOption.sav` is not recognised at all (so server
   rates and difficulty never contextualise the numbers shown), and paldex
   data is parsed but only partly surfaced.
3. **No sense of change over time.** Every view reports what a save *contains*.
   Server admins and long-running solo worlds want to know what *changed* —
   which no Palworld tool currently answers.

Intended outcome: the app remembers your world across a reload, hands its data
back to you in the formats you actually use, reads the one save file it was
ignoring, and can tell you what changed between two saves.

Three constraints run through everything below:

- **Privacy is load-bearing.** "Your save never leaves this machine, closing
  the tab discards everything" is in the README and on the drop zone.
  Persisting user-derived data is a change to that promise and must be opt-in
  and reversible.
- **`signal` is the only UI accent.** Element hues are data colours and must
  never be used for chrome (`src/index.css`).
- **Honesty over guessing.** The codebase consistently says what it does not
  know rather than inventing it. New features must hold that line.

---

## Feature 1 — Session persistence and real deep links

### 1a. Persistence

**What makes this cheap:** `SlimPayload` (`src/domain/types.ts`) is already the
structured-clone wire format — plain arrays with GUID cross-links, no `Map`s
and no object references, precisely so it can cross `postMessage`. That makes
it directly storable in IndexedDB, and `buildSaveIndex(payload)`
(`src/domain/index.ts`) is the same function the worker path already uses to
rebuild it. No new serialisation code is needed on either side.

**Storage.** A new `session` object store in the existing `psv` database,
bumping `openDB(DB_NAME, 1, …)` to version 2 in `src/refdata/refdata.ts` with
an `upgrade` handler that creates it. Note that `clearCache()`
(`src/refdata/refdata.ts:412`) clears the `refdata` and `assets` stores *by
name* rather than deleting the database, so a `session` store survives it —
which is the correct behaviour. "Clear cached game data" is about Pocketpair's
public art and names; the user's own world needs its own control with its own
words.

New module `src/store/session.ts`:

```ts
const SNAPSHOT_VERSION = 1   // bump on any SlimPayload shape change

interface Snapshot {
  version: number
  savedAt: number
  fileName: string
  fileBytes: number
  payload: SlimPayload
  localData?: LocalDataPayload
  playerFiles: Record<string, PlayerFileState>
}

saveSnapshot(s: Snapshot): Promise<void>
loadSnapshot(): Promise<Snapshot | undefined>   // deletes and returns undefined on version mismatch
forgetSnapshot(): Promise<void>
snapshotMeta(): Promise<{ fileName, savedAt, bytes } | undefined>
```

Single key `'current'` — one world at a time, matching the app's model.

**Consent.** The preference lives in `localStorage` under `psv.remember`, not
IndexedDB, because the drop zone must know synchronously before first paint
whether to offer a reopen, and it is a preference rather than data. Default
off.

The first-time ask is an **inline offer in the header** after a successful
parse, not a modal: "Keep this save in this browser? [Keep] [No thanks]". A
modal at the moment someone finally gets to see their world is an
interruption. Either answer is recorded and the offer never returns.

**Controls.** The About dialog (`src/app/Dialogs.tsx`) gains a "Saved sessions"
section above the existing cache section: the toggle, the snapshot's age and
size, and a **"Forget this save"** button — deliberately worded and separated
from "Clear cached game data" so the two cannot be confused.

**Reopen.** When a snapshot exists, `src/app/DropZone.tsx` shows a button above
the drop target: `Reopen Level.sav — 4 minutes ago`, using the existing
`relativeTime` and `bytes` from `src/lib/format.ts`. Restoring calls
`buildSaveIndex(snapshot.payload)` and sets `status: 'ready'` directly.

**Writing.** After `status: 'ready'` and after each player-save or `LocalData`
merge, debounced and deferred to `requestIdleCallback`. The `localData` fog
masks are `ArrayBuffer`s the main thread owns after transfer; IndexedDB clones
them rather than detaching, so they stay usable.

**Degradation — must be stated in the UI.** The worker's ~170 MB raw tree is
not persisted. A restored session therefore cannot serve the `query` protocol
message (the raw-subtree inspector) and has no `timings`. `src/app/Diagnostics.tsx`
must say "restored from this browser — raw tree not available" rather than
showing a broken inspector. Dropping a file re-parses normally.

**Files:** create `src/store/session.ts`; modify `src/refdata/refdata.ts` (DB
version + upgrade), `src/store/saveStore.ts` (write on ready, `restore()`
action, `reset()` leaves the snapshot alone), `src/app/DropZone.tsx`,
`src/app/Dialogs.tsx`, `src/app/AppShell.tsx` (the inline offer),
`src/app/Diagnostics.tsx`.

### 1b. Deep links

**Architecture is preserved:** the hash stays a *mirror* of the store, never
the source of truth. The long comment in `useHashSync` explains why, and the
command palette's need to set view and focus in one commit is unchanged.

**Format** — short, human-legible, defaults omitted so `#/pals` stays clean:

```
#/pals?q=lamball&el=fire,water&lvl=20&iv=80&sort=level&sel=a3f21b09
#/bases?src=base:9c14e0aa&st=41b0c7d2&c=7e2a1149
```

**Where the state lives.** Filters are currently local `useState` in the views
— eight hooks in `PalsView` (`query`, `elements`, `minLevel`, `minIv`, `owner`,
`flags`, `sort`, `selected`) and four in `BasesView` (`source`,
`selectedContainer`, `selectedStructure`, `query`). Having each view write to
`location.hash` itself would create multiple writers racing the shell.

Instead add a small hook, `src/app/viewParams.ts`:

```ts
useViewParams<T>(view: ViewId, defaults: T, codec: Codec<T>): [T, Setter<T>]
```

It wraps `useState`, publishes serialised params into a new `viewParams` slice
on `uiStore`, and `useHashSync` — still the single writer — folds that slice
into the hash. Views change `useState(x)` to `useViewParams(...)`; the diff
stays small and the one-writer property holds.

**Interaction with `Focus`.** `Focus` is untouched. On mount, an active
`Focus` **wins over hash params** — a ⌘K jump is an intent expressed now,
whereas the hash is history. After the view consumes focus it writes its
resulting state to the hash, which is what makes a jump linkable.

**Selection ids.** GUIDs are 36 characters and would make the hash unreadable.
Encode the first 8 hex characters and resolve by prefix on restore, accepting
only an unambiguous single match and otherwise selecting nothing. At ~1,100
pals the collision probability is ~1.4 × 10⁻⁴, and the failure mode is a
missing selection rather than a wrong one.

**Files:** create `src/app/viewParams.ts`; modify `src/store/uiStore.ts`,
`src/app/AppShell.tsx`, `src/views/pals/PalsView.tsx`,
`src/views/bases/BasesView.tsx`.

---

## Feature 2 — Quick wins bundle

### 2a. Export (CSV / JSON)

New `src/lib/export.ts`, no dependencies:

- `toCsv(rows, columns)` — RFC 4180 escaping (quote when the value contains a
  comma, quote or newline; double embedded quotes). UTF-8, no BOM.
- `download(filename, data, mime)` — Blob, object URL, revoke. Also used by 2b.

Row builders live with the domain in a new `src/domain/exportRows.ts`:
`palRows`, `containerRows`, `itemHitRows`. Each resolves display names through
the refdata `species` / `items` lookups **with a raw-asset-id fallback**, so
degraded mode still exports something correct rather than failing.

UI: an Export control in the `PalsView` filter rail footer exporting
`filtered` — respecting the active filters is the whole point — plus one on
the `BasesView` container pane and one on the item-search results (reusing
`searchItems` / `ItemHit` from `src/domain/bases.ts`). Styled with the existing
`Pill` primitive.

Filenames derive from `fileName` in `saveStore` with the extension stripped:
`Level-pals-412.csv`.

### 2b. Map PNG export

`MapController` (`src/views/map/MapController.ts`) already calls
`this.app.renderer.generateTexture` at line 242, so `renderer.extract` is
available on the same renderer. Add:

```ts
exportImage(scope: 'viewport' | 'island'): Promise<Blob>
```

- `viewport` extracts `this.app.stage` at the current transform.
- `island` extracts `this.world` with its transform temporarily reset to fit,
  restored immediately after, around a synchronous `renderer.render`.

Layer visibility is honoured because the toggles set `Container.visible` — you
get what you see, including the fog layer, which lives inside `world`.

**Cap the island export at 4096 px.** The M0 spike (`docs/spike-m0.md`) found
`MAX_TEXTURE_SIZE` of 8192 on the test machine and notes that older and mobile
GPUs cap at 4096; a full-resolution island is 67 MB of RGBA. Same reasoning
that made the tile bake target 4096.

Button in the map's control panel; the Blob goes through `download()` from 2a.

### 2c. Read `WorldOption.sav`

`src/parse/sniff.ts` does not recognise this file today. It carries server
difficulty, XP / capture / spawn / hatch rates, day length, death penalty and
PvP flags — the context that makes every other number in the app legible.

- **Sniffer:** add a `worldoption` kind with its content marker (`OptionWorldData`)
  to the `MARKERS` table, and a field on `Partitioned`. Classification stays by
  content, not filename, consistent with the rest of the module.
- **Reader:** `src/parse/worker/readers/worldOption.ts`, mirroring the shape of
  `src/parse/worker/readers/localData.ts`.
- **Protocol:** `parseWorldOption` / `worldOptionResult` in
  `src/parse/worker/protocol.ts`.
- **Placement — beside the index, not inside `SlimPayload`.** This is one file
  describing server configuration; it is not derived from the world and is not
  invalidated by merging player saves. Folding it into the payload would force
  a full payload re-post on every merge. This is exactly the reasoning the
  existing code gives for keeping `localData` separate, and it should be
  followed rather than diverged from.
- **Type:** `WorldOptionPayload` in `src/domain/types.ts`.
- **Surface:** a "World settings" panel in `src/app/SaveSummary.tsx` built from
  the existing `SectionHeading` and `StatTile`, and a line in the Guild hero
  when rates are non-default (a 3× capture rate world is not comparable to a
  vanilla one, and the app should say so). Drop-zone copy updated to mention it.

### 2d. Paldex completion

**A panel inside Guild, not a sixth view.** Number keys 1–5 map to the five
views and `?`, `Esc` and `⌘K` are taken; a sixth view forces either a rebind or
an inconsistent key. Paldex data is also inherently per-player, which is what
the Guild view already organises.

- A tab in `src/views/guild/PlayerDetailPanel.tsx` plus an aggregate roll-up in
  `GuildView`'s `Aggregates`.
- A species grid ordered by `SpeciesInfo.zukan`, cells rendered with the
  existing `GameIcon`, dimmed when uncaught, with a corner mark for alpha and a
  ring for lucky.
- Data: `PlayerRecord.captureCountBySpecies` and `paldexUnlocked` for
  ever-caught; `index.palsByCharacterId` for owned-now.
- **Honesty constraint:** without player saves there is no `PlayerRecord`, so
  the panel falls back to owned-now derived from the level save and **says which
  of the two it is showing**. It must not imply completion data it does not
  have.

---

## Feature 3 — Save comparison

### Ingestion

A `baseline?: { fileName, savedAt, payload: SlimPayload }` slot on
`saveStore`. Entered through an explicit "Compare with another save" action —
the next dropped level save becomes the baseline instead of replacing `index`.

Making a second level drop *implicitly* a comparison would break the existing
and correct "drop a new world to replace the current one" behaviour in
`ingestWorld`, so the compare-arm state is deliberate.

Once Feature 1 lands, the persisted snapshot is the second and better entry
point: **"compare with the save you had open before"**, at no parse cost.

### Worker

The comparison save must be parsed without destroying the current world's
retained raw tree. Use a **second, disposable worker**, terminated as soon as
it returns its payload. The existing worker's tree stays intact, `dropRaw`
semantics are unchanged, and no state machine is added to the worker. The cost
is one extra WASM instantiation on an explicit user action, which is the right
trade.

### Diff engine

New `src/domain/diff.ts` — pure functions over two `SlimPayload`s, building
their own local lookup maps rather than requiring a `SaveIndex`.

- **Pals** — key `instanceId`. Added, removed, and changed (`level`, `exp`,
  `rank` from condensing, `passives`, `ownerPlayerUid` for trades,
  `containerId` for moves). IVs are fixed at capture, so a changed IV means a
  reused id rather than a real change — report it as a warning, not a delta.
- **Players** — key `playerUid`. Level and exp, plus the `PlayerRecord`
  counters (pals caught, bosses defeated, fish caught, items crafted). These
  deltas are the most legible "who actually did what" signal in the whole
  feature.
- **Bases** — key `baseId`; **structures** — key `instanceId`; **guilds** — key
  `groupId`, including `baseCampLevel` and membership.
- **Items** — item stacks have **no stable identity**, so this aggregates
  rather than matching. Build `Map<containerId, Map<staticId, count>>` per
  save and diff the counts, and separately a world-total `Map<staticId, count>`.
  The world total is the trustworthy figure ("you spent 400 Paldium"), because
  per-container attribution shifts when containers are rebuilt — and the UI
  must say so. Containers present in only one save are reported as
  added/removed rather than as item churn.

**Guard against comparing different worlds.** Compare a stable identifier — the
`groupId` set is the reliable one available. If the two saves disagree,
decline with an explanation rather than producing nonsense.

**Time between saves** uses `ticksToDate` / `relativeTime` from
`src/lib/format.ts` where a real clock exists, and is explicit where it does
not — the README already documents that guild `last_online_real_time` has an
unidentified epoch.

### UI

**A mode on the Summary view, not a sixth view.** `SaveSummary` is already "the
full read-out of what the save contains"; a diff is the same read-out with
deltas. This also keeps the shortcut map at 1–5.

- A compare banner at the top when a baseline is loaded, naming both saves and
  the interval.
- Each existing `StatTile` gains a delta chip.
- Sections below for pals gained/lost, player activity, base growth and item
  deltas, using the existing `BarList` for top movers and `Table` for detail
  (`src/components/charts.tsx`, `src/components/primitives.tsx`). No new chart
  primitives.

---

## Implementation order

Sequenced so each step is independently shippable and the riskiest layer is
touched while it is freshest:

1. **2a export** — self-contained, and `download()` unblocks 2b.
2. **2c `WorldOption.sav`** — the only parse-layer change; do it before the
   surface-level work piles on top of it.
3. **1a persistence** — the largest single win, and the prerequisite for the
   best version of Feature 3.
4. **1b deep links** — builds on the `uiStore` work from 1a.
5. **2b map PNG** — needs 2a.
6. **2d paldex** — pure UI over data already parsed.
7. **3 save comparison** — last, so it can use the persisted snapshot as its
   baseline source.

---

## Verification

**Every step:** `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass — that is
the CI bar and the bar for a PR.

**After step 2 (and any other `src/parse/` change):** `pnpm test:golden`
locally against a real save in `data/`. CI cannot run this and would report a
false pass.

**Before committing any test change:** `pnpm test:golden` includes
`test/golden/leak.golden.test.ts`, which fails if any identifier or name from
the real save has reached a committed test file. Run it.

**New unit tests — all fixture-based, no real save, no leak risk:**

- `toCsv` escaping: commas, embedded quotes, newlines, unicode.
- Hash param codec round-trip, and unknown/malformed params ignored rather
  than throwing.
- GUID-prefix resolution: unique match, ambiguous match resolves to nothing.
- Snapshot version mismatch deletes and returns `undefined`.
- `buildSaveIndex(snapshot.payload)` over `test/fixtures/level.mini.json`
  produces an index equal to the direct path — the same cross-check discipline
  as `savPipeline.golden.test.ts`.
- `diff.ts` over two payloads derived from the committed fixture with
  programmatic mutations (bump a level, remove a pal, change an item count,
  add a structure), including the different-worlds guard.
- A hand-authored synthetic `WorldOption` fixture for `sniff.test.ts` and the
  new reader — hand-authored specifically so nothing from a real save is
  involved.

Keep the IndexedDB layer in `src/store/session.ts` thin enough that the tested
surface is the pure functions (`migrate`, codecs) rather than the three-line
IDB wrappers; `fake-indexeddb` is not a dependency and adding one for this
would not earn its place.

**Manual, with a real save in `data/`, via `pnpm dev`:**

- Persistence: load a world, accept the offer, reload — the world returns and
  Diagnostics states the raw tree is unavailable. "Forget this save" removes
  it and the reopen button disappears. With the preference off, nothing is
  written (check DevTools → Application → IndexedDB).
- Deep links: set filters in Pals, copy the URL, reload — filters and selection
  restore. ⌘K to a pal overrides the hash, then updates it.
- Export: filter the roster, export CSV, open it in a spreadsheet; confirm
  names resolve and the row count matches the filtered count.
- Map PNG: export viewport and island with layers toggled both ways.
- `WorldOption.sav`: drop it alone and alongside a world; confirm the Summary
  panel and that a non-default rate shows in the Guild hero.
- Comparison: load a world, arm compare, drop an older backup — confirm the
  deltas, then try two unrelated worlds and confirm it declines.