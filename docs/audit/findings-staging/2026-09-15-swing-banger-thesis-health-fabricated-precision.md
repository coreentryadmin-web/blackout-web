> **kind:** FINDING

## Ask Largo's Thesis Health panel rendered a fabricated-precision, byte-identical pillar breakdown for every Banger-origin swing position — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**What was broken:** live-verified (forensic batch, 2026-09-15): three real, distinct open positions —
ALLT, CGEM, DRIP (different tickers, different underlyings, different contracts, all currently
50% banked at +100% via the mechanical scale-out ladder) — all rendered an **exactly identical**
"Thesis health" panel: 70% health, "Minor drift" rung, and byte-for-byte identical per-pillar text
and point deltas (Persistence −10.0, Entry geometry +0.0, Signal stack +0.0, Regime fit +0.0, Theta
budget −3.0). This reads to a member as genuine, per-position 5-pillar multi-factor analysis. It is
not: `horizonPlayFromBangerPosition` (`src/lib/swing/banger-lane-merge.ts:39-129`) stamps
`setupState:"TRIGGERED"`, `entryStatus:"AT_TRIGGER"`, `signalKinds:["BANGER"]`, and
`regime:"BREAKOUT · BANGER"` as **fixed constants on every single banger_positions ledger row**,
regardless of ticker or price action — per that function's own header comment, "there is no separate
7-pillar dossier for this lane," it is one mechanical price trigger (`zerodte/scale-out.ts`'s
`deriveScaleOutAction`, a simple `mark ≥ 2× entry → TAKE_PARTIAL` rule). With DTE the only input that
can vary between two Banger rows, any two positions at the same DTE necessarily produce the exact
same health score and pillar text.

**Root cause:** `thesisHealthUncalibrated()` (`src/lib/swing/thesis-health.ts:52-62`) is the existing,
deliberately-built honesty gate that every consumer of thesis-health data (`play-brief.ts`,
`play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`, `play-brief-diff.ts`,
`play-brief-absence.ts`, `terminal-display.ts`, command-deck `adapters.ts` — enforced repo-wide by
`play-brief-pillar-guard.test.ts`, which fails the build if any function reads `.pillars`/`.status`
without this guard) relies on to decide whether to render the pillar breakdown at all. It was built,
per its own history, specifically to suppress exactly this "unguarded pillar read" shape — but it
detects miscalibration only by checking three pillar labels against known *sentinel defaults*
(`"unknown"`/`"n/a"`/`"no signals"`, used when a NATIVE swing position is missing commit-time
inputs). Banger's stamped values are concrete, non-sentinel strings ("triggered", "at trigger"), so
none of the existing checks fire, and the guard returns `false` (calibrated) for every Banger row —
the exact C6 violation `docs/audit/LARGO-PRODUCT-CONTRACT.md` names verbatim: *"If a product cannot
produce a calibrated score, OMIT the field... An invented score is worse than nothing."*

**Fix rationale — why the regime-string fingerprint, not `signalKinds`:** the obvious first fix
("treat `signalKinds === ["BANGER"]` as uncalibrated") is wrong and was explicitly tested against and
rejected: `discovery.ts`'s `SwingDiscoveryPath` includes `"BANGER"` as one of several *real* Tier-0
origins a **native** `swing_positions` row can be discovered through
(`discovery.test.ts`: `JOBY -> ["BANGER"]`) while still running the real scoring/setupState/
entryStatus/regime engine — not the stamped ledger-merge path. Keying on `signalKinds` alone would
have wrongly suppressed genuinely calibrated thesis health for that case (a new false negative
traded for fixing a false positive). The regime string `"BREAKOUT · BANGER"` is written **only** by
`horizonPlayFromBangerPosition`/`horizonPlayFromBangerWatch` (repo-wide grep: two call sites, both
in `banger-lane-merge.ts`) and flows through `regimeScore()` into the pillar's `currentLabel`
verbatim — an unambiguous, safe fingerprint of the stamped-constant path specifically, with no
overlap with any real native-position regime string.

**What changed:** `thesisHealthUncalibrated()` gained one additional check, after the existing
sentinel-label loop: if the `regime` pillar's `currentLabel` equals `"BREAKOUT · BANGER"`, treat the
payload as uncalibrated. No other file changed — every consumer already routes through this one
guard function, so the fix is single-function and the fabricated breakdown is now correctly omitted
(same downstream `null`/omission behavior as any other uncalibrated native row) everywhere it used to
render.

**Test:** RED→GREEN proven (`git stash` on `thesis-health.ts` only): the new
`"thesisHealthUncalibrated: true for the stamped Banger-ledger fingerprint"` test fails pre-fix,
passes post-fix. Also added a byte-identical-output regression test (proving the underlying
"fabricated precision" symptom independent of the flag) and a negative test proving the fix does
**not** false-positive on a native swing position whose sole discovery signal happens to be `BANGER`
with a real (non-stamped) regime string — guarding against the rejected, over-broad
`signalKinds`-only alternative. Full `src/lib/swing/*.test.ts` + `src/features/nighthawk/command-deck/*.test.ts`
(1588 tests) green on Node 20 with `--experimental-test-module-mocks`, `tsc --noEmit` clean.
