## 2026-10-19 — [FINDING, P3 Night Hawk 0DTE] No relative-volume signal in live discovery — scoped shadow-mode implementation added, not yet wired in — FIXED

> **kind:** `FINDING`

| **Status** | FIXED (shadow module added; live wiring deliberately deferred — see below) |
|---|---|

**Context.** Operator audit request (chat session, 2026-10-19): compare the live 0DTE engine
against a third-party Discord "daily recap" claiming a 92.9% win rate on QQQ/SPX/SPY/MU/NVDA/TSLA/
AMZN 0DTE calls, and improve the engine's ability to catch strong setups early. Full audit covered
six requirement areas (discovery, contract selection, trigger clarity, live management, quality-
over-quantity, honest performance reporting); this finding covers one concrete, real gap found in
area 1 ("find the setup early").

**What's missing.** Checked directly (grep + read, not inferred): `src/lib/zerodte/intraday.ts`
computes VWAP, opening-range break, and 5-minute trend from real minute bars; `scan.ts`/
`breakout-source.ts` screen the whole market by gain %, $-volume, and close-strength. Nothing
anywhere in the live discovery pipeline compares a name's OWN volume today to its OWN normal pace
— i.e. "is THIS stock trading unusually heavy for itself right now," a distinct signal from
BREAKOUT's absolute $-volume screen (which favors already-large-cap/high-liquidity names
regardless of whether today is unusual for them specifically).

**Fix — deliberately scoped as shadow-only, not wired into any live path.** Added
`src/lib/zerodte/relative-volume.ts`: a pure `computeRelativeVolume()` function implementing the
standard RVOL formula (cumulative volume-to-date ÷ (trailing average daily volume × fraction of
RTH session elapsed), time-of-day-prorated so the same raw volume doesn't read as "quiet" at 9:35
and "heavy" at 15:55). Classification thresholds (`RVOL_VERY_HIGH`/`RVOL_HIGH`/`RVOL_LOW`) are
named constants, explicitly documented as **initial and uncalibrated** — starting points from
common retail-scanner convention, not derived from this codebase's own outcome data.

**Why this is NOT wired into `compose.ts`'s cortex scoring or any discovery/gate path.** The live
0DTE board commits real capital; CLAUDE.md's own standing discipline treats any ambiguous or
live-trading-path change as "report with evidence, hold," not "ship unilaterally." A brand-new
signal's thresholds have zero real-outcome validation yet — wiring it into active scoring before
that validation exists would be shipping an unvalidated change straight into the commit path. This
module is therefore intentionally standalone: it imports nothing from, and is imported by nothing
in, the live board/scan/cortex/commit pipeline. It is provably zero-behavior-change dead code until
a deliberate follow-up PR wires it in — the intended path (documented in the module's own header
comment): attach the read additively and non-gating onto `entry_context.shadow_signals` on every
scanned setup (same idiom `thesis_first`/`why_now` already use for diagnostic-only fields), let it
accumulate real paired (reading, eventual outcome) data across real sessions, then open a SEPARATE
PR to register it as an actual cortex source only once a real sample justifies specific thresholds.

**Evidence.** `src/lib/zerodte/relative-volume.test.ts`, 11 tests covering: pre-open/post-close/
too-early nulls, exact-pace→ratio≈1.0, classification boundaries at each threshold, non-finite/
negative-input guards (never fabricates a ratio), zero-volume-so-far as a real low reading (not an
absence), and purity/determinism. **RED→GREEN proven directly**: temporarily stubbed
`computeRelativeVolume` to always return nulls → 5/11 tests correctly failed (the ones asserting a
real nonzero ratio/classification; the pure-null-case tests correctly still passed, proving they
weren't false positives) → restored the real implementation → 11/11 pass.

- `node --import tsx --experimental-test-module-mocks --test src/lib/zerodte/relative-volume.test.ts`
  (Node 20, `/opt/node20/bin/node` v20.20.2): **11/11 pass**.
- `npx tsc --noEmit`: clean, no new errors.
- Two new files only (`relative-volume.ts`, `relative-volume.test.ts`); zero existing files touched.

**Blast radius.** None on any live path — this PR cannot change any member-facing behavior, since
nothing imports the new module. Blast radius is entirely future: whatever PR eventually wires it in
inherits the scope/review discipline that wiring deserves, separately from this one.

**Fix rationale.** Considered wiring it directly into `compose.ts` as a new cortex source (the
established pattern — see `opening-harvest.ts`) to move faster. Rejected: that immediately changes
real commit scoring with zero outcome validation behind the new signal, which is exactly the kind
of live-trading-path risk this repo's own standing discipline exists to prevent. Shipping the pure,
tested, unwired module first — then validating via shadow observation before ever gating anything
on it — is the smaller, safer, more honest first step.
