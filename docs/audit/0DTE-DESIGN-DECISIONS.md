# 0DTE Unification — Design Decisions & Open Gaps (Q&A of record)

Answers to the 15 rigorous design questions posed 2026-07-25, verified against the code. Status:
✅ answered · 🟡 works, with a caveat / design-call · 🔴 genuine gap needing a decision.
The 🔴 items are the hardening backlog (several are safety/integrity, not polish).

---

## Answered / handled (✅)

**Q4 — What data freshness permits a Cortex source to veto?**
A veto requires a **live evidence item within the source's half-life decay window**; items self-silence
beyond ~3 half-lives (`compose.ts`) and become ABSENT. The Phase-0 veto-blind firewall then HOLDs a fresh
commit when BOTH veto-capable sources (gex-walls, flow-quality) are absent/stale — a stale veto source
can't fail-open. Exact half-lives are per-source constants.

**Q5 — Are WATCH/vetoed/gate-blocked setups shadow-graded?**
Hard-gate SKIPs (and Cortex blocks, via the same rejection plumbing) ARE graded counterfactually
(`skip-grading.ts`), consumed by calibration (`gradedSkips`) — so gate opportunity-cost is measured.
Caveat: below-floor WATCH near-misses aren't uniformly graded.

**Q6 — Same-minute target/stop collision?**
`gradePlanFromBars` resolves **stop-first** (pessimistic) on a both-touched bar; live status uses the
optimistic peak; the two are reconciled in `record.ts`. Deliberate, conservative, documented.

**Q11 — Are gate outputs logged individually after an earlier block?**
Split: the **hard-gate stack accumulates ALL applicable blocks in one pass** (a counter-tape long at 9:40
logs both `tape_alignment` and `opening_window`). The **evidence gates** (inside `deriveZeroDteSetups`)
short-circuit — only the first failing evidence gate is recorded, later ones never computed.

**Q15 — Partial provider degradation?**
Core of Phase 0: the affected gate **fails closed** (holds the fresh commit); the affected discovery
source **SKIPs** (degrades to flow-only); Cortex **veto-blind HOLD** if both veto sources are down. The
board keeps running on what it can see but never commits what it can't validate.

---

## Works, with a caveat / design-call (🟡)

**Q1 — Opposing directions, same ticker across origins.** `mergeDiscoveryOrigins` keeps the first/
evidence-bearing setup's direction (flow wins over a fade) and only unions the origin tag; the opposing
read is masked. DECISION NEEDED: flag opposing co-discovery as a no-trade conflict, or keep both rows so
the origin band can grade it. (Currently masked — noted in `mergeDiscoveryOrigins`.)

**Q3 — Shared score formula or per-origin?** Per-origin (FLOW additive; BREAKOUT gain×close; PIN
dominance×containment), all mapped to a common 0–100 scale sharing G-3's 65 floor, but NOT calibrated to
equal EV. The origin band is what will prove/correct cross-origin equivalence; today it's an assumption.

**Q13 — Who selects RATCHET vs TRIM, frozen before entry?** A global operator env (`ZERODTE_EXIT_MODE`),
same for every play, read at exit-time — NOT per-archetype, NOT frozen at entry. A mid-session flip would
change how open plays exit. Cleaner: freeze the exit archetype on the ledger row at commit.

**Q14 — Is the 10:00 gate universal?** Universal (all directional origins + condor share G-2), measured on
the directional-flow board. A breakout gap-and-go or a condor (wants the opening range to settle) may want
a different window — unmeasured; per-archetype timing is a calibration follow-up.

---

## Genuine gaps needing a decision (🔴 — the hardening backlog)

**Q8 — American assignment & expiration. [SAFETY — FIXED for condor 2026-07-25]**
Index options (SPX/XSP/NDX/RUT) are European + cash-settled → no assignment. American ETFs/single names can
be assigned early when a short is ITM, past the "defined loss" the grader assumes. **Fix shipped:** the
condor SELL path is restricted to cash-settled index roots (`condorEligibleTicker`, Phase 4); American
underlyings stay the directional fade. Full early-assignment modeling (to ever admit ETF condors) remains
open.

**Q9 — Governor same-direction correlation. [SAFETY — OPEN]**
The governor blocks OPPOSING correlated plays (SPY-long + QQQ-short) but NOT same-direction concentration
(SPY-long + QQQ-long + IWM-long = 3× the same beta). Needs a concentration cap, not just a contradiction cap.

**Q12 — Version mixing across score/gate/exit changes. [INTEGRITY — OPEN]**
No scorer/gate/exit/feature version stamp on ledger rows (grep-confirmed). A formula/gate/exit change silently
blends old + new graded plays in one calibration band. Needs a version stamp + bucket-by-version so a change
can't corrupt its own evidence.

**Q2 — Weekly fallback grading. [AMENDED 2026-08-06 — ceiling widened, not a separate horizon]**
Originally: a weekly-fallback contract stayed in the same 0DTE ledger with `dte` stamped, no separate
horizon tag, graded with the 0DTE 15:30 same-day time-stop — wrong for a multi-day weekly. Live evidence
(2026-08-06, FINDINGS.md) showed the REAL problem was the ceiling itself: `dte≤1` structurally starves
single-name equities (most carry no Mon–Thu listing) on every day but Thu/Fri, and the underlying
same-day EXIT discipline (session-clock, not expiry-clock) already holds correctly through dte=4 — G-15's
removal note had already proven this for dte=1 in production. Fix: `horizons.ts`'s `ZERODTE_MAX_DTE`
widened 1→4 — `ONE_DTE` now legitimately covers dte 1-4 (still graded same-day, still session-clock, still
`same_day_1530_close`), and dte≥5 remains `WEEKLY_FALLBACK` (excluded, never committed) exactly as before.
So this is NOT "give the weekly fallback its own grading horizon" — it's "the horizon it was already
correctly using was drawn one dte too narrow." `strategy-version.ts`'s `DISCOVERY_VERSION`/
`CONTRACT_SELECTOR_VERSION` bump (v4→v5, v1→v2) partitions pre/post-widening `ONE_DTE` rows into separate
calibration cohorts so this remains evidence-honest.

**Q7 — Condor executable P&L from 4 async legs. [OPEN]**
The condor credit is modeled (shorts@bid − wings@ask, conservative), not reconstructed from four actual async
fills — no per-leg slippage/timing. Matters for a negative-skew structure.

**Q10 — Discovery recall audit. [OPEN]**
No measurement of what the top-400-flow / top-N-breakout cut DROPS. We grade what commits, never the play
below the cut that would have won. Violates "no silent caps"; needs a recall probe.

---

## Sequencing (safety/integrity first)
1. Q8 condor assignment — **done** (cash-settled allowlist).
2. Q9 same-direction concentration cap (governor).
3. Q12 version-stamping (calibration population integrity).
4. Q2 weekly grading horizon — **done 2026-08-06** (ceiling widened, not a separate horizon) · Q7 condor fill model · Q10 recall probe.
Each ships flag-gated/additive where it touches live risk, and graduates on the ledger before it sizes.
