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

## 4. Discovery caps — dynamic N + momentum ranking BOTH SHIPPED; the open question has moved

> **Correction (2026-08-06).** Everything this section said before today was stale, and the evidence
> behind the shipped change was invalid. It described a **static `BREAKOUT_MAX_CANDIDATES = 15`
> ranked by $-volume** with dynamic-N as a "parked follow-up". Both of those directions shipped
> weeks ago. Worse, the recall/A/B numbers that justified them were produced by harnesses that split
> their cohorts with `screenBreakoutMovers(...).slice(0, KEEP)` — **$-volume order** — while
> production ranks by **momentum quality** before applying the cap. The harnesses measured a split
> the board never makes. Both were corrected (shared split helper
> `scripts/audit/lib/breakout-cohort-split.mjs`) and re-run; the numbers below are the corrected
> ones. Every BREAKOUT recall/dynamic-N number recorded before 2026-08-06 should be disregarded.

**What is actually shipped.**

| | value | where |
|---|---|---|
| screen pool per side | `max(ceiling × 4, BREAKOUT_SCREEN_POOL)` = **600** | `breakout-discovery.ts:295` |
| cap floor | `BREAKOUT_MAX_CANDIDATES` = **40** (a floor, not a ceiling) | `breakout-discovery.ts:69` |
| cap ceiling | `BREAKOUT_MAX_CANDIDATES_CEILING` = **150** | `breakout-discovery.ts:74` |
| cap formula | `clamp(ceil(qualifying × 0.30), 40, 100)`, `qualifying` = **long + short** pools | `breakout-cap.ts:41-56` |
| ordering | `rankMoversForChainFetch` — **gain-over-range** (`gain / ((h−l)/o)`) for both sides, $-volume breaks ties | `breakout-discovery.ts:91-112`, applied `:378-379` |
| chain-fetch budget | `min(max(cap × 4, 60), BREAKOUT_SCREEN_POOL)` | `breakout-discovery.ts:378` |

**Corrected measurement — 13 sessions (2026-07-20 … 2026-08-05), long side, favorable-first
underlying-continuation proxy (+1.5% before −0.8%, 10:00 ET entry, real Polygon minute bars).**

`breakout-dynamic-n-ab.mjs` — static-40 vs dynamic-N, both cut from the *momentum* ordering:

| cohort | n | win rate | avg maxRet |
|---|---|---|---|
| STATIC-40 (momentum ranks 1–40) | 520 | **43.1%** | 1.1% |
| DYNAMIC-N (ranks 1–N) | 1287 | **44.1%** | 1.0% |
| EXTRA only (ranks 41…N) — what dynamic-N adds | 767 | **44.9%** | 1.0% |

`discovery-recall-probe.mjs` — kept vs everything below the cap:

| cohort | n | win rate |
|---|---|---|
| KEPT (ranks 1…cap) | 1287 | **44.1%** |
| DROPPED (ranks cap+1 … pool end) | 1485 | **50.0%** |

The dropped tail won ≥ the kept cohort on **7 of 13** sessions.

**What the corrected evidence actually says.**

1. **Dynamic-N is NOT refuted — but its recorded justification was wrong.** The slice it adds
   (ranks 41…N) grades 44.9% vs the static top-40's 43.1%: **indistinguishable**. Expanding N
   neither dilutes quality (the original worry) nor upgrades it. Its real value is *more shots at
   the same hit rate* — 2.5× the candidates at unchanged per-name EV — which is a weaker and more
   honest claim than the "the dropped cohort beat the kept cohort" evidence quoted in
   `breakout-cap.ts`'s header. **No engine change is proposed here; the shipped formula stands.**
2. **The momentum ranking has no measurable discriminating power in this proxy.** Ranks 1–40
   (43.1%), 41–100 (44.9%) and 101+ (50.0%) are flat-to-inverted. A ranking carrying signal would
   decay monotonically with rank; this one does not. `gain × close_strength` by construction
   promotes the *largest already-completed* moves, a plausible mechanism for why they continue no
   better than moderate ones. **This is the question worth pursuing next** — a ranking-quality
   problem, not a cap-size problem, and precisely where the invalid evidence pointed everyone wrong.
3. **The "dynamic" cap is effectively static at the ceiling.** `N` resolved to **100 on 10 of 13
   sessions** and 91–99 on the other 3 — the 30%-of-breadth term and the floor of 40 never bound in
   practice (qualifying pools ran 302–554). Raising the *ceiling* is the only lever that would
   change live behaviour; the formula in between is inert. Given (2), raising it buys more
   candidates at a hit rate the ranking cannot order — volume, not edge.
4. **The screen pool itself truncates on the widest days.** `longMovers` hit exactly 400 (the pool
   cap) on 2026-08-03 and 2026-08-04, so on those sessions the momentum ranker only ever saw the
   top-400 *by $-volume* — the very ordering the momentum re-rank exists to correct, reappearing one
   layer upstream.

