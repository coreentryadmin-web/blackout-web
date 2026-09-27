# Banger Exit — Tick-Level NBBO Quote Validation of 100%/33%/70% (2026-09-27, phase 2)

> **kind:** `FINDING`

**Operator directive (verbatim):** *"PR #5521 is merged. Now move to the next phase. Do NOT change
production exits yet. I want you to determine whether the cleaned 100/33/70 Banger exit edge is
actually real and executable. Focus specifically on eliminating the remaining verification weakness
caused by production using NBBO quote-mid instead of trade prices... Most importantly: try to kill
the +20.8% result, not prove it."*

**No production code was changed. No configuration is recommended or shipped.**

## Headline verdict

**The +20.8% / +26.3pp edge does NOT survive.** Under the most rigorous validation built so far —
real historical Polygon NBBO **quote ticks** (not trade bars, not a summary-tier reconstruction),
replayed through a tick-by-tick clone of production's own live management loop proven byte-exact
against the real `deriveScaleOutAction` as an oracle, verified against production's actual recorded
outcome, with realistic bid-side executable fills — the candidate's advantage on the **483 positions
this method can verify** is **+0.3pp [95% CI −2.4, +2.9]: statistically indistinguishable from
zero.** Every outlier-robustness check available (median delta, trimmed mean, leave-out-top-20, a
simple win/loss count of which configuration wins each trade) points the **same** direction: once a
handful of extreme trades are set aside, the result is flat-to-slightly-negative for the candidate,
never a confirmed positive edge.

**The prior +26.3pp finding was not a fabrication or leakage in the sense originally suspected — it
was a real artifact of the summary-tier reconstruction's own stated assumption** ("a single
monotonic decline from peak"), which cannot represent either of two real mechanisms found in the
actual tick data this round: (1) a single large downward quote gap can blow through both trail
thresholds at once, giving the tighter trail zero early-warning benefit while it still locks in a
smaller guaranteed partial; (2) a tighter trail can exit into a mere pullback and miss a later,
larger continuation rally that the looser trail keeps riding. Both are demonstrated below against
real ticks for real positions, not inferred.

---

## 1. The verification-bias fix — confirmed, but only partially closed

### 1.1 What changed

PR #5521 found real-bar (trade-print) replay verified 92% of real STOP_OUT rows (losers) but only
~10% of real EXIT_RUNNER/scaled rows (winners) — because production manages exits against a
continuous NBBO **quote-mid**, not trade prints, and Polygon's daily trade-aggregate bars simply
don't exist for most of the ticks that matter.

