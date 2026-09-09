# G-4 VIX-elevated tier canonicalized — no tape/instrument-type bypass

> **kind:** FINDING

## Root cause

`evaluateZeroDteGates`'s G-4 elevated-VIX branch (VIX in `[17, 20)`) previously computed a
per-ticker/per-tape-alignment score floor instead of applying the F-1 evidence uniformly:

- **Single names bypassed G-4's elevated tier entirely.** `tapeAlignedOrFlat = !isIndexEtfG1 || ...`
  meant any non-index/ETF ticker always evaluated to `tapeAlignedOrFlat = true`, so it kept the
  standard 65 floor (G-3's own) at VIX 17-20 regardless of score, tape, or anything else. The F-1
  evidence backing the 75 floor (69.2% WR at VIX<17 vs 25.0% WR at VIX>=17, the widest split in the
  whole forensics dataset) was never measured as ticker-type-conditional — this exemption meant
  the strongest-measured regime throttle in the gate stack simply didn't apply to most tickers.
- **Index ETFs got a two-tier floor** (65 when tape-aligned/flat, 75 when counter-tape) — a relief
  the evidence never justified either; F-1 measured a VIX-regime effect, not a VIX-regime-except-
  when-the-tape-agrees effect.

This is a CTO-review-approved architecture decision (operator-confirmed, 2026-09-09): VIX >= 17
now requires score >= 75 for **every** ticker and instrument type, no exceptions. The >= 20
extreme-VIX single-name block (index/ETF-only survival, at reduced size) is unchanged — this fix
touches only the elevated (17-20) tier's score-floor branch.

## Blast radius

Three call sites shared the same `tapeAlignedOrFlat` logic and all three are fixed together:
1. The live enforcement branch in `evaluateZeroDteGates` (the `vix >= VIX_ELEVATED_THRESHOLD`
   non-condor branch) — now a flat `elevatedFloor = VIX_ELEVATED_SCORE_FLOOR`.
2. The G-4 **fail-closed** `couldBlock` narrowing (when `vixUnavailable` fires) — previously
   `!isIndexEtf || (!tapeAlignedOrFlat && score < 75)`; simplified to `!isIndexEtf || score < 75`
   since there is no more tape-alignment term to check.
3. `computeGateCalibration`'s g4_vix calibration record (the durable ledger column measuring
   "would the hardened gate have blocked this") — updated to mirror the same uniform floor so the
   calibration record stays consistent with what the live gate actually enforces. The now-unused
   `aligned` local (only ever read by this branch) was removed.

Condor G-4 (which blocks only at extreme VIX, `>= 20` — elevated VIX is a condor's *best* regime,
unrelated evidence) is untouched.

## Fix rationale

Simplify to the canonical rule rather than patch the exemption further — the exemption was
introduced 2026-08-26 to fix a narrower bug (single names being judged against SPY tape they have
no business being judged against for G-1 purposes) but over-corrected by exempting them from G-4's
regime floor entirely. The operator-approved fix removes both the single-name bypass and the
index-ETF tape-alignment relief in one pass, since both trace to the same
`tapeAlignedOrFlat`-shaped logic.

## Evidence

`gates.test.ts` — updated 8 existing tests that asserted the old exempted behavior (single names
clearing the elevated floor at scores well below 75, index ETFs keeping the standard 65 floor when
tape-aligned/flat) to assert the new canonical behavior instead, and added explicit boundary tests
(74 blocks / 75 clears, uniformly, for both index ETFs and single names). Full
`src/lib/zerodte/*.test.ts` suite: 1303 pass / 0 fail on Node 20 after the change (was 138/141 pass
in `gates.test.ts` alone before updating the 3 tests that encoded the old exemption — RED before,
GREEN after). `npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/g4-vix-elevated-canonicalize` |
