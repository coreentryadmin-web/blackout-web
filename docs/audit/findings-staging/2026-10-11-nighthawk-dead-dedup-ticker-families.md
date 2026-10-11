> **kind:** FINDING

## Night Hawk Legacy — dead `deduplicateTickerFamilies`, and a stale FINDINGS.md record it corrects — FIXED

**Symptom:** `play-constraints.ts` exported `deduplicateTickerFamilies(items)` — a
post-hoc filter that drops later same-family tickers (GOOGL+GOOG, BRK.A+BRK.B, etc.) from
a ranked list. It had zero real callers anywhere in the repo; only its own 4 direct unit
tests called it. This also corrects a stale `docs/audit/FINDINGS.md` entry ("No
ticker-family dedup — GOOGL + GOOG... FIXED", PR #400) which states the function is
"Wired into both `buildDeterministicEditionPlays` and `buildRescuePlays`" — that wiring
was true at the time but has since been refactored away without updating the record.

**Root cause:** `deterministic-edition.ts` never imports `deduplicateTickerFamilies` —
it imports `canonicalTicker` directly (same file, still genuinely live) and maintains its
own running `selectedFamilies`/`finalFamilies` `Set<string>`, checking membership via
`canonicalTicker()` BEFORE adding each candidate to the selection (an incremental,
build-as-you-go dedup, functionally equivalent to — and simpler than — filtering a
finished list after the fact). The real family-dedup BEHAVIOR is intact and correct in
production (`deterministic-edition.ts:900-970,1018,1043-1045,1141-1210`); only the named
utility function it was originally built alongside is unused. Not a correctness
regression — a stale doc record describing an implementation detail that moved.

**Evidence:** `grep -rn "deduplicateTickerFamilies" src/` before the fix returns only the
definition (`play-constraints.ts:238`) and its own 4 tests
(`play-constraints.test.ts`). `grep -n "canonicalTicker|selectedFamilies|finalFamilies"
src/features/nighthawk/lib/deterministic-edition.ts` confirms the real inline dedup is
live and exercised by `deterministic-edition.test.ts` (99/99 passing after this change,
run together with `play-constraints.test.ts`).

**Fix:** Removed `deduplicateTickerFamilies` and its 4 direct tests. Left `canonicalTicker`
(same file) untouched — it is the one piece of this pair with a real production caller.

**Fix rationale:** Pure deletion of the unused function; the live behavior it would have
provided is already covered by `deterministic-edition.ts`'s own inline dedup, so there is
no gap to fill and no caller to redirect.

**Blast radius:** `src/features/nighthawk/lib/play-constraints.ts` and
`play-constraints.test.ts` only. `canonicalTicker` and its own 4 tests are unchanged.

**Regression guard:** None needed beyond the existing coverage —
`deterministic-edition.test.ts` already exercises the real family-dedup behavior this
removed function never actually provided in production.
