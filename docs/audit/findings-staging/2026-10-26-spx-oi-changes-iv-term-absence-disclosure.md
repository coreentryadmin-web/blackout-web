## SPX Slayer: `oi_changes`/`iv_term_structure` are permanently, structurally empty — `data_quality.missing` never named them, so nothing distinguished "never computed" from "genuinely zero today"

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production health-check sweep, Ask Largo × Night Hawk Swings standing mandate (cycle 34), 2026-10-26 |
| **Scope** | `src/features/spx/lib/spx-desk.ts` (`buildDeskDataQuality()`), `src/lib/platform/types.ts` (`SpxDeskSummary`), `src/features/spx/lib/spx-service.ts` (`summarizeSpxDesk()`), `src/lib/admin-spx-issues.ts` (admin dashboard issue surfacing) |

### Root cause

`SpxDeskPayload` (`spx-desk.ts`) declares `oi_changes: OiChangeItem[]` and `iv_term_structure:
IvTermPoint[]`. No function anywhere in the codebase ever computes a real instance of either type
for this payload — confirmed by a repo-wide grep for `OiChangeItem(`/`IvTermPoint(` construction
and for any assignment to these two field names. The canonical `buildSpxDesk()` return object
hardcodes them as literal empty arrays, `oi_changes: [], iv_term_structure: [],` — unlike every
sibling array field in the same return object, which is built from a named computed variable with
a `?? []` fallback (e.g. `flow_by_expiry: enrichment?.flow_by_expiry ?? []`). The same bare-empty-
array literals are duplicated in `spx-desk.ts`'s own `emptyPayload()` stub and in
`spx-desk-merge.ts`'s `signalDeskStub()` shell default.

`fetchUwOiChange`/`fetchUwIvTermStructure` (`unusual-whales.ts`) DO exist and ARE called — but only
by Night Hawk's dossier builder (`features/nighthawk/lib/dossier.ts`) and by Largo's own
`run_largo_tool` dispatcher (`src/lib/largo/run-tool.ts`) for a *different*, on-demand tool call.
Neither ever feeds `SpxDeskPayload.oi_changes`/`.iv_term_structure` — those two fields on the SPX
desk itself are dead wiring, not merely slow or rate-limited.

