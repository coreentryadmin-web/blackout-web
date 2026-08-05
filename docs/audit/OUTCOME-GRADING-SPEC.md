# OUTCOME-GRADING-SPEC — every "did this play win" function, one place

Purpose: `plan.ts` alone has three independently-evolved graders, `feature-store.ts` carries a
manual comment claiming byte-identical agreement with `record.ts` that was never tested, and
Swing/Banger each grade with their own methodology again. This is the durable inventory — every
grading function, its exact win/loss/breakeven rule, which layer calls it, and which pairs are
**INTENTIONALLY different views** vs which pairs are **SUPPOSED to be IDENTICAL** (and are now
checked by `scripts/audit/outcome-grading-audit.mjs`, see the companion measurement at the end).
Same tone/format as `docs/audit/INTENTIONAL-DESIGN.md` — read that first if this is your first
pass through the audit docs.

---

## 1. 0DTE Command — the four plan.ts graders

All four walk the SAME contract minute bars from the SAME flag instant, differing only in what
"exit at the level" MEANS (mid price vs bid/ask; whole position vs a trim ladder). Conservative
same-bar collision rule is identical everywhere: **a bar that touches both stop and target counts
the STOP** (intrabar order is unknowable, so pessimism wins).

| Grader | File:line | Rule | Who calls it |
|---|---|---|---|
| `gradePlanFromBars` — **MID** | `plan.ts:405` | Walks the contract's MID price. Stop = entry×(1−0.5), target = entry×(1+1.0), time-stop 15:30 ET. First touch wins (stop checked before target same-bar). No post-flag bar → `ungradeable`. | Written to `zerodte_setup_log.plan_outcome`/`plan_pnl_pct` (the two DB columns) by `scan.ts`'s grading pass. This is the row's raw/legacy grade — **feature-store.ts reads exactly these two columns and nothing else.** |
| `gradePlanExecutableFromBars` — **EXECUTABLE (WS-10)** | `plan.ts:463` | Same stop/target premium LEVELS, but priced on the trade side a member can actually get: entry = ASK (`entry×(1+f)`), exit = BID (`tradePrice×(1−f)`), `f` = the row's own pinned half-spread. The stop LATCHES on the BID low (fires strictly earlier than the mid grade); same collision rule. | Stamped additively at `entry_context.executable` (`stampZeroDteExecutableGrade`) — **never overwrites** the mid DB columns, which stay as the "monitoring" comparison. |
| `reconstructTrimScaleExecutableFromBars` — **RECONSTRUCTED TRIM-SCALE (WS-11)** | `plan.ts:532` | Same executable (ask-in/bid-out) frame, but replays the engine's ACTUAL ⅓/⅓/⅓ partial-banking ladder leg-by-leg (frozen `entry_context.exit_policy_snapshot`) instead of one all-or-nothing walk. `pnl_pct` is the fraction-weighted blend of the legs; `tranches` is the per-leg audit trail. | Called ONLY for a row whose frozen exit policy is `trim_scale`; its output REPLACES the plain executable grade inside `entry_context.executable` (so `entry_context.executable.tranches` presence is the signal `record.ts` reads to route to this number). Falls back to the plain executable walk (above) when the ladder is empty. |
| `derivePlayStatus` — **LIVE CARD** | `plan.ts:668` | Not a post-hoc grade at all — the desk's real-time OPEN/HOLD/TRIM/CLOSED state from latched peak/trough. Peak checked BEFORE trough (sticky): once `peak >= target` the card shows TRIM forever, even if the position later craters — an OPTIMISTIC same-bar tie-break, the deliberate mirror image of `gradePlanFromBars`'s PESSIMISTIC one. | The board's live UI. Never touches the ledger's `plan_outcome`/`plan_pnl_pct` columns. |

**INTENTIONAL differences (by design, documented in-code, do not "fix"):**
- **Mid vs executable (WS-10).** Different VIEWS of the same trade on purpose: mid answers "did the
  plan's rules get touched," executable answers "could a member actually have captured this." The
  executable grade is ⩽ its mid twin on a single-exit walk (higher entry basis, earlier-triggered
  exit) — see `plan.ts:436-461`'s doc comment. This is the whole point of WS-10 (stop grading
  strategies that only "win" at a fictional mid fill).
- **Single-walk vs reconstructed trim-scale (WS-11).** Different STRATEGIES: a trim-scale row's
  actual behavior is a partial scale-out, not an all-or-nothing hold — grading it with a single
  walk would score a strategy nobody trades. WS-11's reconstruction can go EITHER direction
  relative to the mid single-walk (a banked partial-profit leg can make the blended official number
  BETTER than a mid walk that only checks the final exit, or worse) — see the live audit evidence
  below (§6) for real examples of both.