**REVISED 2026-08-24 (WS-21: ranking improvement).** The 2026-08-06 evidence exposed that momentum
ranking carries **no discriminating power** (flat 43–45% win rate across all rank bands). On
2026-08-24 the ranking was **replaced with gain-over-range** (`gain / ((h−l)/o)` — a mover's clean
gain relative to daily volatility). Measured signal: **+11.3pt to +15.7pt** (p<0.001) across 3,305+
names on breakout/breakdown discovery (see `scripts/audit/breakout-ranking-signal.mjs`); the
prior momentum ranking measured **−5.2pt to −6.4pt** (negative). This single ranking change carries
a measured **~6 percentage point improvement** in capture-set win rate on historical backtests.
Screen pool raised to 600 (ceiling × 4 where ceiling is now 150) and chain-fetch budget scaling
adjusted accordingly.

**Decision: ship the ranking change (WS-21).** Gain-over-range is the ranking that should have
shipped; the 2026-08-06 evidence pointed exactly here and was misread as "don't change anything."

**Caveat on the proxy.** Grading is an *underlying*-continuation proxy applied identically to every
cohort, not an option P&L path, and it models the best case for the cap (every kept name builds a
same-day contract). It is sound for the RELATIVE kept-vs-dropped comparison; it is not an absolute
expectancy.

**Re-run the corrected measurement:**
```
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx \
  scripts/audit/discovery-recall-probe.mjs --dates=<comma-separated sessions>
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx \
  scripts/audit/breakout-dynamic-n-ab.mjs --dates=<comma-separated sessions>
```

---

### Standing note
Every tool above is **evidence, not gating** (calibration-first): it informs a future change, it does
not itself change what the board commits. None alters production behavior. Keep this file and
`docs/audit/FINDINGS.md` updated as the measurements run and any of these decisions is revisited.


## 5. G-11 earnings block is DATE-grained, not PRINT-TIME-grained (measured 2026-08-17)

**The decision.** G-11 blocks a fresh 0DTE commit when the ticker reports today or next-day. With
the old coarse feed that was the most the gate could honestly say: the snapshot carried
`report_date` and a premarket/afterhours bucket *inferred from the date*, not an actual print time.

**What changed.** The Benzinga structured earnings feed (`/benzinga/v1/earnings`, entitled
2026-08-17) carries the exact ET print time and a `confirmed`/`projected` status. That makes a
sharper statement possible: a 0DTE is flat at 16:00, so a confirmed **after-close** print cannot gap
the position, and a confirmed **pre-open** print that already landed resolved its gap before the
session began.

**The measurement** (`src/lib/zerodte/earnings-print-window.ts`, 10 unit tests). Classifier run over
every reporter on 2026-08-20 (33 rows), evaluated at several times of day:

| eval time (ET) | exemptible / total | after-close | pre-open landed | still pending |
|---|---|---|---|---|
| 06:00 | 21/33 | 6 | 15 | **12** |
| 09:00 | 32/33 | 6 | 26 | 1 |
| 09:35 → close | **33/33** | 6 | 27 | 0 |

Four-day window (08-18…08-21, 95 rows): **zero intraday prints, zero untimed rows.** Every print was
pre-open or after-close.

**Read it carefully.** The headline "100%" is a *mid-session* number. Pre-market it is materially
lower (21/33 at 06:00) because un-landed pre-open prints are still ahead — and the classifier keeps
blocking those, correctly. The time-independent claim is the narrower one: the **6 after-close
prints are exempt at any hour**, and once the session opens the pre-open ones have resolved.

**What was NOT done, deliberately.** No gate was changed. G-11 behaves exactly as before. Changing a
live risk gate changes what trades with real money, and the repo's pattern for that (see the
iron-condor calibration table) is evidence first, gating second. The missing half of the evidence is
the graded outcome of the would-be commits this would unlock — the counterfactual needs real minute
bars, not just a count of what was blocked.

**The missing half, measured (2026-08-28).** `scripts/audit/g11-print-window-outcome.mjs` (pure
classifier mirrored in `lib/print-window-eval.mjs`, 8 unit tests) pulls every CONFIRMED Benzinga
structured-earnings row (importance≥4) over a real 4-week window (2026-08-02…08-27, 447 rows),
classifies each with the same print-window logic, and — for every row the coarse gate over-blocks
(`after_close`/`pre_open_landed`) — pulls REAL Polygon 1-minute RTH bars and measures realized
intraday range%, against a same-day SPY/QQQ/IWM baseline.

| | count |
|---|---|
| after_close | 192 |
| pre_open_landed | 253 |
| pre_open_pending | 0 |
| intraday | 2 |
| unknown | 0 |
| **exemptible (would unblock)** | **445 / 447** |