`buildDeskDataQuality()` (the function that produces `DeskDataQuality.missing`, the one place this
payload already discloses data gaps) only ever tracked VIX/VIX9D/VIX3M feed presence. Nothing
named `oi_changes`/`iv_term_structure` as missing, so a consumer reading an empty array had no way
to tell "this is a real zero today" from "this has never been computed, ever" — the exact
absence-vs-silence failure `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle exists to
prevent.

**A second, independent gap surfaced while verifying this disclosure actually reaches consumers**
(per the audit's own "check whether the disclosure reaches the admin dashboard / Ask Largo"
discipline): `SpxDeskSummary` (`platform/types.ts`) — the exact object Largo's `get_spx_structure`
tool returns to the model (`summarizeSpxDesk()` in `spx-service.ts`) — never carried
`data_quality` AT ALL. Even a correctly-populated `missing` array on the server-side payload could
never reach Largo, because the Largo-facing summary type dropped the whole field. Separately, the
admin dashboard's own issue surfacer (`admin-spx-issues.ts`) only reads `desk.data_quality.missing`
inside a block gated on `vix_term_partial` — a flag about the VIX curve specifically, almost always
false — so even once `missing` carried `oi_changes`/`iv_term_structure`, the admin dashboard would
almost never show it.

### Evidence

- `grep -rn "OiChangeItem(\|IvTermPoint(" src/` and a grep for `oi_changes:`/`iv_term_structure:`
  assignments across the repo: every non-test call site that builds an `SpxDeskPayload` literal
  (`spx-desk.ts:1409-1410`, `spx-desk.ts:1804-1805` pre-fix, `spx-desk-merge.ts:513-514`) hardcodes
  `[]`; the only real producers of these UW-provider types
  (`fetchUwOiChange`/`fetchUwIvTermStructure`) are called only from `nighthawk/lib/dossier.ts` and
  `lib/largo/run-tool.ts`'s own on-demand tool handlers, never from anything that builds the SPX
  desk payload.
- `src/lib/platform/types.ts`'s pre-fix `SpxDeskSummary` type had no `data_quality` key at all —
  confirmed by grep (`data_quality` appears nowhere in that file before this fix) — so
  `get_spx_structure`/`get_market_context`/`get_platform_snapshot` (all backed by the identical
  `getSpxDeskSummary()`) could never surface ANY desk data-quality caveat to Largo, not just these
  two fields.
- `src/lib/admin-spx-issues.ts`'s only existing read of `desk.data_quality` was gated on
  `vix_term_partial`, which is false on a healthy VIX curve — the common case — so the admin
  dashboard's "Partial VIX term structure" issue would never fire to disclose a permanently-dead,
  VIX-unrelated field.
- `src/lib/largo/spx-structure-fit.ts`'s field-truncation table (`SPX_STRUCTURE_LIST_CAPS`)
  includes `{ key: "oi_changes", cap: 8 }` alongside genuinely-live fields (`unified_tape`,
  `news_headlines`, `macro_events`, `sector_heat`) — implying real data could appear there, when it
  structurally never does. Left as-is (see Fix rationale below) since this cap is harmless (it
  never fires on a permanently-empty array) and removing it is a separate, not-yet-scoped cleanup.

### Fix

1. `buildDeskDataQuality()` now pushes `"oi_changes"` and `"iv_term_structure"` into `missing`
   **unconditionally, every call** — independent of VIX feed health (`vix_term_partial` is left
   computed exactly as before, from the VIX legs only; the two new entries are additive, not a
   replacement).
2. `SpxDeskSummary` gained a `data_quality: DeskDataQuality | null` field, populated in
   `summarizeSpxDesk()` from `merged.data_quality ?? null` — the ONLY call site that constructs an
   `SpxDeskSummary` object literal, so every reader (Largo's `get_spx_structure`,
   `get_market_context`, `get_platform_snapshot`, Night Hawk's day-trade filters, Meridian's
   cross-product reads) now receives this disclosure for free.
3. `admin-spx-issues.ts` gained a second, **always-evaluated** check (not gated on
   `vix_term_partial`) that pushes an `info`-severity issue naming `oi_changes`/`iv_term_structure`
   whenever `data_quality.missing` contains either — `info`, not `warning`, because this is known,
   standing behavior to track, not an incident to page on.

### Fix rationale — what was deliberately left unchanged

- **No real OI-change/IV-term-structure computation was added.** Implementing that is a genuine,
  multi-day feature (wiring `fetchUwOiChange`/`fetchUwIvTermStructure` into the desk build path,
  handling their own freshness/staleness) — out of scope for a single small PR per this repo's
  "one issue per branch/PR" policy. This PR fixes the DISCLOSURE only, per the audit task's own
  scope instruction.
- **The fields were NOT removed from `SpxDeskPayload`/the Largo product contract.** Per
  `docs/audit/LARGO-PRODUCT-CONTRACT.md`: absence must be disclosed, not papered over by deleting
  the contract surface. A future PR that wires real computation needs the fields to already exist.
- **`spx-structure-fit.ts`'s `oi_changes` cap entry was left in place.** It is harmless (capping an
  always-empty array is a no-op) and removing table entries is a separate cleanup with its own
  blast radius (the shed-order list, its own unit tests) — not bundled into a disclosure fix.
- **`emptyPayload()`/`signalDeskStub()`'s own `data_quality: { vix_term_partial: false, missing:
  [] }` stub literals were left untouched.** Those paths represent `available: false` — the WHOLE
  payload is already disclosed as unavailable, so a sub-field disclosure inside it is redundant;
  only the real, `available: true` build path (`buildDeskDataQuality()`) needed the fix.

### Regression test

`src/features/spx/lib/spx-desk-data-quality.test.ts` (new file): imports `buildDeskDataQuality`
as a value via a dynamic `import("./spx-desk")` after mocking `server-only` (mirrors
`spx-desk-wall-scope.test.ts`'s established pattern for unit-testing this module directly).
Two tests: (1) with all three VIX legs healthy, `missing` must equal exactly
`["oi_changes", "iv_term_structure"]` and `vix_term_partial` must stay `false`; (2) with a real
VIX/VIX3M gap, the two permanent entries must be present ADDITIVELY alongside the real VIX gap
entries, never crowded out or duplicated.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-desk-data-quality.test.ts`
  — RED pre-fix (2/2 fail, reverted `buildDeskDataQuality()`'s two new lines only, test file kept
  in place), GREEN post-fix (2/2 pass).
- Full suite (`npm test`, Node 20) — pass, 0 fail.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
