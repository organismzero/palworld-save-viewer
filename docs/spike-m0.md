# M0 spike results

> **Historical record.** These measurements were taken before the map view was
> built, to settle the questions that could have forced a redesign. Everything
> below shipped as described — see the end of the document for what actually
> happened. Kept because the numbers are the reason for several decisions that
> would otherwise look arbitrary, and because they are the baseline to compare
> against if the map ever gets slow.

Three prototypes run before committing to the map view, to settle the
questions that could have forced a redesign. **All three pass.**

The harness lives in `spike/` (gitignored, because it holds a copy of the game
world map). Re-run it with:

```sh
pnpm exec vite --config spike/vite.config.ts
# then open http://localhost:5199/spike/index.html
```

## Environment

Results below are from headless Chromium 145 on Linux/WSL2, 20 cores,
`navigator.deviceMemory` 8 GB, rendering through **SwiftShader** — that is,
software rasterisation with no GPU at all:

```
ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
MAX_TEXTURE_SIZE: 8192
```

That makes the performance numbers a **lower bound**. Real hardware will be
faster, so a pass here is a strong pass. It does not, however, tell us anything
about low-memory devices, which is the one risk left open below.

## Test 1 — the 8192×8192 map decode

The plan's biggest risk: `T_WorldMap.webp` is 1.9 MB on disk but 8192² RGBA =
**268 MB** decoded, and this was the only item with no known-good fallback.

| path                                       | time    | result                        |
| ------------------------------------------ | ------- | ----------------------------- |
| `createImageBitmap` + `resizeWidth: 4096`  | 580 ms  | 4096 px — **resize honoured** |
| `createImageBitmap` + `resizeWidth: 2048`  | 364 ms  | 2048 px — resize honoured     |
| `createImageBitmap`, no resize             | 286 ms  | 8192 px, no failure           |
| WebCodecs `ImageDecoder`                   | 228 ms  | 8192 px                       |
| Tile bake → 341 tiles across 5 zoom levels | 1367 ms | 1.7 MB total                  |

**Verdict: PASS.** Resize-on-decode works, and the full-size decode does not
even fail on this machine. The tile bake completes in 1.4 s and yields 1.7 MB
to cache — comfortably inside the 3–5 s and 6–8 MB the plan budgeted.

Two caveats worth carrying into M2:

- **The heap deltas the harness prints are meaningless and labelled as such.**
  `ImageBitmap` pixel data is held by the renderer, not the JS heap, so
  `measureUserAgentSpecificMemory()` reads ~0 even for a 268 MB decode. Decode
  success and wall time are the real signals here.
- **`MAX_TEXTURE_SIZE` is 8192, exactly the source size.** That is
  SwiftShader's limit; real GPUs usually report 8192 or 16384, but older and
  mobile parts cap at 4096. Baking to 4096 tiles remains the right call — not
  because this machine needs it, but because the fleet does.

The fallback chain (WebCodecs → `resizeWidth: 2048` → procedural grid) stays in
the plan, but it is now genuinely a fallback rather than a likely path.

## Test 2 — Pixi v8 at 2,800 sprites

1,504 structures + 1,098 pals + markers, all `eventMode: 'static'`, under
continuous pan and zoom for 3 s.

| metric                              | result                                 |
| ----------------------------------- | -------------------------------------- |
| init                                | 27 ms                                  |
| build 2,800 interactive sprites     | 7 ms                                   |
| frame time (median over 178 frames) | 16.7 ms — **60 fps**                   |
| frame time p95                      | 16.8 ms                                |
| worst frame                         | 34.4 ms (one dropped frame at startup) |
| hit test                            | **0.118 ms** per probe                 |

**Verdict: PASS.** Hit testing costs 0.118 ms against a 16.7 ms frame budget —
about 140× of headroom, on software rendering. This settles the question that
decided Pixi over hand-rolling a quadtree on canvas2d.

Note the hit-test figure is measured mostly on _misses_ (13 of 400 probes found
a sprite at the test zoom). That is the conservative direction: a miss must
traverse the whole scene graph, whereas a hit can return early.

## Test 3 — 74 MB parse in a real worker

Runs the actual shipping pipeline (`buildIndexes`), not a simplified copy.

| phase                     | time       |
| ------------------------- | ---------- |
| fetch 74.5 MB             | 601 ms     |
| `TextDecoder`             | 177 ms     |
| `JSON.parse`              | 104 ms     |
| build indexes             | 19 ms      |
| **total parse → indexes** | **300 ms** |

Output: 1,098 pals, 10 players, 1,504 structures, 1,317 containers, 1.8 MB
crossing the wire.

**Verdict: PASS**, and it confirms the two architectural bets:

- **Main-thread heap delta: ~0 MB.** The ~170 MB raw tree stayed in the worker.
- **The source `ArrayBuffer` is neutered after `postMessage`**, confirming a
  genuine zero-copy transfer rather than a structured-clone of 74 MB.

Browser numbers beat the Node measurements (104 ms vs ~270 ms for
`JSON.parse`), so the decision not to build a streaming parser holds
comfortably.

## Consequences for M2

- Proceed with the tile-bake approach as planned; keep the fallback chain.
- Proceed with Pixi v8 and `eventMode: 'static'` picking. No quadtree needed.
- No change to the worker architecture.
- **Still unverified:** Firefox and Safari, and any genuinely low-memory
  device. Chromium was the platform most likely to succeed, and this run used
  software rendering, but `resizeWidth` support specifically has historically
  been uneven across engines. The feature-detect in the bake worker (compare
  `bitmap.width` against the requested width) is therefore still required, not
  optional.

## What actually happened

All three decisions held, and the map shipped in M2 as described.

- The tile bake lives in `src/refdata/tiles.worker.ts`, and the `resizeWidth`
  feature-detect is there as required — it compares `bitmap.width` against the
  requested width and falls back to a full decode plus a canvas resize.
- Pixi with `eventMode: 'static'` picking is `src/views/map/MapController.ts`.
  No quadtree was ever needed.
- The worker architecture is unchanged, and the zero-copy transfer still holds.
  The `.sav` path added in M7 slots in ahead of `JSON.parse` without disturbing
  it: Oodle decompression plus a binary GVAS read costs ~330 ms against the
  JSON path's ~300 ms, and produces an identical result.

Firefox and Safari remain unverified, as does low-memory behaviour. The
fallback chain is what covers that, not evidence.
