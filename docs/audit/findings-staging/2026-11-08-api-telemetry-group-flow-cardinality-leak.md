# 2026-11-08 api-telemetry.ts: `endpointTemplate()` never collapsed UW `/api/group-flow/{group}/greek-flow` — an unbounded-cardinality gap missed by the earlier earnings/insider/institution sweep

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 observability (unbounded `endpointStats` cardinality from a free-text, AI-controlled parameter; backstopped by the existing LRU cap so it never grows unboundedly, but every real group name evicts a legitimate stats row) |

## Root cause

`endpointTemplate()` (`src/lib/api-telemetry.ts`) exists specifically to collapse per-entity
provider paths (ticker, OCC, date, institution name, …) into one stable template so the
`endpointStats` Map stays small and the admin API dashboard shows a handful of templated rows
instead of one permanent row per distinct value ever requested. Its own header and the round
386/387 fix comment already document this exact failure mode for `/api/earnings/{ticker}`,
`/api/insider/{ticker}`, and `/api/institution/{name}/activity|holdings|ownership` — all fixed in
a prior pass after the original UW coverage "stopped one function short of the full
`unusual-whales.ts` call-site list."

That sweep missed one more sibling: `fetchUwGroupGreekFlow` (`src/lib/providers/unusual-whales.ts`)
calls

```ts
const path = expiry
  ? `/api/group-flow/${g}/greek-flow/${safeDateSegment(expiry)}`
  : `/api/group-flow/${g}/greek-flow`;
```

with `g = safePathSegment(group)`, and `endpointTemplate()` had no rule for the `/api/group-flow/`
prefix at all — it fell through to being recorded verbatim, one permanent `endpointStats` entry
per distinct `group` value.

Unlike the other per-entity segments this function already collapses, `group` is **not** a small,
fixed enum. The two call sites that pass a literal value both use `"mag7"` (`market-wide.ts`,
`spx-desk.ts`), but the third call site — `src/lib/largo/run-tool.ts`'s `get_group_greek_flow`
tool handler — forwards whatever `group` the Largo AI/operator supplies, straight from the tool's
own schema:

```ts
// src/lib/largo/tool-defs.ts
group: { type: "string", description: "Flow group e.g. mag7, semis", default: "mag7" },
```

a free-text `string` with no enum and no allowlist. Every distinct group name a Largo conversation
ever asks about (`"semis"`, `"banks"`, `"ai-stocks"`, anything the AI or operator types) therefore
minted its own permanent `endpointStats` row — the exact "per-symbol path leaks a permanent entry"
defect this function exists to prevent, for a prefix the earlier sweep's UW coverage never reached.
The existing `MAX_ENDPOINT_STATS = 500` LRU backstop prevents unbounded growth, but it does so by
evicting *other* legitimate endpoint rows once the cap is hit — so this gap degrades the admin
dashboard's usefulness for every provider sharing the Map, not just UW.

## Evidence

- `grep -n "group-flow" src/lib/api-telemetry.ts src/lib/api-telemetry.test.ts` returned nothing
  before this fix — the prefix had zero coverage, in code or in tests.
- RED→GREEN, `npx tsx --experimental-test-module-mocks --test src/lib/api-telemetry.test.ts`:
  - Pre-fix: `endpointTemplate("/api/group-flow/mag7/greek-flow")` → `"/api/group-flow/mag7/greek-flow"`
    (unchanged — no template applied) and the new "endpointStats stays bounded for UW group-flow
    paths" test failed with `expected the one templated group-flow key` (300 distinct group names
    produced 300 distinct rows, not one).
  - Post-fix: `endpointTemplate("/api/group-flow/mag7/greek-flow")` →
    `"/api/group-flow/:sym/greek-flow"`, `endpointTemplate("/api/group-flow/semis/greek-flow")` →
    the same template, and `endpointTemplate("/api/group-flow/mag7/greek-flow/2024-01-01")` →
    `"/api/group-flow/:sym/greek-flow/:date"` (the existing date rule still applies after the new
    one). 300 distinct group-flow calls now aggregate into exactly one `endpointStats` key with
    `call_count: 300`.
  - Full file: 10/10 pass post-fix (was 7/10 pre-fix, the 3 failures being the 2 new assertions
    plus one pre-existing cardinality-ceiling test in the same file that the un-collapsed
    group-flow entries pushed over its threshold — confirming the leak's blast radius onto a
    sibling, unrelated assertion in the same shared module-level Map).
- `npx tsc --noEmit`: clean.

## Blast radius

Only `endpointTemplate()` in `src/lib/api-telemetry.ts` needed a new rule — `fetchUwGroupGreekFlow`
itself and its three call sites (`market-wide.ts`, `spx-desk.ts`, `largo/run-tool.ts`) are
untouched; they already pass the raw path through `trackedFetch`, and `endpointTemplate()` is the
single, shared collapsing layer every provider's telemetry already goes through. No other
`/api/group-flow/...` route exists in `unusual-whales.ts` (verified: `grep -n "group-flow"` finds
exactly these two path-building lines and nothing else), so one new rule closes the gap completely.

## Fix rationale

Added one more `.replace()` in the same style and position as the existing per-entity rules
(right after the `/api/market/{sym}/sector-tide|etf-tide` rule, before the generic
`/indicators/` rule), matching `/api/group-flow/[^/?]+/(greek-flow)` → `/api/group-flow/:sym/$1`.
No negative lookahead is needed (unlike the earnings/insider rules) because `fetchUwGroupGreekFlow`
has no fixed, non-group sibling path under the same prefix to protect. The existing trailing
`\d{4}-\d{2}-\d{2}` → `:date` rule already collapses the optional expiry segment, so no change was
needed there.

Regression tests added to `src/lib/api-telemetry.test.ts`, mirroring the existing round 386/387
earnings/insider/institution test pair exactly: one asserting the template collapse (with and
without a trailing date), one asserting 300 distinct group names collapse into a single bounded
`endpointStats` row.
