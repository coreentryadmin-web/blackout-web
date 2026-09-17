> **kind:** FINDING

## A committed 0DTE iron condor cast a fabricated bullish/bearish vote in TWO Largo-facing aggregations — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | 0DTE deep-dive (Largo product contract compliance) — continuation of the #5104 cross-product identity fix, per the operator's "keep digging into every design and architecture of 0dte" directive |
| **Severity** | P1 (Largo-facing: a delta-neutral premium-selling structure was represented to the model as a directional bet, corrupting both a single-ticker cross-product read and the whole-ecosystem consensus matrix) |
| **Files** | `src/lib/largo/contract/product-adapters.ts` (`nighthawkContribution`), `src/lib/largo/consensus-read-extract.ts` (`extractNightHawkRead`) |
| **Found by** | Architectural trace of every place the 0DTE engine aggregates a "vote"/"direction"/"signal" across sources, starting from the operator-flagged condor-direction gap in the prior audit pass |

### Root cause

A committed 0DTE iron condor (`condor.ts`) is a delta-neutral 4-leg structure SOLD for a credit.
Its `direction` field is explicitly documented as nominal-only: `buildCondorSetup`'s own comment —
*"`direction` carries the pin's nominal fade side for provenance but is UNUSED by the neutral
structure's gates/grader."* Two Largo-facing aggregations read that field as if it were a real
directional stance anyway:

1. **`nighthawkContribution`** (the Night Hawk adapter feeding `crossProductRead`, the "does
   everyone agree on this ticker" cross-product join) counted every committed play's
   `option_type ?? side ?? direction` toward a calls/puts tally. A condor row carries no
   `option_type`/`side` — only the nominal `direction` — so it fell straight through to the same
   bullish/bearish tally a real directional play uses.
2. **`extractNightHawkRead`** (the whole-board "NIGHT_HAWK: 0DTE plays are bullish/bearish" system
   read feeding `buildConsensusMatrix`'s ecosystem-wide agreement verdict — HELIX/THERMAL/VECTOR/
   SPX/NIGHT_HAWK/MERIDIAN) had the exact same shape of bug: it counted every play's `direction`
   toward `bullishCount`/`bearishCount` regardless of structure.

Net effect: a board holding only a condor (no real directional 0DTE plays at all) could still
report a confident directional Night Hawk vote into BOTH the per-ticker cross-product read and the
whole-ecosystem consensus matrix — fabricating agreement or disagreement with Helix/Vector/etc. off
a structure that has no directional thesis to agree or disagree with. This is the exact same
"neutral evidence miscounted as directional" shape `thermalContribution` (dealer gamma) and
`meridianContribution` (symmetric expected move) already guard against in the same adapter file —
the condor case was simply never closed.

### Evidence

RED before the fix (`git stash` proof, Node 20, `--experimental-test-module-mocks`):
- `product-adapters.test.ts`: 1 failure — a lone committed condor (`is_condor: true, play_type:
  "CONDOR", direction: "short"`) on SPX returned `signal.direction: "short"`→`"bearish"` instead of
  an honest non-directional absence.
- `consensus-read-extract.test.ts`: 1 failure — a board holding only that same condor read
  `NIGHT_HAWK: bearish` into the consensus matrix instead of `neutral`.

GREEN after: both suites pass in full (18/18 and 7/7 respectively); `npx tsc --noEmit` clean; full
`npm test` on Node 20 green (see PR).

### Fix rationale

Exclude condor rows from the directional tally entirely at both sites, mirroring the existing
`meridianContribution`/`thermalContribution` pattern: when every committed play on the
ticker/board is a condor, report an honest non-directional absence naming the condor count and WHY
it doesn't vote, rather than fabricating a direction. When a real directional play is ALSO present
alongside a condor, the condor is excluded from the tally but still surfaced as context evidence
("N committed iron condor(s), neutral, excluded from this vote") so the information isn't silently
dropped — it just isn't miscounted as a directional signal. This is strictly additive: no existing
correct directional vote changes; only the previously-fabricated condor vote is removed.

Considered and rejected: silently dropping the condor from the response with no mention at all —
rejected because the contract's own "absence must be explained" principle
(`docs/audit/LARGO-PRODUCT-CONTRACT.md`) requires naming why a system that could have voted didn't.
