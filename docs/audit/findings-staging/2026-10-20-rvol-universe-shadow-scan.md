## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] RVOL universe shadow scan — opening-print noise caught, quiet-population lift NOT confirmed

> **kind:** `FINDING`

| **Status** | MEASURED (no gate/filter/screen threshold changed — evidence only, per standing discipline) |
|---|---|

**Context.** Member directive: "Build unbiased RVOL shadow collection across the eligible scan
universe, including names that never become BREAKOUT candidates or commits. Logging only
eventual commits or rejected candidates may still miss the early detection problem."

### Why this exists

Every prior RVOL measurement this round starts from the real whole-market BREAKOUT/BREAKDOWN
screen's own qualifying pool — tickers that already cleared `screenBreakoutMovers`/
`screenBreakdownMovers`'s gain%/close-strength thresholds that day. That cannot surface whether a
meaningful population of names that NEVER clear those thresholds still shows a real RVOL signal
and a real tradable move the discovery pipeline structurally never sees. New script
`zerodte-rvol-universe-shadow-scan.mjs` closes that gap: pulls the full real grouped-daily
universe, applies the SAME liquidity floor the real screen applies (price/volume, imported
directly), and splits it into QUALIFYING (cleared the screen) vs QUIET (never cleared it, but
liquidity-matched). For each sampled ticker (ranked by $-volume in both buckets, same ranking
production itself uses), walks real minute bars computing the real, unmodified
`computeRelativeVolume` classification minute-by-minute, no look-ahead.

### A real methodological issue caught before trusting any headline number

The first pass's unconditional "avg minutes from signal to close" looked like strong
leading-indicator evidence (353min). Before reporting it, a histogram of WHEN signals actually
fire found **74.6% of all QUALIFYING RVOL signals (144/193) fired within the first 10 elapsed
minutes of the session** — traced to `RVOL_MIN_ELAPSED_MINUTES=3` (the earliest point
`computeRelativeVolume` returns a non-null ratio at all): at that instant the denominator
(expected-by-now volume from the time-of-day profile) is smallest, so a single ordinary opening
print can trivially swamp it. This is not a script bug — confirmed against the real
`computeRelativeVolume` source — but it means most "early RVOL signal" instances are very likely
measurement noise from a thin 3-minute sample, not genuine predictive timing. Fixed by splitting
early (<=10 elapsed min) from later signals in every report, and by adding a BASE-RATE CONTROL for
the QUIET bucket (the same favorable-first-move rate graded from the plain RTH open, with no RVOL
conditioning at all) — without it, a bare "X% of RVOL-signaled quiet names moved favorably" is
uninterpretable, since grading from a signal that fires at minute 3 is nearly the same as grading
from the open, and some base rate of liquid names move 1.5%+ over a full session by chance alone.

### Result (10 real session days, 2026-09-06 window: 2026-10-06…2026-10-19, 400 qualifying + 600
quiet rows, liquidity-matched by the real screen's own price/volume floor)

**QUALIFYING bucket** (cleared the real screen that day): 193/400 (48.3%) carried an RVOL signal.
Of those, 144 (74.6%) fired within the opening-noise window; only 49 (25.4%) fired later in the
session. For the later, more credible subset: avg minutes from signal to close = 262min — this is
the number that actually bears on §A's leading-indicator hypothesis (the unconditional average
across all signals is inflated by the opening-noise cluster and should not be quoted alone).

**QUIET bucket** (liquidity-matched, never cleared the real screen) — the literal "early detection
gap" population:

| | n | rate |
|---|---|---|
| Base rate (no RVOL conditioning, full session, fav=1.5%) | 600 | 116/600 = 19.3% |
| RVOL-signaled (graded from signal to close) | 248 | 37/248 = 14.9% |
| **Lift over base rate** | | **-4.4pp** |

### What this does NOT establish, and what it DOES

**The quiet-population early-detection-gap hypothesis is NOT confirmed at this sample size.** The
RVOL-signaled rate (14.9%) is actually slightly BELOW the base rate (19.3%) — a small negative
lift, well within what sampling noise at n=248 could produce, but certainly not evidence that RVOL
is catching real moves in names the discovery screen misses. At face value this argues AGAINST the
hypothesis that logging-only-commits/rejects was hiding a real early-detection signal in the quiet
population — on this measure, RVOL conditioning doesn't clear even the unconditional base rate.

**The QUALIFYING-bucket leading-indicator question is still open, but on a much smaller, more
honest subset than the unconditional average suggested.** 25.4% of signals (49/193) fire later in
the session in a way not attributable to opening-noise; those show a real 262min average lead —
worth continuing to track as the collection grows, but the dominant 74.6% opening-noise fraction
means the RVOL thresholds as currently calibrated (`RVOL_VERY_HIGH=2.0`/`RVOL_HIGH=1.5`, explicitly
documented as "INITIAL, UNCALIBRATED" in `relative-volume.ts`) are firing mostly on opening-print
variance, not genuine intraday anomalies — itself a useful calibration signal for whoever tunes
those thresholds against real paired-outcome data per that module's own intended shadow-mode path.

**No gate, filter, or screen threshold changed.** This is evidence-gathering only, and the
collection is designed to grow across sessions (`--replay`/fresh `--days`) rather than be treated
as a one-shot conclusion at n=10 days.

### Blast radius

No gate, filter, exit rule, or live trading-path behavior changed. One new script
(`zerodte-rvol-universe-shadow-scan.mjs`) plus its persisted collection history
(`docs/audit/history/zerodte-rvol-universe-shadow/`, 10 real session-day files).
