# INTENTIONAL-DESIGN — deliberate 0DTE choices + the measurement that would revisit them

Purpose: a durable record that certain 0DTE-board behaviors are **deliberate design decisions**,
not oversights — so a future reader (or Cursor) doesn't "fix" them blind, and so any revisit is
**evidence-driven**. Each item states the choice, the rationale grounded in the code, and the
**specific offline measurement** whose result would justify changing it. All the measurement tools
listed here are **offline, read-only, and change NO production behavior** — they exist to gather
evidence *before* a behavioral change, exactly as the repo's calibration-first policy requires.

Companion tools (see CLAUDE.md "Audit toolkit"): `scripts/audit/merge-precedence-ab.mjs`,
`scripts/audit/veto-flicker-rate.mjs`, `scripts/audit/wall-temporal-stability.mjs`,
`scripts/audit/discovery-recall-probe.mjs`.

---

## 1. FLOW-first merge precedence (incumbent-wins-by-seating-order)

**The choice.** The three whole-market discovery rails merge **by ticker**, and when two rails
surface the same ticker in **opposite directions** the merge keeps the **highest-precedence rail's**
direction by a fixed seating order — **FLOW > BREAKOUT > PIN** — with **no evidence weighting**. The
opposing read is *stamped as evidence* but is never allowed to win.

- `src/lib/zerodte/breakout-source.ts` `mergeDiscoveryOrigins` (~L224): a ticker already present in
  the flow setups "keeps its (evidence-bearing) flow setup" and merely gains `"BREAKOUT"` in its
  origin set; the breakout duplicate is dropped. "**NO corroboration score boost (evidence-only …)**".
- `src/lib/zerodte/pin-source.ts` `mergePinOrigins` (~L348): identical rule — a shared ticker "keeps
  the EXISTING setup's DIRECTION (flow/breakout momentum), not the pin fade … collapsing it here
  would fabricate agreement."
- The kept direction's owner and every rail's `(direction, score)` are now **frozen** on the
  committed row (`board.ts` `buildOriginMaps` → `entry_context.origin_maps`, WS-06), and the policy is
  **versioned**: `MERGE_POLICY_VERSION = "v1"` (`board.ts` L303) = "FLOW > BREAKOUT > PIN precedence,
  union-by-ticker keeping the highest-precedence rail's read."

**Why it's deliberate.** FLOW carries the strongest *direct* evidence (real option prints,
aggression, side dominance); BREAKOUT and PIN are bare price/positioning seeds with honest-null flow
fields. Letting a bare seed's *self-assigned* score flip a flow-evidenced direction would let the
weakest-evidence rail override the strongest. The design's stance is **evidence-only**: record the
disagreement, don't fabricate agreement, and let the **graded origin band** (calibration) decide
whether opposing co-discovery actually underperforms — *before* any precedence or no-trade rule.

