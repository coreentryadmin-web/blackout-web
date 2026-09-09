# G-20 input-desync broadened + live-commit-path preconditions (items 9+10)

> **kind:** FINDING

## Context

Two items from the operator-approved CTO gate-architecture review, folded into one PR per
the review's own allowance ("it's fine to fold this into item 9's commit-path work if that's
cleaner than a separate PR"):

- **Item 10 (G-20 broadening).** Verified against `main` directly: no G-20/`input_desync`
  gate exists anywhere in `src/lib/zerodte` — not shipped by an earlier PR today. Built fresh,
  already in the BROADENED shape the review asked for (never the narrower index-ETF-only
  design it described as the thing to widen).
- **Item 9 (cross-cutting fail-open library / fail-closed commit-path pattern).** G-9's
  quote-staleness check, G-12's confluence-unknown fail-open, and G-20's own missing-
  timestamp fail-open all correctly stay PERMISSIVE inside the pure `evaluateZeroDteGates`
  function — deliberately, so a generic/test/fixture caller (replay fixtures, unit tests,
  calibration backtests) is never penalized for data it never had. But the LIVE PRODUCTION
  COMMIT PATH is a different question: for a REAL fresh commit, these three inputs being
  absent means "we don't actually know", not "no evidence of a problem" — a desk that can't
  verify its own commit-time inputs shouldn't write a ledger row on the strength of an
  unverified COMMIT verdict.

## G-20 (input-desync)

`evaluateInputDesync` (gates.ts) checks two independent legs, both fail-OPEN on a missing
timestamp:
1. **Option-quote vs underlying-quote** — applies to EVERY directional setup (the broadened
   scope), not just index/ETF.
2. **Underlying-quote vs SPY/tape** — index/ETF setups ONLY (a single name's own quote has no
   business being compared to SPY's clock — mirrors G-1's own tape-alignment scoping).

Wired into `evaluateZeroDteGates` (DIRECTIONAL only, mirrors the moneyness/qualification-
dislocation condor exemption) via two new `ZeroDteGateInput` fields (`optionQuoteAsOfMs`,
`underlyingQuoteAsOfMs`), plus a `refreshInputDesyncGateBlocks` helper for the thesis-first
deferred-attach path (mirrors `refreshMoneynessGateBlocks`).

**scan.ts wiring**: `attachContractPlans` (where the live options-unified snapshot is in
scope) now also stamps `s.option_quote_as_of_ms` (new `EnrichedZeroDteSetup` field) — the
same source `computeQuoteAgeMs` already reads, captured once and reused rather than
re-derived. Paired against the already-existing `underlying_price_as_of`.

## Cross-cutting live-commit preconditions

`liveCommitPreconditionsUnmet` (gates.ts) — a pure function, checked SEPARATELY from
`evaluateZeroDteGates`, that names every one of {quote-age timestamp, confluence read, G-20
input-desync timestamps} that was never actually present. Computed for every setup right
after its gate verdict (both in the ordinary and the thesis-first-refreshed path — the
thesis-first branch recomputes it once its deferred data lands, same discipline as its other
refresh helpers) and stored on `s.live_commit_preconditions_missing`.

**The actual live commit call site** (the `committedFresh.push(s)` decision in the final
commit loop, `scan.ts`) now refuses to commit a setup whose gate verdict is COMMIT but whose
preconditions are unmet — it downgrades the verdict to BLOCKED with the new
`live_commit_precondition_unmet` code, distinct from any other gate's own block reason, and
records the rejection through the normal rejection-row path. `evaluateZeroDteGates`'s own
permissive behavior is completely unchanged for every other caller.

## Blast radius

- `board.ts`: two new `ZeroDteGateFailure` codes (`input_desync`, `live_commit_precondition_unmet`);
  two new `EnrichedZeroDteSetup` fields (`option_quote_as_of_ms`, `live_commit_preconditions_missing`).
- `gates.ts`: `evaluateInputDesync`/`refreshInputDesyncGateBlocks`/`INPUT_DESYNC_MAX_MS`,
  `liveCommitPreconditionsUnmet`/`LiveCommitPreconditions`, two new `ZeroDteGateInput` fields.
- `scan.ts`: `attachContractPlans` stamps the new timestamp field; `attachGateVerdicts` wires
  the two new gate-input fields and computes the precondition record (both pipeline
  branches); the final commit-decision loop enforces it.

## Evidence

`gates.test.ts`: 11 new tests — the broadened-scope proof (single-name option/underlying
desync blocks, was previously only checked for index/ETF), the index/ETF-only SPY-tape leg,
fail-open per leg, wiring through `evaluateZeroDteGates` (fires, CONDOR-exempt), the deferred-
refresh path, and the precondition function's own boundary matrix. Full
`src/lib/zerodte/*.test.ts` suite: 1311 pass / 0 fail on Node 20 (1 pre-existing unrelated
skip) — including the FULL `scan.test.ts` integration suite, confirming the new live-commit
precondition check does not spuriously block any existing fixture's expected commit.
`npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/g20-input-desync-live-commit-preconditions` |
