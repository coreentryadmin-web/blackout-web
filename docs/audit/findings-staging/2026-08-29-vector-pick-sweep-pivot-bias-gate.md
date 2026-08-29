## The server-side Vector pick sweep skipped every committed pivot play entirely — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in `fix/vector-pick-sweep-pivot-bias-gate` |
| **Severity** | P1 — real trade decision surface, server-side Vector pick sweep (cron) |
| **Surface** | `src/lib/vector/vector-pick-sweep-core.ts` `pickContextFromFullState`, `src/lib/vector/vector-pick-sweep.ts` `sweepVectorPickForTicker` |

### Root cause

Same root cause as the already-fixed `contract-picks/live/route.ts` bug (2026-08-29,
`fix/vector-pivot-pick-bias-live-status`), in a second, independent call site: a committed
`pivot` play's raw card bias stays `"neutral"` by design (long above the gamma flip / short
below, until spot commits) — but two places in the server-side Vector pick sweep gated on that
raw field directly instead of the committed direction:

1. `sweepVectorPickForTicker` (`vector-pick-sweep.ts:86`): `if (!state?.spot || !state.play ||
   state.play.bias === "neutral")` returned `SKIP` before the ticker ever reached ranking —
   silently treating **every** committed pivot ticker as "no directional play," regardless of
   whether spot had actually cleared the flip and a real direction existed.
2. `pickContextFromFullState` (`vector-pick-sweep-core.ts`): the same raw-field check
   (`play.bias === "neutral"`) inside the pure context builder, currently unreachable via its one
   caller (which already filtered the same case one line earlier) but duplicating the same wrong
   logic — left uncorrected, it would reproduce the identical bug for any future second caller.

Additionally, once past the (buggy) gate, `evaluateVectorPickLiveStatus`'s `bias` input
(`vector-pick-sweep.ts:143`) was fed the raw `play.bias` directly — the exact same
live-status pivot-bias bug already fixed in the `contract-picks/live/route.ts` call site,
unfixed here.

Note `rankVectorPlayCandidates` (`vector-play-candidates.ts:526`, called via
`buildRankedVectorPicks`) already correctly re-derives the effective bias internally — but that
correctness never mattered here, because the sweep never called it at all for a committed pivot
ticker; execution stopped at the gate before ranking could run.

### Evidence

New tests in `vector-pick-sweep-core.test.ts`:
- `pickContextFromFullState` with a `pivot` play, raw `bias: "neutral"`, and spot 0.3% above the
  gamma flip (a real commitment) returned `null` before the fix — now returns a context whose
  `play.bias` is `"long"` (the committed direction).
- The uncommitted case (spot sitting exactly on the flip) still correctly returns `null`.

13/13 tests pass in `vector-pick-sweep-core.test.ts`, `npx tsc --noEmit` clean across the repo.

### Blast radius

Two files, three call sites, one root cause: `sweepVectorPickForTicker`'s early-return gate,
`pickContextFromFullState`'s internal gate, and the `bias` fed into `evaluateVectorPickLiveStatus`
downstream in the same function. `playJson.bias` (the persisted display/audit snapshot of the
play card) is deliberately left as the raw bias — it mirrors what the play card itself shows,
not a ranking/status computation input.

### Fix rationale

`pickContextFromFullState` now computes `effectivePickBias(play, spot, gammaFlip)` once and
substitutes it into the returned context's `play.bias` (mirroring exactly what
`rankVectorPlayCandidates` already does internally for ranking), returning `null` only when there
is genuinely no committed direction — covering both a truly neutral non-pivot play and an
uncommitted pivot in one check. `sweepVectorPickForTicker`'s early-return no longer duplicates the
bias check (removed, now redundant and a correctness risk if it drifted from the real gate); it
relies on `pickContextFromFullState`'s own (now-correct) null return as the single source of
truth. The live-status call now reads `ctx.play.bias` (already the committed bias) instead of the
raw `play.bias`.
