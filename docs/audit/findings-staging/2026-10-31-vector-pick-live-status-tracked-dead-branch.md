# 2026-10-31 evaluateVectorPickLiveStatus: unreachable `tracked`/+50% branch shadowed by its own outer check

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 code-quality / latent maintenance hazard (confirmed zero behavior change) |

## Root cause

`evaluateVectorPickLiveStatus` (`src/features/vector/lib/vector-pick-live-status.ts`) has, in
order:

```ts
if (premiumPct != null && premiumPct >= 50) {
  return { status: "caution", reason: `Winner +${...}% — manage exit, not fresh entry`, ... };
}

if (premiumPct != null && premiumPct >= 20) {
  if (intent === "tracked") {
    if (premiumPct >= 50) {                       // <- UNREACHABLE
      return { status: "caution", reason: `Winner +${...}% — manage exit, not fresh entry`, ... };
    }
    return { status: "caution", reason: `Extended +${...}% — limit only, not fresh entry`, ... };
  }
  return { status: "dont_buy", reason: `Premium extended +${...}% since pick — chase risk`, ... };
}
```

The first `if (premiumPct >= 50)` check is **unconditional on `intent`** — it returns for any
`premiumPct >= 50` regardless of whether the caller is `fresh_entry` or `tracked` (this is
deliberate and tested: `"+50% winner is caution even for fresh_entry intent"`). By the time
execution reaches the second `if (premiumPct >= 20)` block, `premiumPct` is therefore guaranteed
to be `< 50` (the guard requires it to be non-null, and anything `>= 50` already returned above).
The nested `if (premiumPct >= 50)` inside the `intent === "tracked"` branch can never be true —
it duplicates the exact same "Winner … manage exit" return as the outer check, but is permanently
shadowed by it. This has been flagged by name across 4+ prior audit rounds without being actioned.

This was not found to cause any observable defect — the outer check already produces the correct
member-facing message for every `premiumPct >= 50` case, `tracked` or not. The problem it created
is a **latent maintenance hazard**: a future edit to the outer check (e.g. narrowing it to
`intent !== "tracked"`, a plausible-looking change given this file's heavy use of intent-specific
branches elsewhere, such as the `caution`-not-`dont_buy` winner-preservation logic documented at
the top of the file) would silently "revive" the inner branch without anyone noticing it had been
dead the whole time, and the two duplicated return blocks could then drift out of sync (one
message gets updated, the shadowed copy doesn't) with no test ever exercising the stale one.

## Evidence

Proven via `git stash` on `src/features/vector/lib/vector-pick-live-status.ts` alone (test file
kept): two new boundary-pinning tests —
`tracked intent at exactly +50% hits the Winner/manage-exit message` (premiumPct = 50) and
`tracked intent just under +50% hits the Extended/limit-only message` (premiumPct = 49) — both
**pass identically before and after** the removal (27/27 `vector-pick-live-status.test.ts` cases
green on the pre-fix source, 27/27 green post-fix). That is the correct signature for a pure
dead-code removal: there is no RED state to produce, because no caller-observable output ever
depended on the removed branch. The two new tests exist to make that non-dependence explicit and
to catch any future refactor that would change the boundary behavior.

## Blast radius

Single call site inside `evaluateVectorPickLiveStatus` itself. No other function reads or branches
on this code; `vector-pick-sweep-core.ts`, `vector-pick-sweep.ts`, `use-vector-pick-live-monitor.ts`
and `VectorContractPicksCard.tsx` all consume only the function's return value, which is unchanged
for every input (verified by the full existing + new test suite passing identically pre/post-fix).

## Fix

Removed the unreachable nested `if (premiumPct >= 50)` inside the `intent === "tracked"` branch,
leaving the single `"Extended +X% — limit only, not fresh entry"` return — the only code that
could ever execute there, since the outer `>= 50` check above already intercepts every case the
nested check was trying to handle. Added an in-code comment explaining why the branch was dead and
what plausible future edit would have silently un-shadowed it, so the hazard is documented rather
than only fixed. No behavior change for any input, confirmed by the stash proof above.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/features/vector/lib/vector-pick-live-status.test.ts`
  — 27/27 green (25 pre-existing + 2 new boundary tests), and 27/27 green on the pre-fix source too
  (proving no behavior change, not just "fix passes").
- `npx tsx --experimental-test-module-mocks --test src/lib/vector/vector-pick-sweep-core.test.ts src/lib/vector/vector-pick-closure-log.test.ts` — 46/46 green, no regressions in callers.
- `npx tsc --noEmit` and `npx eslint src/features/vector/lib/vector-pick-live-status.ts src/features/vector/lib/vector-pick-live-status.test.ts` — both clean.
