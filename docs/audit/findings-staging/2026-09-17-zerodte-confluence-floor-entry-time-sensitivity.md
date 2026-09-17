> **kind:** `FINDING`

## `confluence_floor` (G-12) outcome re-check: verdict is entry-time sensitive (INVERTED@10:00 → SPREAD WITHOUT ORDER@11:00), but the 2-conf "edge bucket" claim fails to reproduce at either time

| | |
|---|---|
| **Area** | 0DTE — confluence-floor calibration evidence (`ZERODTE_CONFLUENCE_MIN`/`ZERODTE_CONFLUENCE_MIN_EARLY`, gates.ts G-12) and backtest methodology generally |
| **Severity** | P2 (evidence-only; surfaces both a real methodology sensitivity affecting multiple tools in this toolkit and a real, entry-time-independent result about the E3 edge bucket) |
| **Status** | OPEN — reported per the standing escalation policy (a calibration question needing a larger-N/real-premium follow-up, and a methodology question worth applying to sibling backtests); no gate/threshold changed in this PR. |

### What was built and found

Built `scripts/audit/zerodte-confluence-floor-outcome-backtest.mjs` (PR #5143) — the confluence-floor
sibling of `zerodte-score-floor-outcome-backtest.mjs`, re-deriving real scored setups per historical
session day, attaching a REAL confluence read (`computeIntradayRead`/`marketBias`/`computeConfluence`
— the exact functions `scan.ts`'s own `attachConfluence` calls) computed AS-OF a fixed entry time, and
grading forward outcome on real Polygon minute bars with the same favorable-first
underlying-continuation proxy the score-floor backtest uses.

First run defaulted to 10:00 ET (matching the score-floor script's own default, itself chosen for
G-2's unlock time, not E3's actual methodology) and came back **INVERTED**:

```
                              0-conf   1-conf (standard)   2-conf (early-window/E3 edge)
@10:00 ET (18 sessions, n=415):  32.7%      17.9%                 13.4%    -> INVERTED, rho=-1.00
```

Before reporting this at face value, checked E3's own original methodology
(`docs/audit/0DTE-RESEARCH.md`'s Experiments table: "Confluence: 0/1/2 confirmations... **@ 11:00**")
— E3 used an **11:00 ET** entry, not 10:00. E2 (same doc) already found 10:00 ET is itself a
documented negative-EV entry time (−7.8% EV), independent of any gate. Re-ran at 11:00 ET:

```
@11:00 ET (18 sessions, n=415):  24.3%      24.8%                  9.6%    -> SPREAD WITHOUT ORDER, rho=-0.50
```

### Two distinct findings

1. **Methodology sensitivity, real and measured.** Moving the fixed synthetic entry from 10:00 to
   11:00 ET changed every bucket's win rate materially (0-conf 32.7%→24.3%, 1-conf 17.9%→24.8%,
   2-conf 13.4%→9.6%) and changed the overall verdict from `INVERTED` to `SPREAD WITHOUT ORDER`.
   Concretely, the specific comparison the 2026-09-08 confluence-floor loosening depends on (is
   1-conf ~flat vs 0-conf, not negative) flips from a concerning −14.7pp at 10:00 ET to a reassuring
   +0.6pp at 11:00 ET — consistent with E3's own original claim. **This raises the same question for
   `zerodte-score-floor-outcome-backtest.mjs`'s own INVERTED result** (`docs/audit/findings-staging/
   2026-09-17-zerodte-score-floor-inverted.md`), which was also graded from a 10:00 ET entry — a
   re-run at 11:00 ET is in progress; see that finding for the follow-up once it lands.
2. **The 2-conf bucket (E3's own claimed +15.9% EV edge, also today's `ZERODTE_CONFLUENCE_MIN_EARLY`
   requirement) grades WORST at BOTH entry times** (13.4% @10:00, 9.6% @11:00) — entry-time
   INDEPENDENT, and does not reproduce E3's original edge claim under this proxy at either time.

### Why this is being reported, not fixed

Same scope caveats as the score_floor re-check: this measures a favorable-first
underlying-continuation proxy, NOT E3's own real-option-premium methodology, and `confirmations`
alone, not jointly gated with the rest of the stack. The 2-conf finding (item 2 above) is the more
robust of the two since it survives the entry-time correction, but it is still a single-sample
proxy-basis result against a gate whose original evidence was real premium P&L — not sufficient on
its own to touch `ZERODTE_CONFLUENCE_MIN_EARLY`.

### Recommended next steps (not done here — reporting only)

1. Re-run `zerodte-score-floor-outcome-backtest.mjs --entry=11:00` (in progress) to check whether
   score_floor's own INVERTED verdict is similarly entry-time-sensitive.
2. If the pattern holds broadly, consider whether `--entry` defaults across this toolkit's
   proxy-based backtests should move to 11:00 ET (E2/E3's own validated entry point) rather than
   10:00 ET (chosen for a different gate's unlock time) — a tooling/methodology decision, not a
   product gate change, and out of scope for this PR.
3. The 2-conf "edge bucket doesn't reproduce" finding deserves the same real-premium re-derivation
   already recommended for score_floor's E6 re-check — a proxy-basis, entry-time-independent miss on
   E3's own headline claim is worth confirming (or refuting) against real option P&L before treating
   `ZERODTE_CONFLUENCE_MIN_EARLY=2` as settled.

### Evidence

Full run detail: `docs/audit/0DTE-RESEARCH.md`, E3 section ("confluence (the edge)").