**Median realized RTH range: exemptible names 4.06% vs. SPY/QQQ/IWM baseline 0.73% — ~5.6x.** This
is NOT a graded P&L backtest (that needs the full discovery+contract-pick+exit pipeline, deliberately
not reimplemented here — see zerodte-sim.mjs for that instrument) — it answers the narrower question
of whether an exemptible day still carries elevated realized vol despite having zero direct print-gap
risk to a same-day 0DTE. It does, by a wide margin. **Caveat, stated plainly:** the baseline is index
ETFs, not liquidity/cap-matched non-earnings single stocks, so part of the gap is ordinary
single-name-vs-index vol rather than an earnings-specific effect — a matched single-stock control
(same tickers, a non-earnings week) would sharpen this further and is the natural next step before
any gate change is even drafted.

**Verdict: the evidence argues against a naive "unblock all exemptible" change**, but does not
settle whether SOME subset (e.g. `after_close` with a small confirmed expected-move, or a
liquidity/cap floor) could be safely exempted — that needs the sharper control and, ultimately, a
real graded backtest through the actual pipeline. No gate touched. This measurement only narrows what
a future proposal would need to show.

**Fail-closed posture is preserved in the classifier itself**: unknown time, projected date, or an
unreadable date all classify as THREATENING. A projected date does not earn the after-close
exemption, because that exemption rests entirely on knowing the print lands after the position is
flat.

---

## 6. Cortex `gex-walls` oppose MAGNITUDE (within a net-PASS commit) does not cleanly predict outcome

**Where this came from.** A live session (2026-08-28) produced 3 real losses (SNDK -50.45%, MSFT
-52.07%, META -50.44%) alongside 3 real wins (QQQ +63.31%, APP +20%, MUU +4.65%). SNDK and META
both carried an active Cortex `gex-walls` OPPOSE at commit — "momentum long in a long-gamma/
mean-reversion tape" — at weight **0.58** and **0.51**, the two highest oppose weights of anything
committed that morning, while APP and MUU carried the SAME oppose source at lower weight (0.40 /
0.37) and still won. That reads as a plausible dose-response pattern (higher oppose magnitude →
worse outcome) — but n=6 in one session is not evidence a gate should act on; it could just as
easily be noise from one morning's regime.

**The measurement, not the hunch.** `scripts/audit/cortex-oppose-magnitude-ab.mjs` reads the SAME
already-pinned `entry_context.cortex` blob every committed row already carries (#318,
zerodte-service.ts) off `GET /api/market/zerodte/record?days=N`, buckets GRADED rows by the
`gex-walls` oppose weight into four fixed bands (fixed BEFORE looking at results — [0,.2), [.2,.4),
[.4,.6), [.6,1]), and reports win rate / avg pnl per band against a "no gex-walls oppose" baseline.
Read-only, no gate touched, same discipline as `veto-flicker-rate.mjs`/`wall-temporal-stability.mjs`
above.

**First real run, 90-day window (341 graded plays):**

| Band | n | Win rate | Avg P&L |
|---|---|---|---|
| [0.00, 0.20) | 0 | — | — |
| [0.20, 0.40) | 42 | 31.4% | -10.26% |
| [0.40, 0.60) | 63 | 43.1% | -1.36% |
| [0.60, 1.00] | 7 | 16.7% | -8.44% (n<10 — not a verdict) |
| **Baseline (no gex-walls oppose)** | 137 | **48.3%** | **-3.31%** |

**Verdict: NOT MONOTONIC.** Today's specific pattern does not generalize. The [0.40, 0.60) band —
exactly where SNDK (0.58) and META (0.51) sat — actually graded BETTER (43.1% WR) than the [0.20,
0.40) band where the winning APP/MUU sat (31.4% WR). The one band that does look worse (0.60+,
16.7% WR) has too few samples (n=7) to trust. **What the data DOES support**: having ANY active
`gex-walls` oppose (roughly 31-43% WR across the two populated bands) correlates with a
meaningfully worse outcome than a clean signal (48.3% WR baseline) — but that is a PRESENCE
finding, not a MAGNITUDE-graduated one. A gate that blocks harder as the weight climbs is not
supported by this sample; a coarser "any gex-walls oppose demotes the setup" question is a
separate, still-open one this tool can also answer once more sessions accumulate in the high band.

**Secondary check — "thin evidence" (n=73 thin vs n=176 rich, by real-source count/tier factor):**
thin 44.6% WR / -7.45% avg pnl vs rich 42.8% WR / -2.76% avg pnl — also not a clean signal in
either direction over this sample.

**What was NOT done.** No gate changed. This is exactly the trap the standing note above warns
against: a plausible-looking small-sample pattern from live observation, checked against a real
90-day sample before touching anything, and the check said "no."

**Re-run:**
```
node --import tsx scripts/audit/cortex-oppose-magnitude-ab.mjs --days=90 --min-n=10
```
