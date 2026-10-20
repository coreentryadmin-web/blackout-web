## 2026-10-20 — [FINDING, P1 Night Hawk 0DTE] trim_scale's live tranche-banking never fires — every A/B-tier play exits via the shared floor, not its own ladder

> **kind:** FINDING

**Context.** Member live-book audit directive: "Verify whether Night Hawk's intended trim
ladder is +25%, +50%, and +100%... Explain which rules closed today's winners before the
first trim, especially the ratchet exits. Check whether those rules conflict with the
intended ladder, and test any correction before changing production."

**The intended ladder (verified against the real shipped constants, `exit-engine.ts`).** Not
literally +25/+50/+100 as three independent trim points. The real shape: `tranche_fraction =
1/3` (not half) banked at TWO regime-conditioned peak thresholds — `neutral: [20%, 50%]`,
`trend: [40%, 80%]`, `range: [15%, 40%]` (the module's own doc comment describes the
E5-measured recommendation as "⅓@+25%/⅓@+50%" — the shipped neutral constant is actually
+20%, a minor separate discrepancy, flagged but not the main finding) — then the last third
runs to the **+100%** target (`PLAN_RULES.target_pct`) or the plan stop/time-stop. Between
tranches the remainder is protected by the SAME peak-scaled shared floor the ratchet mode uses
(`0.4 x peak`); once both thirds bank (or peak clears target) a flat **+50%** runner floor
protects the last third.

**What's actually closing every trim_scale-committed winner: the shared floor, never a trim.**
Checked all 19 of today's closed trades: 13 were frozen `exit_policy_at_commit: "trim_scale"`
(A/B-tier — should get the ⅓/⅓/run ladder). **All 13 exited via a `categorizeExitReason`
"ratchet" bucket**, `timeline_tranches: null` (no partial bank ever recorded),
`mfe_capture_pct` consistently ~35-46% of peak — the exact signature of a pure `peak*0.4`
floor dump, not a banked-then-run ladder. Cross-checked against the AUTHORITATIVE (not
display-only) `GET /api/market/zerodte/record` fields across a real 14-day window (109
trim_scale rows carrying a WS-11 reconstruction): **every single one** shows `managed_source:
"engine"` with a single, whole-position exit as the real, as-managed outcome — never a
genuine partial scale-out — while several of those same rows' own WS-11 bar-walk
reconstruction (`entry_context.executable.tranches`) independently shows a real, achievable
first-tranche price the underlying genuinely reached (e.g. MSTR 2026-10-16: reconstruction
shows a real tranche at 12:35 ET banking 1/3 at +16.13%, a second at 13:06 ET at +45.16% — real
price levels that really occurred — yet the row's real, live-managed outcome was a single
"ratchet" exit at +5%, zero tranches ever banked). `managedGradeView` (record.ts) correctly
does NOT substitute the reconstruction for the real outcome here — its own documented
precedence rule treats a bar-walk continuation past an already-closed, ratchet-floor-exited
position as fictitious, not a correction. **This is not a case of members seeing a wrong
number — it is a case of the real, live position management never doing what its own frozen
policy promises.**

**The mechanism this is consistent with** (`exit-sync.ts`): `resolveTrimBankLive()`/
`resolveTrimRegimeLive()` gate whether the live engine reads a real persisted `trims_taken`
count, or recomputes it fresh every tick via `trimTranchesArmed(peak, regime)` — the SAME
function `decideTrimScale` uses for its own `armed` variable, on the same inputs. When
effectively off, `trimsTaken === armed` by construction, so `trimAvailable = armed > taken`
can never be true — the trim-ladder's TRIM action is structurally unreachable. This exact
failure mode is independently documented in `FINDINGS.md`'s own history (`ZERODTE_TRIM_BANK_LIVE`
"merged disarmed... flipping it live is a deliberate operator follow-up"; `ZERODTE_TRIM_REGIME_LIVE`
"stays off") as the KNOWN bug this flag exists to fix. Separately, directly observed (not
inferred): EVERY `exit_policy_snapshot.trailing_rule` checked today shows
`active_regime=neutral` regardless of the row's own `session_regime` column (`range` in
several cases) — confirming `resolveTrimRegimeLive` is not honoring the stamped regime live.
**Could not verify the live `ZERODTE_TRIM_BANK_LIVE`/`ZERODTE_TRIM_REGIME_LIVE` env values
directly (no AWS creds this sandbox session)** — the code's own inline comments claim "ON by
default," contradicting both FINDINGS.md's account and 14+ real days of observed production
behavior; whether that is a stale comment or an explicit deployed override is NOT resolved
here. Only the observed, empirical production behavior (zero genuine tranche banks across the
entire sample) is a confirmed fact.

**Test run before any change** (member directive: "test any correction before changing
production"). `scripts/audit/zerodte-trim-bank-live-ab.mjs`: real historical trim_scale
population, real Polygon minute bars, real NBBO costs, through the REAL imported
`exit-engine.ts` functions, comparing `broken_live` (today's real mechanics) vs `fixed`
(a genuine monotonic `trims_taken` latch). 45-day window, cap 100/half: n=96/90 graded (8/96,
19/90 rows ever armed a tranche — most real rows never reach a high enough peak at all; median
real peak across 249 rows is +5.5%, well under the +20% first trigger). Result: mean_delta
TRAIN -0.39% (CI [-1.31, +0.53]), VALIDATION -0.61% (CI [-1.55, +0.34]) — both INCONCLUSIVE, CI
straddles zero, but consistently slightly negative in both halves (same direction as the
sibling loss-side-exit-ab.mjs finding).

| **Status** | CONFIRMED (the mechanism does not fire live) — no gate/exit rule/env flag changed. Fixing this is a config decision (flip `ZERODTE_TRIM_BANK_LIVE`/possibly `ZERODTE_TRIM_REGIME_LIVE`), not a code change, and this codebase's own calibration-first discipline explicitly reserves that decision for a deliberate operator review once the economic case is clear — this first backtest does not yet establish a clear case either way. **Protective and time exits (hard stop, thesis-break, flat-timeout, the shared floor itself) are independently verified intact and firing correctly** — this finding is specifically about the missing partial-profit-taking step, not any capital-protection rule. |

Full write-up: `docs/audit/0DTE-RESEARCH.md`, "Live trim_scale tranche-banking never fires in
production" section.
