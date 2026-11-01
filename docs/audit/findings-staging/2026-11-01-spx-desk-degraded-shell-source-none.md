> **kind:** FINDING

## SPX Slayer: `GET /api/market/spx/desk` peek fast-path can serve a degraded, GEX/flow-less desk shell as fully live — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** 5-engine + Ask Largo live-correctness sweep workflow (2026-11-01, `check:spx` agent),
per the standing 5-engine live monitor mandate. Live evidence captured twice against production:
a degraded response served from `GET /api/market/spx/desk`, then a real/fully-built response ~2
minutes later for the same cache key.

**Root cause:** `src/app/api/market/spx/desk/route.ts`'s peek fast-path guard assumed any cached
`SpxDeskPayload` with `price > 0` must be a real `buildSpxDesk()` result:
```ts
if (instant && instant.price > 0) { return NextResponse.json(...); }
```
That premise is false. `peekSpxDesk()`'s own cache-miss fallback (`spx-desk-loader.ts`'s
`deskCacheOpts.fallback`) calls `deskShellFromPulse(pulse)`
(`src/features/spx/lib/spx-desk.ts`), which is `mergePulseIntoDesk(emptyDeskPayload(asOf), pulse)`.
`emptyDeskPayload`/`emptyPayload` seed the degraded shell with `source: "none"` and every
GEX/flow/levels field null — a clean, honest "no real build yet" sentinel. But
`mergePulseIntoDesk()` (`spx-desk-merge.ts`) reassigns `price`, `available`, `vix`,
`spx_change_pct`, `prior_close`, `gap_pct`, `vwap`, `pdh`/`pdl`, etc. from the real pulse lane —
**and never reassigns `source`**, which stays stuck at `"none"` on the `...base` spread. So a
cold-cache window can produce a payload with a real nonzero price (passing the `price > 0` check)
while every GEX/flow/dealer-positioning field is still null — i.e. exactly the shape the guard's
own comment says it exists to prevent ("flash SPX 0 ... platform-integrity FAIL"), just with a
nonzero price instead of zero, so the existing guard didn't catch it.

The already-correct precedent for distinguishing a real build from this degraded shell already
exists elsewhere in the same codebase: `src/features/spx/lib/spx-play-engine.ts:1730` —
```ts
const closedConfluence = desk.price > 0 && desk.source !== "none" ? computeSpxConfluence(desk) : null;
```
`SpxDeskPayload.source` is a plain `string` field; real `buildSpxDesk()` builds always set it to
`"merged"`, `"polygon+uw-flow"`, or `"polygon"` — never `"none"`.

**Fix:** added `&& instant.source !== "none"` to the peek fast-path condition in `route.ts`,
mirroring the `spx-play-engine.ts:1730` precedent. On a degraded-shell peek, the request now falls
through to `loadSpxDesk()`, which triggers `withServerCache`'s real SWR-bounded refresh
(`maxBlockMs`/`maxStaleAgeMs`) instead of serving the pulse-only shell as if it were a complete
desk build.

**Evidence (RED → GREEN):** `src/app/api/market/spx/desk/route.test.ts` is a static source-text
regex regression test (this route's existing pattern — no sibling SPX route test uses
`mock.module`). Added a second assertion (`instant.source !== "none"`) alongside updating the
first to match the new condition. RED (pre-fix `route.ts`, confirmed via temporary revert): both
assertions fail — `assert.match(/if \(instant && instant\.price > 0 && instant\.source !== "none"\)/)`
and `assert.match(/instant\.source !== "none"/)`. GREEN (post-fix):
`npx tsx --experimental-test-module-mocks --test route.test.ts` → 2/2 pass. `npx tsc --noEmit`:
clean. Broader regression check: `route.test.ts` + `spx-desk*.test.ts` + `spx-play-engine.test.ts`
→ 123/123 pass.

**Blast radius:** single call site (`route.ts`'s peek fast-path) — `peekSpxDesk()` is used nowhere
else in the route tree; `/api/market/spx/play` and `/api/admin/spx/dashboard` both go through
`loadSpxDesk()`/`loadMergedSpxDesk()` directly and never hit this peek shortcut, so they were not
exposed to this bug. The degraded-shell builder itself (`deskShellFromPulse`/`mergePulseIntoDesk`)
is left unchanged — fixing it to also carry a non-"none" source (e.g. `"pulse"`) was considered and
rejected: `source: "none"` is the correct, honest signal that this is NOT a real desk build, and
every other consumer of this payload shape (including the `spx-play-engine.ts:1730` precedent)
relies on `source === "none"` meaning exactly that. The fix belongs at the one call site that was
misreading `price > 0` as sufficient proof of a real build, not at the shell builder.
