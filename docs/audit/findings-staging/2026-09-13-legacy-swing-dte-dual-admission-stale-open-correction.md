## 2026-09-13 — [FINDING, P4 audit-hygiene] Legacy→Swing dte<5 dual-admission (2026-08-06 P1) re-verified FIXED — FINDINGS.md's "NOT FIXED" status is stale — CORRECTED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | CORRECTED — documentation-only, no code change (the underlying bug is already fixed). |
| **Severity** | P4 — audit-hygiene, same class as the other `docs/*-stale-status-correction` entries already in this file (Meridian estimate-revision, SPX Slayer Largo, HELIX conviction-label, BREAKOUT-ranker). No live product impact from the staleness itself; the risk it corrects is a future session re-discovering and re-flagging (or worse, re-building) a fix that already shipped. |

### What was found

DISCOVERY-cycle re-verification of the 2026-08-06 P1 finding **"Legacy→Swing promotion path admits dte<5 contracts, reopening the dual-admission gap for a SECOND code path"** (`docs/audit/FINDINGS.md` line ~40378), still headed `NOT FIXED — flagged, architecturally significant` with `**Status** | FLAGGED, NOT FIXED.`

### Re-verification

`src/lib/swing/legacy-confirm-promote.ts` now exports `filterChainRowsForSwingPromotion` (lines 61-71), whose own doc comment cites this exact finding:

```
/**
 * Legacy promotion must not admit contracts below the Swing lane floor — the same [dteMin, dteMax]
 * window organic discovery and produceHorizonPlays enforce. resolveTickerChainRows returns front
 * expiries with no DTE filter; without this, a dte 2–4 contract overlaps the 0DTE board (FINDINGS
 * 2026-08-06 P1 dual-admission on the Legacy→Swing path).
 */
```

Confirmed genuinely wired, not dead code: called at line 179 (`const swingChainRows = filterChainRowsForSwingPromotion(chainRows, editionFor);`), inside the actual promotion pipeline the original finding traced. Root cause traced to commit `c9a93bf5b` / **PR #3562**, `"fix(swing): enforce SWING dteMin on Legacy morning-confirm promotions"` (2026-09-04, Cursor + operator co-authored) — shipped exactly the finding's own "Suggested next step" option (a): filtering `resolveTickerChainRows`'s candidate expiries to `[HORIZONS.SWING.dteMin, dteMax]` for the Legacy-promotion path specifically. The PR also fixed the finding's secondary root-cause note (the cosmetic hardcoded `intendedDte: 14`) by deriving `intendedDte` from the actual picked contract instead. Regression coverage exists: `legacy-confirm-promote.test.ts` line 152, `"filterChainRowsForSwingPromotion drops sub-floor expiries"`, plus an assertion at line 97 that every promoted contract clears `HORIZONS.SWING.dteMin`.

### Why this wasn't dismissed as "looks fixed, might still have a gap"

The original finding named the exact call site (`buildLegacySwingArtifacts`) and the exact missing guard (no dte floor check before commit); the fix adds precisely that guard at precisely that call site, cited by its own doc comment back to this finding number, with a dedicated regression test. This is a direct fix of the named defect, not an adjacent change that happens to look related.

### Why a correction entry, not a re-fix

The bug itself has been fixed for 9 days (since 2026-09-04); nothing to fix in code. The stale `FINDINGS.md` heading is the only remaining defect, and per the standing issue-handling policy's staged-findings convention (see the other `*-stale-status-correction` entries already folded into `FINDINGS.md`), correcting it goes through this same pipeline — a staged finding, not a direct edit to `FINDINGS.md`.