- **Mechanical vs card tie-break (peak-first vs stop-first).** `plan.ts:369-390`'s own doc comment:
  the post-hoc `gradePlanFromBars` is pessimistic on a same-bar stop+target tie (books the stop);
  the live `derivePlayStatus` card is optimistic-sticky (a real target touch is a real trim the
  member could take). They can only disagree in that narrow both-touched-same-bar window, and
  `record.ts` resolves it by NEVER reporting the mechanical grade as the headline (see §2) — the
  member-facing number always matches what the live card guided them to do.

---

## 2. `record.ts` — the member-facing headline (two parallel "tracks" over the same rows)

`buildZeroDteRecord` grades every ledger row TWICE and reports both, explicitly labeled, never
blended (`ZERODTE_RECORD_METHODOLOGY`, `record.ts:24`):

- **AS-MANAGED (the headline)** — `managedGradeView` (`record.ts:301`), precedence:
  1. **WS-11 reconstruction** (`readReconstructedTrimScale`, `record.ts:191`) — a trim-scale row's
     `entry_context.executable.tranches` IS the as-managed path (§1's third grader), so this is
     simultaneously the calibration number AND the member-facing number — `grade_vs_asmanaged_delta
     ≈ 0` by construction (scan.ts stamps and checks this live, `scan.ts:1487-1503`).
  2. **The live exit engine's stamped exit** (`readManagedExit`, `entry_context.exit` — ratchet /
     thesis-break / flat-theta-bleed) when no reconstruction applies.
  3. **Fallback to the mechanical grade** (§1's plan-rules walk) when no engine exit ever fired —
     the "clean hold-to-plan path," historically the ONLY path before the exit engine shipped.
- **MECHANICAL (labeled comparison, never the headline)** — `mechanicalGradeView` (`record.ts:280`)
  — the OFFICIAL (executable, WS-10-preferred) lane of §1's first/second graders, reported
  side-by-side as `mechanical` in the API payload, explicitly never blended into the headline.

**The win predicate — `isZeroDteWin` (`record.ts:225`):**
```ts
export function isZeroDteWin(row): boolean {
  return (officialPlanPnlPct(row) ?? 0) > 0;
}
```
`officialPlanPnlPct` (`record.ts:169`) reads `entry_context.executable.plan_pnl_pct` when present
(WS-10/WS-11's conservative-executable or reconstructed-trim-scale number), else falls back to the
row's raw MID `plan_pnl_pct` DB column — **so a legacy (pre-WS10) row's "official" value IS its mid
value**, and only a row that has since been executable-graded can have official ≠ mid.

**The graded-population gate — `isGradedZeroDteRow` (`record.ts:215`):** requires BOTH a real
outcome (`officialPlanOutcome(row) not in {null, "ungradeable"}`) AND a finite official pnl —
deliberately checking BOTH columns so a partial write (outcome stamped, pnl still null) reads as
**ungraded** (retried later), never as a silently-booked loss.

---

## 3. `feature-store.ts` — the learning store's read side

`labelFromPlanOutcome` (`feature-store.ts:38`):
```ts
export function labelFromPlanOutcome(outcome, planPnlPct): "win" | "loss" | null {
  switch ((outcome ?? "").toLowerCase()) {
    case "doubled": case "stopped": case "time_stop":
      return (planPnlPct ?? 0) > 0 ? "win" : "loss";
    default:
      return null; // ungradeable / open / unknown — not evidence
  }
}
```
**The exact comment on this function claims:** *"the WIN/LOSS itself is decided by realized plan
P&L — `plan_pnl_pct > 0` — the EXACT predicate record.ts `isZeroDteWin` … uses, so the learning
store can never disagree with the member-facing record on what a win is."*

**What it actually reads:** `db.ts`'s `fetchGradedFeatureVectorRows` (`db.ts:5975`) —
```sql
SELECT ticker, session_date, feature_vector, plan_outcome, plan_pnl_pct
  FROM zerodte_setup_log
 WHERE feature_vector IS NOT NULL AND plan_outcome IN ('doubled','stopped','time_stop')
```
— the **raw MID DB columns**, straight, with **no join to `entry_context`** at all. There is no API
route that exposes `fetchGradedFeatureVectorRows`'s output either (grep confirms: the only route
touching the ledger is `/api/market/zerodte/record`, and it serves the OFFICIAL fields, not the
raw mid columns — this is why the cross-check below has to reconstruct mid values from the
executable blob's redundant `mid_plan_outcome`/`mid_plan_pnl_pct` fields rather than reading the
raw columns directly).

## 4. The checked invariant — feature-store.ts (mid) vs record.ts (official/executable)

**Claim in the code:** byte-identical win/loss decisions.
**Reality:** identical ONLY for a row with no `entry_context.executable` blob (a legacy/pre-WS10
row, where `officialPlanPnlPct` falls back to the same mid column feature-store reads — mid IS
official there, so agreement is guaranteed by construction, not by coincidence). For a row that
HAS been executable-graded (WS-10/WS-11), feature-store keeps reading the MID value while
`record.ts` prefers the EXECUTABLE/reconstructed value — and those two numbers can differ in SIGN
(§1's "intentional differences"), which flips the win/loss label. **This is a genuine, previously
untested gap between a comment-enforced invariant and the code that is supposed to satisfy it.**

`scripts/audit/outcome-grading-audit.mjs` is the automated cross-check: it imports BOTH real
production functions (`labelFromPlanOutcome` from `feature-store.ts`, the official win logic from
`record.ts`) — never reimplementing either — fetches real graded rows from the live
`/api/market/zerodte/record` route (which already resolves the official lane per play AND carries
the full `entry_context`, so the raw mid values are recoverable off `entry_context.executable.mid_
plan_outcome`/`mid_plan_pnl_pct` without any DB access), and flags every row where the two labels
disagree. See §6 for the actual live result.

---

## 5. Iron Condor — a structurally different instrument, its own grader

`gradeCondorFromBars` (`condor.ts:418`) is NOT a variant of the directional plan graders above — a
condor is a 4-leg credit structure, not a long premium position, so "win" means something different:
**WIN = price never breaches either short strike before the time-stop** (credit kept in full);
**LOSS = the first breach of either short books the DEFINED max loss** (capped by the wing width,
conservative — a touch-then-recover still books the loss, matching the "managed exit at the breach"
discipline). No stop/target premium walk applies; there is no mid-vs-executable split either
(`realized_usd` is the conservative kept-credit number; `realized_usd_mid` carries the best-fill
credit upside as an ADDITIVE labeled comparison, per Q7 — never a second independent grade). Called
from `scan.ts`'s condor branch, writes the same `plan_outcome`/`plan_pnl_pct` columns a directional
row would, so it flows through `record.ts`/`feature-store.ts` identically once graded — but its
`outcome` vocabulary (`condor_win` / `condor_breach_loss`) is DISJOINT from the directional
vocabulary (`doubled`/`stopped`/`time_stop`), which is why `feature-store.ts`'s outcome-string
switch (`labelFromPlanOutcome`) does **not** recognize a condor outcome as evidence at all — a
**deliberate exclusion** (condor rows are absent from the feature store, not mislabeled by it),
confirmed structurally: no condor outcome string appears in `labelFromPlanOutcome`'s case list.

---

## 6. Swing — the multi-truth grader (a different METHODOLOGY, not a variant view)

Documented in full in `docs/audit/SWING-ENGINE.md` (search "Multi-truth grader" / `grade.ts`).
`gradeSwingPosition` (`src/lib/swing/grade.ts`) grades FIVE independent truth families over a
multi-session position, because a −50%/+100%/15:30-same-day outcome literally does not apply to a
2–30 DTE thesis:

| Truth family | What "true"/"win" means | Reuses |
|---|---|---|
| **EXECUTION** | Did the entry actually fill inside the plan's stated band? | Own predicate — no 0DTE analog (0DTE never models a fill miss). |
| **PATH** | MFE/MAE walked on the UNDERLYING (not the option) over the graderTimeframe pinned per sub-lane (`SWING_SUB_LANES[x].grader`: minute/Tactical, hour/Standard, day/Extended). | Conservative intrabar stop-before-target — same discipline as `gradePlanFromBars`. |
| **THESIS** | `CONFIRMED` (target hit first) / `INVALIDATED` (structural stop hit first) / `OPEN` — walked on the underlying, independent of P&L sign. | New — 0DTE has no thesis-vs-financial split (0DTE's underlying_target/invalid ARE the plan). |
| **MANAGEMENT** | Did the live management state machine (structural stop → thesis stop → premium −60% backstop → advisory rungs) exit coherently? Can only grade what FINANCIAL could (survivorship guard). | — |
| **FINANCIAL** | Realized option P&L under the SAME scale-out mechanics as the whole-market banger engine — `gradeBangerScaleOut`/`gradeScaleOut` (`scale-out.ts`), reused **verbatim**, `gradeSwingScaleOut` is a thin parity-tested pass-through, not a reimplementation. | `scale-out.ts` — see §7, the ONE shared production scale-out grader. |

**Why this is intentionally NOT reconciled with 0DTE's win/loss:** Swing's headline is never a
single win/loss boolean — it is five coherent truths a member can read independently (a thesis can
be CONFIRMED while the financial truth is still a scratch on a bad fill, and that is meaningful
information, not a bug). `ZERODTE_RECORD_METHODOLOGY`'s "never blend the three methodologies"
rule (0DTE premium %, Slayer points, Night Hawk stock-move %) already establishes this precedent;
Swing extends it to five truths instead of blending into one.

---

## 7. Banger — the whole-market scale-out grader (shared production code, not a fork)

`scripts/audit/market-banger-scan.mjs --grade=DATE` and `src/lib/swing/grade.ts`'s FINANCIAL truth
both call the SAME production function, `gradeScaleOut`/`gradeBangerScaleOut` (`src/lib/zerodte/
scale-out.ts`, `banger-scale-out-grade.ts`) — a **mechanical scale-out** rule (partial exit at a
peak multiple + a trailing runner off the peak + a hard stop), walked over real forward option
bars. It measures THREE numbers side by side, never conflated:
- `maxRet` — the top-tick the bars ever touched (an unrealizable upper bound, reported as context).
- `holdRet` — hold-to-expiry (the naive "never touch it" comparison).
- `realized` (= `gradeScaleOut`'s return) — **the REALIZED number under the mechanical exit rule**,
  which is what `--grade` actually reports as the engine's real EV.
This is the SAME shared module Swing's FINANCIAL truth reuses (§6), so a scale-out fix in one place
fixes both consumers — there is only one scale-out grader in the whole codebase, not two that could
drift.

---

## 8. Which grader each consumer actually reads (summary table)

| Consumer | Reads | File |
|---|---|---|
| 0DTE board live card (OPEN/HOLD/TRIM/CLOSED) | `derivePlayStatus` | `plan.ts` |
| 0DTE ledger DB columns (`plan_outcome`/`plan_pnl_pct`) | `gradePlanFromBars` (MID) | `scan.ts` grading pass → `plan.ts` |
| 0DTE ledger `entry_context.executable` | `gradePlanExecutableFromBars` or (trim-scale rows) `reconstructTrimScaleExecutableFromBars` | `scan.ts` → `plan.ts` |
| 0DTE Command member-facing record headline (`/api/market/zerodte/record`) | `record.ts` AS-MANAGED (§2, executable-preferred) | `record.ts` |
| 0DTE Command record's labeled `mechanical` comparison | `record.ts` MECHANICAL (§2, executable-preferred, same population as headline minus the engine-exit override) | `record.ts` |
| 0DTE feature store / intelligence base rates | `labelFromPlanOutcome` — **raw MID DB columns** | `feature-store.ts` → `db.ts` |
| Iron condor ledger rows | `gradeCondorFromBars` | `condor.ts` |
| Swing position record | `gradeSwingPosition` (5 truths) | `swing/grade.ts` |
| Banger scan backtest (`--grade`) | `gradeScaleOut` | `scale-out.ts` |
| Swing FINANCIAL truth | `gradeBangerScaleOut` (same function as Banger) | `banger-scale-out-grade.ts` |

---

## 9. Live measurement — `scripts/audit/outcome-grading-audit.mjs`

**First live run, 2026-08-05, 90-day window, `blackouttrades.com` (see `docs/audit/FINDINGS.md`
same date for the full evidence + severity write-up):**

- 141 graded plays fetched from `/api/market/zerodte/record?days=90` (via CRON bearer).
- 111 legacy (pre-WS10) rows — mid IS official by construction, agreement guaranteed, not a test.
- **30 WS-10/WS-11 executable-graded rows — the population that actually exercises the invariant.**
- 130 rows where BOTH graders had evidence (some legacy/ungradeable rows drop out of one side).
- **126/130 agreed (96.9%). 4 disagreements — the invariant is measurably broken, not comment-only
  correct.** Every disagreement was on a WS-10/WS-11 row, confirming the root cause (§4) exactly:
  MU 2026-07-29, SPXW 2026-07-29, and META 2026-08-03 each had a mid `stopped` (−50%) that the
  official/executable/reconstructed lane turned into a real WIN (+6.25%, +7.77%, +3.41%) — the
  WS-11 partial-banking direction; OKLO 2026-07-30 went the other way, a mid `time_stop` win
  (+6.4%) that graded a small official LOSS (−0.97%) on the executable frame.

This is a real, live-confirmed result, not a hypothetical — re-run `npm run` equivalent:
```
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/outcome-grading-audit.mjs --days=90
```

**This does not necessarily mean feature-store.ts is "wrong"** — it may be intentional that the
learning store trains on the mid/mechanical signal (a cleaner, less execution-noisy read of "did the
SETUP work") while the member record reports the executable/realistic number. But that would be a
DIFFERENT, deliberate design decision than the comment currently states, and it should say so
explicitly (or the two should be reconciled) — this doc and the audit script exist so that decision
is made on evidence, not left as an untested claim.