**What would justify revisiting it → `merge-precedence-ab.mjs`.** Re-grade the committed
**disagreement rows** (where the rails argued opposite directions) under **FLOW-first (shipped)** vs
an **evidence-weighted** precedence (keep the highest-`origin_score_map` rail's direction), grading
**both** candidate directions identically on real Polygon minute bars. If evidence-weighting's chosen
direction grades **materially better** across a meaningful sample of disagreement rows, that is the
evidence to bump `MERGE_POLICY_VERSION` and change the rule. Runs off the frozen
`entry_context.origin_maps`, so it measures exactly what shipped. (Reports INSUFFICIENT DATA rather
than fabricate when no committed-row export is reachable — raw Postgres is blocked from the sandbox.)

---

## 2. Cortex veto has no hysteresis / latching (recomputed each pass)

**The choice.** `evaluateCortexForCommit` (`src/lib/zerodte/cortex-gate.ts`) composes a **fresh**
verdict on **every** scan pass. A veto is **stateless**: it does not latch (stay vetoed once fired)
and does not dwell (require the block to persist for K passes before it bites). `assessCortexVerdict`
folds *this pass's* verdict into the decision with no memory of prior passes.

**Why it's deliberate.** The module doc is explicit that Cortex is a **precision layer stacked on the
hard-gate safety floor** — "it can only ever *remove* additional plays." A latched veto would keep
suppressing a setup whose blocking condition (a dealer wall, an opposing $1M cluster) has genuinely
cleared, i.e. it would manufacture false negatives from stale state. Statelessness keeps every pass
honest to *current* evidence, consistent with the deliberate fail-soft/ABSTAIN asymmetry documented
in the same file.

**What would justify revisiting it → `veto-flicker-rate.mjs`.** Measure, over a session's ordered
passes, how often a Cortex veto **flickers** — fires, then clears within N subsequent passes. A high
flicker rate means the stateless veto whipsaws candidates on and off the board (the cost a short
dwell/hysteresis would buy down); a low rate means statelessness is cheap and hysteresis would trade
responsiveness for little stability. The tool tallies flicker rate, median passes-to-clear, and
per-ticker churn from a per-pass decision export (exact) or the `zerodte_scan_rejections`
`cortex_veto*` codes (approximate). Only a **high** flicker rate is evidence for adding a dwell.

---

## 3. PIN "defended wall" is a single-snapshot structural test (no temporal stability requirement)

**The choice.** `evaluatePinRegime` (`src/lib/zerodte/pin-source.ts` L119) decides whether a name is a
genuine dealer-defended, long-gamma, spot-mid-range pin from **one** GEX snapshot: long-gamma posture
+ two-sided bracket (`put_wall < spot < call_wall`) + contained band width + both walls dominant +
spot off-center. There is **no requirement that the bracket persisted across time** — a wall present
for a single snapshot is treated identically to one that held for hours.

**Why it's deliberate.** The regime filter is already **strict** (five simultaneous structural
conditions, L119-147), and the module leans on that strictness — plus G-1 tape-alignment as
defense-in-depth (the G-1 note at the file's end) — to keep the source honest **without** carrying
cross-snapshot state. A single strict snapshot is the simplest test that still rejects one-sided
ladders, wide non-ranges, and breakout-risk spots; temporal state is deliberately deferred to
calibration rather than baked in speculatively.

**What would justify revisiting it → `wall-temporal-stability.mjs`.** Run the **real**
`evaluatePinRegime` on each of a session's GEX snapshots and split qualifying pins into
**multi-snapshot-stable** (qualified in ≥K snapshots, same fade direction, walls stable within
tolerance) vs **single-snapshot** transients, then grade each pin's fade on real minute bars. If
stable-bracket pins grade **materially better** than single-snapshot ones, a temporal-stability
requirement (e.g. "the bracket must hold for K snapshots before PIN emits") is warranted. If not, the
single-snapshot test stands. (Intraday GEX snapshots are a server-side UW product not reachable
offline; the tool reports INSUFFICIENT DATA absent a snapshot export, and a live intraday poller can
gather one going forward.)

---

## 4. Dynamic discovery caps — `BREAKOUT_MAX_CANDIDATES` is static (follow-up, already measured)

**The choice.** The BREAKOUT rail screens the whole market (~12k grouped-daily names) but keeps only
the top **`BREAKOUT_MAX_CANDIDATES` (=6)** by $-volume (`src/lib/zerodte/breakout-discovery.ts`); the
cap is a **static constant**, not a function of the day's breadth/dispersion.

**Why it's deliberate.** A fixed small cap bounds per-session compute (each kept name pulls a live
chain + full gate/Cortex stack) and keeps the board's blast radius predictable. The design's "no
silent caps" principle (Q10) is satisfied by **measuring** the recall cost rather than guessing at a
dynamic rule.

**Measurement — already exists: `scripts/audit/discovery-recall-probe.mjs`.** This is the standing
measurement for the cap; do **not** duplicate it. It screens a session with the production
`screenBreakoutMovers` ranking, splits movers at the cap into KEPT (top-6) vs DROPPED (rank 7…N), and
grades each name's intraday continuation on real minute bars → per-cohort win-rate + the specific
dropped winners. First 5-session run (2026-07-20…24) found the dropped tail won ≥ the kept top-6 on
3/5 days (FINDINGS 2026-07-25) — evidence the $-volume cap is leaky.

**Parked follow-up (dynamic-N).** The recall probe measures a **static** cap. The open question is
whether a **dynamic** N — sized to the day's breadth (e.g. count of movers clearing the screen) or a
$-volume/gain-dispersion knee — recovers the dropped winners without ballooning compute on quiet
days. When taken up, **extend `discovery-recall-probe.mjs`** with a candidate dynamic-N rule and grade
KEPT-under-dynamic-N vs KEPT-under-static-6 vs the DROPPED tail across many sessions; graduate any
change on the origin band. Ranking the lane by `gain × close-strength` instead of $-volume (FINDINGS
2026-07-25 follow-up) is the sibling question to fold into the same extension. This item is **parked
as documented**, not built, to avoid duplicating the existing probe.

---

### Standing note
Every tool above is **evidence, not gating** (calibration-first): it informs a future change, it does
not itself change what the board commits. None alters production behavior. Keep this file and
`docs/audit/FINDINGS.md` updated as the measurements run and any of these decisions is revisited.
