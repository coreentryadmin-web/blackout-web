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

## 1. Merge precedence — REVISITED 2026-07-28 → `MERGE_POLICY_VERSION = "v2"` (evidence-weighted)

**Prior choice (v1).** Rails merged by ticker; on **opposite directions** the **seating-order**
incumbent always won — **FLOW > BREAKOUT > PIN** — with no score comparison. Opposing reads were
stamped as evidence but never allowed to own the slot. Same-direction merges incorrectly applied a
`+8` corroboration boost even when a later rail was only present via a *prior* union that included
fights (PIN fades almost always oppose momentum).

**Shipped choice (v2).** `mergeSameTickerDiscovery` in `board.ts`:

- **Same direction** → union origins + `CORROBORATION_SCORE_BOOST` (+8, capped at 100).
- **Opposite directions** → **higher rail score owns the slot** (strict `>`); seating-order wins
  **ties** (FLOW seated first, then BREAKOUT, then PIN). **No** corroboration boost on a fight.
- Frozen maps (`buildOriginMaps`) set `direction_owner` to the **highest-score agreeing rail**
  (ties → FLOW > BREAKOUT > PIN). `merge_policy_version: "v2"` on every new commit.

**Why revisit now.** Live 0DTE Command (2026-07-28) was effectively a **flow-momentum buyer**:
board setups showed 100% FLOW origin ownership even when BREAKOUT/PIN rails were enabled, and the
record ran ~35% WR. Two mechanical bugs in v1 made multi-rail invisible/harmful: (1) FLOW always
kept direction so strong BREAKOUT/PIN fades could never surface; (2) opposing PIN still granted +8,
helping weak FLOW clears of G-3. Evidence-weighting keeps FLOW's typical score advantage on ties
while letting a clearly stronger non-flow rail own the ticket.

**Measurement still useful → `merge-precedence-ab.mjs`.** Re-grade disagreement rows under v1 vs v2
on real minute bars as the origin band fills with `merge_policy_version: "v2"` commits. If v2's
chosen direction underperforms v1 on a meaningful sample, that is evidence to revisit again.

**First real run — 2026-08-05 (see FINDINGS.md same date).** Fetched a 90-day ledger export via the
existing `/api/market/zerodte/record?days=90` endpoint (an admin/premium session already sees
`entry_context.origin_maps` verbatim — no DB access needed). Found and fixed a bug in the harness
itself (`flowFirstDirection()` was reading the policy-versioned `direction_owner` field instead of
the fixed seating order, so it could never detect a v2-era disagreement). After the fix: 2 genuine
disagreement rows (AMD 2026-08-03, MU 2026-07-29), both a dead heat on real minute bars (0.0% win
rate for both arms, n=2 — too small to be evidence either way). **No change to the shipped v2
precedence from this sample** — revisit once more multi-origin disagreement rows accumulate.

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

**First real run — 2026-08-05 (see FINDINGS.md same date).** Captured 5 real sessions
(2026-07-28…07-31, 08-04) via `veto-flicker-capture.mjs` (built on PR #1679's `?date=` +
`raw_events`/`raw_rejections` funnel-endpoint plumbing). Raw APPROXIMATE-mode result: **100% flicker,
median 1 pass-to-clear, every single session, 38/38 episodes** — but investigating *why* found this
is mostly a measurement artifact, not a real signal: both `zerodte_scan_rejections` and
`zerodte_discovery_events` are write-throttled to one row per ticker per DISTINCT state transition
(not one row per scan pass), so for the 4 sessions that predate `discovery_events`
(`discovery-events-persist.ts` shipped 2026-08-03, PR #1582) every vetoed ticker has exactly ONE row
for the whole session — which trivially reads as "cleared next pass" by construction, regardless of
the ticker's true veto duration. Only 2026-08-04 (both tables live) showed a *real* signal: MSFT
re-wrote a fresh veto row 15 times and INTC 6 times across one session, real repeated state
transitions, but still not resolvable into an EXACT clear-vs-dropped-candidacy distinction without a
`--passes` export. **Verdict: insufficient/confounded evidence — `cortex-gate.ts` NOT touched.**
Re-run forward-looking (2026-08-04 onward only, excluding the 4 pre-#1582 artifact-only days) once
more post-throttle-fix sessions accumulate; the durable fix for the ambiguity itself would be a new
`cortex_cleared` discovery-event kind (not attempted — would touch the live scanner).

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
offline; the tool reports INSUFFICIENT DATA absent a snapshot export. `scripts/audit/
gex-wall-snapshot-poll.mjs` is that live intraday poller — built + smoke-tested against prod
2026-08-05, but not yet run across a real RTH session; see FINDINGS.md 2026-08-05 for why
[market was closed] and the exact follow-up command.)

---

## 4. Discovery caps — static N kept; ranking REVISITED 2026-07-28 (momentum before chain-fetch)

**The choice (still).** The BREAKOUT rail screens the whole market but chain-fetches only
**`BREAKOUT_MAX_CANDIDATES` (=15)** names per side. The cap remains a **static constant**.

**What changed (2026-07-28).** Liquidity screening still uses $-volume
(`screenBreakoutMovers` / `screenBreakdownMovers`, pool `BREAKOUT_SCREEN_POOL`=60), but the
chain-fetch budget is now ordered by **`rankMoversForChainFetch`**: long = `gain × close_strength`,
short = `gain × (1 − close_strength)`, $-volume breaks ties. This is the recall-probe follow-up
(FINDINGS 2026-07-25): mega-cap $-volume was starving sharper mid-cap continuations.

**Parked follow-up (dynamic-N).** Whether N itself should flex with breadth is still open — extend
`discovery-recall-probe.mjs` with a candidate dynamic-N rule and grade across many sessions before
changing the constant again.

---

### Standing note
Every tool above is **evidence, not gating** (calibration-first): it informs a future change, it does
not itself change what the board commits. None alters production behavior. Keep this file and
`docs/audit/FINDINGS.md` updated as the measurements run and any of these decisions is revisited.