This round replays real historical Polygon **NBBO quote ticks** instead (`GET /v3/quotes/{occ}`),
folded through the REAL, unmodified `midOf`/`reliableMarkFromQuote` functions imported directly from
`src/lib/providers/options-snapshot.ts` (not re-cloned — both are pure and config-free, so a real
import removes all drift risk), driving a parametric clone of `deriveScaleOutAction`'s exact per-tick
decision logic (`scripts/audit/lib/banger-quote-tick-replay-eval.mjs`, proven exact against the real
function as an oracle — see that module's own test file, 14/14 passing including two "ORACLE
PARITY" tests that manually drive `deriveScaleOutAction` tick-by-tick and assert identical results).

### 1.2 Result: the bias narrowed sharply, but did not close

| | Trade-bar replay (PR #5521) | Quote-tick replay (this round) |
|---|---|---|
| STOP_OUT (loser) verification rate | 92.2% | **52.3%** (388/742) |
| EXIT_RUNNER/EXPIRED (winner) verification rate | 9.7% | **20.3%** (95/467) |
| Ratio | ~9.5x | **~2.6x** |
| Overall | 56.4% | 40.0% (483/1209) |

The gap shrank from a 9.5x ratio to a 2.6x ratio — real, meaningful progress — but genuine winners
remain underrepresented in the verified population (19.7% of verified rows vs 38.6% of the clean
population's true composition). This is disclosed, not glossed over, in every segment below.

### 1.3 Root cause of the REMAINING gap — a genuine data-provider limitation, demonstrated

Diagnosed directly against a real case (AVAV, id=39, real STOP_OUT at recorded mark **$2.00**):

- The archived NBBO quote tape's **minimum mid over the position's ENTIRE lifetime** (fetched through
  expiry) was **$2.05** — never once reaching the $2.04 hard-stop threshold.
- A real **trade** printed at **exactly $2.00** (`/v3/trades`) at 2026-08-05T19:59:26.686Z — matching
  production's real recorded mark to the cent — while the archived **quote** immediately before that
  trade showed `bid=2.00, ask=4.30` (mid = $3.15, nowhere near the trade price).
- Production's own mark-resolution code (`mapUnifiedSnapshotResult`) computes mark identically to
  this study's replay (`mid(bid,ask) ?? last ?? dayClose`) — so this is not a difference in formula.
  The only remaining explanation: **Polygon's live real-time snapshot service and its archived
  historical `/v3/quotes` tape are not the same data** for a wide/thinly-quoted contract at the exact
  moment that matters. There is no way to retroactively recover the exact bid/ask production's real
  poll saw — that value was never persisted anywhere.

This is why §4 recommends prospective instrumentation rather than a better historical-data trick —
the historical data this specific gap needs simply does not exist to be found.

An earlier version of this validation also had a real, since-fixed bug: a short, fixed post-close
fetch window silently fell through to an expiry-settlement value when this reconstruction's own
replay narrowly missed a threshold (the AVAV case above, off by one cent). Fixed with an adaptive
design — attempt a generous window first, and only extend all the way to expiry when this
reconstruction's OWN control replay fails to terminate inside it (`banger-quote-tick-adversarial-validation.mjs`,
`needsExtension` logic) — confirmed this is now correct, not merely papered over, by the AVAV case
STILL correctly reporting a mismatch (rather than a wrong "verified") even under the full expiry
window, once the true cause (data-provider divergence, not a truncated window) was isolated.

---

## 2. The headline comparison — verified population, n=483

| | Control (100/50/50) | Candidate (100/33/70) |
|---|---|---|
| n | 483 | 483 |
| Win rate | 18.4% | — |
| Expectancy | −31.7% | (see delta below) |
| Profit factor | 0.3 | — |
| Median trade | −60.0% | −60.0% (identical) |
| Mean delta [95% CI] | — | **+0.3pp [−2.4, +2.9]** → **INCONCLUSIVE** |

**With realistic executable fills** (real BID at the exact decision tick, never priced better than
production's own model formula): **meanDelta = −0.9pp [−3.6, +1.8]** — still inconclusive, point
estimate now negative.

### 2.1 Every robustness check agrees, none support the candidate

| Check | Result |
|---|---|
| Median delta across all 483 trades | **0** (81% of trades — 391/483 — are EXACT ties: identical pre-scale behavior, or an identical exit price under both configs) |
| Trimmed mean (5% each tail) | **−1.0pp** |
| Leave-out-top-20 (by \|delta\|) | **−1.1pp → "CONTROL SEPARATED (better)"** — the verdict flips against the candidate once the 20 most extreme trades are set aside |
| Simple win/loss count (of the 92 trades that differ at all) | **58 favor control, 34 favor candidate** — control wins nearly 2x as often among the trades where the two rules actually diverge |
| Outlier concentration | top-1 trade's share of total delta: **−216%** (a single loss larger in magnitude than the entire population's net delta); top-3 tickers account for **471%** of the total (extreme cancellation, not a broad, real edge) |

**This is the opposite shape of a real, generalizable edge.** A genuine edge shows up in the median
and survives trimming; this one only exists in the raw, untrimmed mean, and evaporates (or reverses)
the moment a handful of extreme trades are set aside.

---

## 3. Root-cause mechanism — why the candidate does not win in real, granular data

Two concrete, evidenced mechanisms, both invisible to the prior summary-tier reconstruction's
"single monotonic decline from peak" assumption (its own stated methodology):

### 3.1 Gap-through-both-thresholds (candidate loses a downside case with zero offsetting benefit)

**AMPG, id=63** (real EXIT_RUNNER, entry $0.25, peak $0.53, real recorded exit at exactly the entry
price — a $0 raw runner return): the tighter (70%) and looser (50%) trail levels were **$0.371** and
**$0.265** respectively. The real quote tape shows the position gapping down in a single tick from
above both levels straight to **$0.25** — below BOTH thresholds at once. Neither trail gave any
early-warning advantage; the ONLY difference between the two configs was that the candidate had a
smaller guaranteed partial locked in (33% vs 50%) at the identical, shared 2x trigger. Result: control
$0.50 (blended 50%), candidate $0.33 (blended 33%) — a pure, mechanical loss for the candidate with
no offsetting benefit, because a real 1-tick gap in a thin option cannot be "caught earlier" by a
tighter percentage trail when it happens all at once.

### 3.2 Premature trail-out before a continuation rally (candidate loses an upside case)

**RBRK, id=43** (real EXPIRED — scaled_already, peak $20.30 from a $2.20 entry, production's real
50% trail NEVER fired, real trough $17.23, settled at expiry intrinsic $17.23, realized **+391.59%**,
byte-exact match to this study's control replay). The candidate's 70% trail level ($14.21) sits ABOVE
production's own real recorded trough ($17.23) — meaning even production's own coarser tracking never
saw the underlying come anywhere close to that level. This reconstruction's own full tick-level replay
found a fleeting sub-threshold dip the ARCHIVED tape shows but production's real, discrete ~1-5 minute
polling cadence would very plausibly never have sampled — closing the candidate's runner out at
**+112.18%**, a fraction of what riding the SAME position through to its real, eventual expiry
intrinsic value actually paid. **This is disclosed as a genuine methodological caveat** (§4.5): a
literal real-time deployment of the candidate rule would poll at the SAME discrete cadence as
production, not react to every single archived tick, so this specific case may overstate how often a
tighter trail gets stopped out this way. It does not reverse the overall conclusion — the gap-through
mechanism above is cadence-independent and real regardless — but it is named honestly as a place this
study's own tick-level fidelity could be MORE reactive than a real deployment would be.

Both mechanisms are the OPPOSITE of the previous reconstruction's implicit assumption (`a tighter
trail can only do at-or-better than a looser one`, per that module's own header) — an assumption that
is simply false for a real, volatile, gappy price tape, which is exactly what illiquid weekly options
on momentum breakouts produce.

---

## 4. Segmentation (winners/losers, ticker, DTE, entry premium, liquidity, regime, sample size)

| Segment | n | Mean delta | Verdict |
|---|---|---|---|
| **Winners** (real recorded outcome) | 94 | +1.4pp [−12.1, +14.9] | INCONCLUSIVE (wide CI — the KEY still-underrepresented population; see §1.2) |
| **Losers** | 389 | 0.0pp [0.0, 0.0] | INCONCLUSIVE (exact tie — STOP_OUT rows are pre-scale-identical by construction) |
| By ticker (n≥6) | NET(7)/SPCX(6)/SPCH(6)/HUT(6) | 0.0 / −12.4 / 0.0 / −3.8pp | all INCONCLUSIVE at this n |
| DTE=4 | 97 | **−4.1pp → CONTROL SEPARATED (better)** | a real, sizeable segment favoring production's own rule |
| DTE=7/8/9/10 | 90/120/71/105 | +5.8 / +0.6 / +2.5 / −2.4pp | all INCONCLUSIVE |
| Entry <$0.25 | 55 | −1.2pp | INCONCLUSIVE |
| Entry $0.25–0.5 | 73 | +6.7pp | INCONCLUSIVE |
| Entry $0.5–1.0 | 82 | −0.4pp | INCONCLUSIVE |
| Entry ≥$1.0 | 273 | −0.9pp | INCONCLUSIVE |
| Tight spread (< median 42.9%) | 240 | −0.8pp | INCONCLUSIVE |
| Wide spread (≥ median) | 243 | +1.4pp | INCONCLUSIVE |
| BULL regime | 307 | −0.8pp | INCONCLUSIVE |
| SIDEWAYS regime | 176 | +2.2pp | INCONCLUSIVE |
| HIGH_VOL | 245 | +0.2pp | INCONCLUSIVE |
| LOW_VOL | 238 | +0.4pp | INCONCLUSIVE |
| Early half (chronological) | 241 | −0.3pp | INCONCLUSIVE |
| Late half | 242 | +0.9pp | INCONCLUSIVE |

**Not one segment shows a statistically real, positive edge for the candidate.** The one segment
with a real, non-inconclusive verdict (DTE=4, n=97) favors CONTROL.

---

## 5. Realistic executable fills

Every SELL/exit fill (partial, runner-exit, hard-stop) is priced at the tick's own real BID rather
than the model/mid price, capped so it is never credited better than the model fill (a market sell
order cannot price-improve past what the model formula would give). Applied identically to control
and candidate. Result: **meanDelta = −0.9pp [−3.6, +1.8]** — the executable-fill track shifts the
point estimate further negative for the candidate, not toward it. Consistent with the model-track
finding: this is not an artifact of comparing two idealized fills — it holds up under a real,
conservative execution assumption too.

---

## 6. Failures and weaknesses found (as requested)

1. **The verification-rate imbalance (winners vs losers) is narrowed, not eliminated.** 52.3% vs
   20.3% (2.6x) — real winners remain underrepresented in the verified population, so the true
   population-wide answer carries more residual uncertainty than the n=483 headline number alone
   conveys. The winners-only segment (n=94, +1.4pp, CI [−12.1, +14.9]) is genuinely inconclusive —
   this study does NOT claim to have proven the edge is exactly zero for real winners specifically,
   only that there is no support for the previously-claimed +26pp.
2. **A demonstrated, unrecoverable data-provider gap**: Polygon's archived historical NBBO quote tape
   does not always reproduce what its own real-time snapshot service reported at the moment
   production actually polled it (AVAV, §1.3). This is the dominant driver of the remaining 60%
   unverified population and cannot be fixed by better historical-data engineering — see §7.
3. **A genuine methodological caveat in the OTHER direction**: this study's tick-level replay reacts
   to every archived quote tick, which can be MORE reactive than a real deployment (production polls
   at a discrete ~1-5 minute cadence, not every tick) — RBRK (§3.2) is a documented case where this
   may have closed the candidate out of a move a real, coarser-polling deployment might have ridden
   through. Disclosed rather than silently trusted; does not reverse the overall conclusion.
4. **Only 40% of the clean population is verifiable at all** with this method — any claim about the
   unverifiable 60% (whether "candidate would fare better" or "worse") is not supported by this data
   and should not be inferred either way.
5. **By-ticker segmentation is still thin** (max n=7) — no ticker-level claim is supportable yet.
6. **The executable-fill model uses the tick's own bid as the realistic fill** — a reasonable,
   conservative choice, but it does not model market-impact for a large order, partial fills, or a
   missed fill entirely (a real stop order in a fast, thin market can fail to fill at the observed
   bid). The true executable result could be worse than this study's own (already negative-leaning)
   executable-track number.

---

## 7. Recommendation: prospective instrumentation

Given the demonstrated, structural gap between Polygon's live snapshot feed and its historical quote
archive, **no further historical-data engineering can close this validation's remaining verification
gap.** The only way to get ground truth for the currently-unverifiable 60% of positions is to persist
production's own real, live snapshot poll result (bid/ask/last/resolved mark) at the moment it is
actually read — going forward, not retroactively.

**Recommended, purely additive, non-behavior-changing instrumentation** (not built in this session —
scoped here for a follow-up, since it touches production code and deserves its own reviewed PR):

- A new, append-only table (e.g. `banger_quote_ticks`: position id, occ, ts, bid, ask, resolved
  mark, reliable mark, last-trade reference, source) written from INSIDE `banger-live-sync.ts`'s
  existing `fetchMarks` callback — piggybacking on data ALREADY being fetched every cron tick, zero
  additional Polygon calls.
- Write is fire-and-forget / best-effort: a write failure must never affect the real exit decision
  path — this is an observability log, not a dependency.
- Once even a few weeks of this accumulates, a future validation round can replay ANY exit
  configuration against production's own EXACT, real, historically-faithful polling tape — closing
  the verification gap completely, not just narrowing it.

## 8. What to test next

1. **Do not ship 100/33/70.** The evidence does not support it; several checks lean the other way.
2. **Land the prospective instrumentation (§7) first** — every future exit-rule validation depends on
   having real ground truth, not a second-guessed historical reconstruction.
3. Once instrumentation has accumulated a few weeks of real tick data, re-run this EXACT methodology
   against it — verification rate should approach 100% (no archived-vs-live gap left to cross), and
   the winners-segment sample (§4) will finally be large enough to draw a real conclusion.
4. **Do not optimize a new candidate configuration from the summary-tier reconstruction again** — §3
   demonstrates its core assumption (monotonic decline from peak) is empirically false for this
   asset class in both directions (gap-through and premature trail-out). Any future candidate search
   should be built directly against tick-level (or, once available, prospectively-logged) data.
