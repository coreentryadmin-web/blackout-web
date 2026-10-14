> **kind:** FINDING

## Swing play-brief: Net GEX/VEX/DEX/CHARM render as 6-7 digit "M" figures on real tickers — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** Every "Net GEX/VEX/DEX/CHARM" line in the swing play-brief divided the raw dealer-
exposure dollar figure by `1_000_000` and suffixed a bare `"M"`, with no regard for how large the raw
figure actually is: `play-brief-intel.ts`'s `gexPostureSection` (4 lines — GEX/VEX/DEX/CHARM),
`play-brief.ts`'s `tradeManagerNarrativeSection` (1 line — GEX), and `play-brief-narrative.ts`'s
`dealerPostureLine` (1 line — GEX). Net CHARM in particular is *structurally* 10-1000x larger than net
GEX at the SAME instant for the SAME ticker — a property of how charm/delta-decay sensitivity is
computed, not a per-ticker anomaly — so "M" is routinely the wrong unit for it, and "M" is the wrong
unit for net GEX itself on index-scale tickers (SPY/SPX).

**Evidence.** Live `GET /api/market/gex-positioning?ticker=<T>` (2026-10-14, Ask Largo standing deep-
dive, no AWS/DB access needed — plain authenticated API reads), 4 real tickers, all same GEX << DEX <
VEX << CHARM magnitude ordering:

| ticker | net_gex | net_vex | net_dex | net_charm |
|---|---|---|---|---|
| GOOGL | 230.4M | 16.3B | -4.3B | **-217.5B** |
| TSLA | -172.3M | 8.8B | 828.0M | **-292.1B** |
| AAPL | 2.2B | 25.1B | -31.4B | **-283.9B** |
| SPY | -17.5B | 292.5B | 36.6B | **-3.2T** |

Under the old `/1e6` + `"M"` format, these render as `Net CHARM (pinning): **-217513.8M**` (GOOGL — the
exact string observed in a live `GET /api/market/swing/play-brief?playId=SWING:GOOGL:54` closed-play
read this cycle) and would render `**-3211296.7M**` for SPY — six and seven significant digits in
front of the decimal. Every individual number is *correct*; the *unit* is wrong. This directly works
against the Largo mandate's "connected trade-manager prose" bar: a figure like `-217513.8M` reads as a
data glitch, not a dealer-exposure reading, and a member/Largo cannot sanity-check it at a glance the
way `-217.5B` can be.

Net GEX hits the same defect at smaller scale but real impact on index-scale tickers — SPY's own net
GEX (`-17.5B` raw) would render `-17545.3M` under the old format.

**Blast radius.** All 6 call sites share the identical root pattern (verified via
`grep -rn "/ 1_000_000, 1)}M\|/1e6, 1)}M" src/lib/swing/` before the fix, confirmed empty after):
`play-brief-intel.ts` (Net GEX, Net VEX, Net DEX, Net CHARM — 4 lines), `play-brief.ts`
(`tradeManagerNarrativeSection`'s net GEX bit), `play-brief-narrative.ts` (`dealerPostureLine`'s net
GEX bit). All 6 fixed in this PR — not just the one (`gexPostureSection`'s Net CHARM line) first
reproduced live.

**Fix.** Added `formatDealerDollars(raw: number): string` to the shared `format-nonzero.ts` (already
imported by all 3 affected files): picks M/B/T by magnitude (`>=1e12` → T, `>=1e9` → B, else M),
reusing `formatFixedNonZero` at whichever scale is chosen so the existing false-zero-widening
behavior (a real, small net GEX must never collapse to `"0.0"`) still applies at every scale. All 6
call sites now pass the RAW dollar figure to `formatDealerDollars` instead of pre-dividing by `1e6`
and hardcoding the `"M"` suffix.

**Fix rationale.** A shared formatter at the one file (`format-nonzero.ts`) all 3 call sites already
imported is the smallest change that fixes every instance of the same root cause at once, rather than
patching the one `gexPostureSection`/Net CHARM line that happened to reproduce first. Kept the
existing caller-side `"+"` sign prefixing (`play-brief.ts`'s `tradeManagerNarrativeSection`) unchanged
— `formatDealerDollars` itself only emits `"-"` for negative values, same as the old
`formatFixedNonZero` call it replaces, so callers that want an explicit `"+"` for positive values
still add it themselves. Did not touch Thermal's own `formatPositioningBlock`
(`src/lib/bie/thermal-read.ts`) — it uses a different convention entirely (full comma-separated raw
numbers, no M/B suffix at all) and is a different lane's owned surface; flagging it is out of scope
for a single-issue swing-lane PR.

**Tests.** `format-nonzero.test.ts` gained 5 new tests for `formatDealerDollars`: unchanged M-scale
behavior under $1B (including the existing false-zero-widening case), the exact live GOOGL/AAPL B-scale
values, and the exact live SPY T-scale value. RED→GREEN proven via `git stash` of the fix: the 4 new
`formatDealerDollars` tests failed with `is not a function` on the pre-fix source (5 pre-existing
`formatFixedNonZero` tests stayed green, confirming the stash didn't touch that function); restoring
the fix brought all 9 back to green. Full suite of the 4 touched files
(`format-nonzero.test.ts`, `play-brief-intel.test.ts`, `play-brief.test.ts`,
`play-brief-narrative.test.ts`) — 488/488 pass, including every existing VEX/DEX/CHARM fixture
(`2.0M`/`-1.5M`/`0.8M` from `gexPostureSection`'s own test) unchanged at M-scale. `tsc --noEmit` clean
on Node 20.
