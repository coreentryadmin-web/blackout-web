> **kind:** FINDING

## Vector Pulse "flow-print" signal has never fired on real production data — every real HELIX flow print silently dropped — FIXED

**Status:** FIXED (2026-09-22, Ask Largo standing mandate — fresh angle this cycle: same bug CLASS
as #5405's HELIX print-table fix, found the same day in a different desk while checking whether the
class recurred elsewhere. #5405's own write-up claimed "No other call site in the repo compares
`option_type` against a lowercase literal outside the already-fixed `helix-read.ts` prose line and
the swing `contract_type` family" — that claim was incomplete; this is the counter-example.)

### What was broken

`flowAlertToPulseSignal` (`src/features/vector/lib/vector-pulse.ts`) — the function that turns a
large options-flow print into a "flow-print" signal on the Vector desk's live Pulse ticker —
compared `flow.option_type` directly against the lowercase literals `"call"`/`"put"`:

```ts
const isBullish = (flow.option_type === "call" && dir.includes("buy")) ||
  (flow.option_type === "put" && dir.includes("sell"));
const isBearish = (flow.option_type === "put" && dir.includes("buy")) ||
  (flow.option_type === "call" && dir.includes("sell"));
```

`FlowAlert.option_type` (`src/lib/api.ts`) is typed as a plain `string`, but every REAL producer of
that field is UPPERCASE, never lowercase:
- `parseUwFlowAlert`/`parseOccSymbol` (`src/lib/providers/unusual-whales.ts:266,343`) emit
  `"CALL"`/`"PUT"`/`"UNKNOWN"`.
- The DB read path this route actually serves through — `fetchRecentFlows` (`src/lib/db.ts:3232`) —
  stamps `option_type: String(row.option_type ?? "").toUpperCase()` on every row.

`VectorPulse.tsx` is the ONLY caller of `flowAlertToPulseSignal`, and it feeds it rows from
`fetchFlows()` → `GET /api/market/flows` → `readFlowsMemberCached` → `fetchRecentFlows` — the exact
uppercase path above. So `flow.option_type` reaching this function in production was NEVER
lowercase `"call"`/`"put"` — both `isBullish` and `isBearish` were **always false** for every real
print, and the function's own guard (`if (!isBullish && !isBearish) return null;`) then dropped
every single one. The "flow-print" signal kind (item 7 of this file's own documented priority
list — "large options flow print (sweeps, blocks, dark pool)") has therefore never actually fired
on real production data since it was built; the render-line's own identical lowercase comparison
one line further down (`flow.option_type === "call" ? "C" : "P"`) was moot because execution never
reached it.

This file's own test suite (`vector-pulse.test.ts`) never caught it because every fixture used
lowercase `"call"`/`"put"` — the exact same case-shape mismatch between test fixtures and real
runtime data that let the HELIX bug (#5405) ship the same day.

### Why this matters (Largo product contract / standing perf-latency mandate overlap)

Not a Largo play-brief section, but the same underlying data-correctness class this repo's audit
discipline treats uniformly: a signal feed that silently discards 100% of its intended input is
strictly worse than one that was never built, because it *looks* wired (the code compiles, the
component renders, the feed exists in the UI) while doing nothing. A trader watching the Vector
Pulse ticker for large flow prints during RTH would never see one, with no error or empty-state
message distinguishing "no large flow right now" from "this feature is silently broken."

### Fix

Normalize `flow.option_type` to uppercase once (`const side = flow.option_type?.toUpperCase() ?? ""`)
and compare against `"CALL"`/`"PUT"` at both the classification site and the render-line site.
Minimal, single-file change — no behavior change for the (nonexistent in production, but still
supported) lowercase-input case beyond making it now also match correctly.

### Evidence (RED → GREEN, git-stash proven)

Added two tests to `vector-pulse.test.ts` using the REAL production shape (uppercase `"CALL"`/
`"PUT"`) alongside the file's existing lowercase-fixture tests:
- "REAL uppercase option_type (production shape) — call buy still bulls"
- "REAL uppercase option_type (production shape) — put buy still bears"

- Stashed only the source fix (`vector-pulse.ts`), kept the new tests: **2 failures** (both new
  tests — a real $1.2M CALL buy and a real $1.1M PUT buy both produced `null` instead of a signal).
- Restored the fix: **41/41 pass** in the file, 0 fail.
- `npx tsc --noEmit` clean; full `npm test` run alongside this PR.

### Blast radius

One file, `src/features/vector/lib/vector-pulse.ts` — the only two lines in the repo doing this
specific broken comparison against `FlowAlert.option_type` (confirmed via repo-wide grep for
`option_type === "call"` / `option_type === "put"` outside test files: `spx-play-engine.ts` and
`options-socket.ts` compare against their OWN differently-cased/typed `option_type` fields, already
correct for their own producers — not the same bug; the swing `contract_type` family is a
completely different nullable DB column, already covered by #5401/#5403 this same day).

### Not touched (deliberately)

`isSignificantFlow` (same file) — only checks `flow.premium`, never reads `option_type`, so it
carries no part of this defect.
