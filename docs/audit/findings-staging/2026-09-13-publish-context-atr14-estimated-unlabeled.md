> **kind:** FINDING

## Night Hawk publish-context's synthetic ATR14 was never actually labeled, despite the docstring's claim

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `computeNighthawkPublishGeometry` / `buildNighthawkPublishContext` (`src/features/nighthawk/lib/publish-context.ts`) — the publish-time evidence pin every Legacy play carries, and `publish-gates.ts`'s `target_unreachable` gate, which reuses the same geometry object |
| **Severity** | P2 — a real data-honesty gap. `estimateAtr()`'s own header explicitly promised a distinguishing label that did not exist anywhere in the code; a member-facing reachability sentence and a publish-gate decision could both be silently computed from a guessed volatility figure with no way for a future audit to tell. |

### Root cause

`estimateAtr()`'s docstring (PR-N21) states: *"The estimate is CLEARLY labeled in the geometry so calibration knows it's synthetic."* The actual code:

```ts
atr14: finiteOrNull(tech?.atr14) ?? estimateAtr(tech, spot),
```

`NighthawkPublishGeometry` carried exactly one `atr14: number | null` field — no companion boolean, no separate "source" field, nothing distinguishing a Polygon-measured 14-day true-range average from a guessed prior-day-range or 1.5%-of-spot fallback. The claim in the docstring was false: there was no label anywhere.

This ATR value is not cosmetic — it is load-bearing in two places:
- `publish-gates.ts`'s `target_unreachable` gate computes `targetAtrMultiple = |target - fill_edge| / atr14` and blocks or passes a play based on it.
- `target-reachability.ts`'s member-facing "Target sits Nx ATR14 from the entry edge — comparable setups traded that far X% of the time" sentence is calibrated against a population of REAL, provider-measured ATR14 values (per that file's own provenance section) — feeding it a synthetic estimate silently uses a number from a different, uncalibrated population without any signal that happened.

Grepped the whole pinned shape and `publish-gates.ts`: no `atr14_estimated`/`atr14_source`/any distinguishing field existed anywhere. No existing test exercised the `estimateAtr` fallback path at all.

### Blast radius

`NighthawkPublishGeometry` is used in exactly two places (`publish-context.ts`, `publish-gates.ts` — grepped repo-wide), so adding the field required no other call-site changes. The pinned shape (`buildNighthawkPublishContext`'s output) now carries `atr14_estimated` alongside `atr14`; `PUBLISH_CONTEXT_VERSION` bumped 2→3 per this file's own stated convention ("bump when the pinned shape changes so calibration reads can segment"). No other code reads `PUBLISH_CONTEXT_VERSION` (grepped), so the bump is documentation-only, matching the file's existing v2 bump.

### Fix

Added `atr14_estimated: boolean` to `NighthawkPublishGeometry`, computed as `realAtr14 == null && atr14 != null` (true only when a real ATR14 was absent AND a synthetic one was actually produced — never true when there's no ATR at all to label). Threaded through to the pinned context object. Corrected `estimateAtr()`'s own docstring, which previously made the false claim itself, to point at where the labeling actually happens now.

### Why this fix, not an alternative

Considered a richer enum (`"measured" | "prior_day_range" | "spot_pct"`) distinguishing WHICH synthetic method was used — rejected as more than the current consumers need: nothing downstream branches on which fallback fired, only on whether the number is trustworthy at all. A boolean answers the actual question every future reader of this pin needs ("can I trust this ATR the same way the calibration population trusts its ATR14s"), without inventing detail nothing reads yet.

### Evidence

- Grepped repo-wide for any existing distinguishing field: none found, confirming the docstring's claim was never implemented.
- New tests in `publish-context.test.ts`: real ATR14 present → `atr14_estimated: false`; prior-day-range fallback → `atr14_estimated: true` (and the correct estimated value, 4); 1.5%-of-spot fallback (no range either) → `atr14_estimated: true` (value 1.5); no dossier/tech at all → `atr14: null, atr14_estimated: false` (never claims "estimated" when there's no number to label).
- RED: reverted `publish-context.ts` only (kept the new tests) — exactly the 4 targeted assertions failed (`undefined` where `false`/`true` was expected); the 8 pre-existing tests were unaffected.
- GREEN: restored the fix — 12/12 pass in `publish-context.test.ts`.
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14052/14055 pass, 0 fail, 3 skipped.

### What was deliberately left unchanged

`estimateAtr()`'s own estimation logic (prior-day range, then 1.5% of spot) is untouched — this fix only adds the missing label, it does not change which number gets computed or when. `publish-gates.ts`'s `target_unreachable` gate logic itself is untouched; it now has access to `geo.atr14_estimated` if a future PR wants the gate's own rejection reason to surface it, but that surfacing is a separate, natural follow-up not attempted here (scope discipline — this PR fixes the missing label, not every consumer's use of it).
