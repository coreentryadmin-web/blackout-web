## Helix "Flow Anomalies Detected" banner silently never rendered — `roundFloats()` flattened every `detectedAt` timestamp into `{}` — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 (live, member-facing — a whole alert surface silently produces zero output, 100% of the time, on real production data) |
| **Component** | `src/lib/round-floats.ts` (`roundFloats`, shared response-rounding helper, 160 call sites repo-wide); triggering consumer `src/app/api/market/anomalies/route.ts`; broken downstream consumer `src/components/FlowAnomalyBanner.tsx` + `src/components/flow-anomaly-recency.ts` (`isFlowAnomalyRecent`) |

### How this was found

Routine Helix-desk live audit (5-engine monitor). `GET /api/market/anomalies` returned HTTP 200
with 20 real, fresh anomalies (SPXW $6.1M call print, SNDK $5.4M put skew, etc., all from Friday
2026-10-09's session — correct for a Sunday market-closed check) — but every single row's
`detectedAt` field was a bare empty object: `"detectedAt": {}`, instead of an ISO timestamp.

### Root cause

`src/app/api/market/anomalies/route.ts` passes DB rows straight from `dbQuery(...)` (node-postgres)
into `roundFloats({ anomalies: result.rows.map(r => ({ ..., detectedAt: r.detected_at, ... })) })`
without first stringifying `detected_at` — node-postgres's default type parser returns a native JS
`Date` for a `timestamp`/`timestamptz` column, so `detectedAt` is a `Date` instance at the point it
enters `roundFloats`.

`roundFloats`'s recursive `walk()` had exactly four branches: number, array, "object", and
passthrough. A `Date` matched the generic `typeof v === "object"` branch, which rebuilds the value
via `for (const [k, val] of Object.entries(v)) out[k] = walk(val, k)`. A `Date` has **no own
enumerable properties** — its value lives in an internal slot, only reachable via methods like
`getTime()`/`toISOString()` — so `Object.entries(date)` returns `[]`, and the walk silently
produced `out = {}`. Confirmed directly:

```
npx tsx -e "
import { roundFloats } from './src/lib/round-floats.ts';
console.log(JSON.stringify(roundFloats({ detectedAt: new Date('2026-10-09T23:59:45Z') })));
"
# => {"detectedAt":{}}
```

### Blast radius — the real member-facing consequence

`FlowAnomalyBanner.tsx` fetches `/api/market/anomalies` and filters with
`isFlowAnomalyRecent(a.detectedAt)` (`src/components/flow-anomaly-recency.ts`):

```ts
const t = new Date(detectedAt).getTime();
if (!Number.isFinite(t)) return false;   // <-- always hits this with detectedAt === {}
```

`new Date({}).getTime()` is `NaN`, so `isFlowAnomalyRecent` returns `false` for **every** anomaly,
**every** time, regardless of how real or fresh it is. `FlowAnomalyBanner` then does
`if (dismissed || anomalies.length === 0) return null;` — with the recency filter always emptying
the array, the banner renders **nothing, unconditionally**. This is a silent failure: the API
returns 200, the data is real, the UI makes zero visible complaint — it simply never shows the
"Flow Anomalies Detected" banner at all, which is one of Helix's headline live-alert surfaces
(`DIRECTIONAL_FLOW_SKEW`/`LARGE_PREMIUM_PRINT`, severity up to `CRITICAL`).

`roundFloats()` is called at **160 call sites** across the repo. Any other call site that passes a
raw `Date` (rather than an already-`.toISOString()`'d string — which is how most call sites appear
to build their payloads, based on a spot check) carries the identical latent defect. Fixing the
shared helper itself — rather than patching `anomalies/route.ts` alone to stringify first — closes
the defect for all 160, not just the one this audit happened to trip over.

Confirmed a **second** real, currently-affected consumer while tracing the blast radius:
`src/app/api/platform/intel/route.ts` (lines ~159-166) builds its own `anomalies[].detectedAt:
a.detected_at` the identical way — same raw DB row, same un-stringified `Date`, same
`roundFloats(...)` wrap two lines later — so this platform-intel surface's anomaly timestamps were
equally corrupted to `{}` before this fix. Not independently verified live (this audit's live checks
were scoped to the three Helix endpoints named in the task), but the code shape is identical and the
root-cause fix covers it the same way.

### Fix

Added a `Date` passthrough branch in `roundFloats`'s `walk()`, checked before the generic-object
branch: `if (v instanceof Date) return v;`. A `Date` carries no float to round, so passing it through
unchanged is correct; `NextResponse.json` → `JSON.stringify` already calls `Date.prototype.toJSON()`
on it and serializes the proper ISO string, exactly as it would for a plain Date never touched by
`roundFloats` at all.

### Fix rationale

Fixing the shared `roundFloats` helper (rather than only `anomalies/route.ts`) was chosen because:
the bug is in the helper's contract (it claims to walk "every JSON-serializable value" but silently
destroys one whole JS-native serializable type), the same latent defect could exist at any of the
other 159 call sites today or in a future one, and the fix is a single, narrow,
additive branch with zero behavior change for every existing caller that never passes a raw `Date`
(the entire existing 25-test suite still passes byte-for-byte, no test needed updating).

### Regression guard

Two new tests in `src/lib/round-floats.test.ts`:
- `"passes a raw Date through unchanged, instead of flattening it to {}"` — round-trips a `Date`
  through `roundFloats`, asserts it is still a `Date` instance, asserts `.toISOString()` is
  unchanged, and asserts the actual wire format (`JSON.stringify` output) is the correct ISO string
  rather than `{}` — this last assertion is the one that reproduces the exact bytes a real client
  received.
- `"walks arrays of Dates (the actual anomalies/route.ts shape) without flattening any of them"` —
  the real `{ anomalies: [{ detectedAt: Date }, ...] }` shape, proving the fix holds through the
  array + nested-object walk, not just a bare top-level value.

RED→GREEN proven via `git stash` (stashing only the `round-floats.ts` fix, keeping the new tests):
pre-fix run showed `# pass 25 / # fail 2` (the two new tests failing exactly as expected); post-fix
run (fix restored) showed `# pass 27 / # fail 0`.

### Gates

- `npx tsx --experimental-test-module-mocks --test src/lib/round-floats.test.ts` (Node 20.20.2) —
  27/27 pass (was 25/27 pre-fix).
- `npx tsc --noEmit` — clean.
- Full `npm test` — run alongside this fix; see PR for the pass/fail summary.
- Live reproduction evidence: `GET https://blackouttrades.com/api/market/anomalies` on 2026-10-11
  returned `detectedAt: {}` on all 20 rows pre-fix (captured via a temp premium Clerk session, user
  deleted after).
