> **kind:** FINDING

## Public Learning Academy docs leaked internal component names + unsubstantiated predictive claim — FIXED

| **Status** | Fixed in this PR |

**Root cause:** `src/lib/learn/articles.ts` — the public `/learn/*` guide content — used internal
React component names verbatim as section headers and inline copy across the Vector, Thermal,
HELIX, Night Hawk, and Largo guides: `VectorGexLadder`, `VectorRegimeBanner`,
`GexShiftLeadersStrip`, `ExposureProfile`/`CumulativeCurve`/`ShiftView`, `ExpiryScope`,
`KeyLevelBox`, `AlertsStrip`, `FlowAnomalyBanner`, `FlowBrief`, `HelixTideBar`/`TideBar`,
`DarkPoolRail`, `TickerDrawer`, `PlaybookBoard`, `HawkRecordStrip`, `MarketContextBar`,
`FreshnessChip`, `LargoThinkingState`. These read as engineering identifiers accidentally surfaced
as customer education rather than product copy — a member has no reason to know or care that a
panel is implemented as a component called `GexShiftLeadersStrip`.

**Evidence:** `grep -n '\b[A-Z][a-zA-Z]*(Rail|Panel|Strip|Banner|Ladder|Board|Bar|Drawer|Scope|Box|View|Curve|Feed|Chip|Matrix|Tab)\b' src/lib/learn/articles.ts` surfaced 20+ occurrences across five separate product guides — this was systemic, not isolated to Vector.

**Also fixed — unsubstantiated predictive claim (Vector guide):** the GEX Shift Leaders section
claimed a large intraday GEX shift "often precedes a regime change or a wall break." No measurement
of this relationship has been published (checked `docs/audit/` for any backtest of this claim —
none exists), and Largo can ingest and repeat platform copy as if it were empirically established.
Reworded to describe the shift as "worth watching," and explicitly states no hit-rate has been
measured or published for it.

**Also fixed — deterministic gamma-flip framing:** the Vector guide's screener table defined the
gamma flip as flatly "above = pinned, below = trending," and the standalone Gamma Flip guide's
worked example concluded "the only variable that changed was which side of the flip price sat on
… before the candle printed" — both treat dealer gamma as a binary market-state switch rather than
one regime input among several (liquidity, macro catalysts, flow). Reworded both to state the
historical tendency while being explicit that it's an input, not a guarantee — this matters because
Largo can ingest and repeat the same framing when answering regime questions.

**Fix:** Renamed every internal identifier to plain product language while leaving the actual
component/file names untouched (`VectorGexLadder.tsx`, `GexShiftLeadersStrip.tsx`, etc. keep their
internal names — only the public-facing docs prose changed): "GEX Ladder", "Regime Read"/"regime
banner", "GEX Shift Leaders", "Exposure bars"/"Cumulative curve"/"Shift view", "Expiry filter
chips", "Key Levels", "Alerts", "Flow anomaly alerts", "Flow Brief", "The Tide bar", "dark pool
lines", "ticker detail view" (drill-down drawer), "the playbook" (Night Hawk), "track record
strip", "market context bar", "freshness chip", "thinking state" (Largo).

**Blast radius:** All within `src/lib/learn/articles.ts` — no component code, routing, or tests
outside this file needed to change since only the rendered guide prose was affected.

**Test:** `node --import tsx --test src/lib/learn/articles.test.ts src/lib/learn/metatitle-length.test.ts src/lib/learn/article-faqs.test.ts src/lib/learn/related-articles.test.ts src/lib/learn/guide-seo.test.ts src/lib/learn/article-dates.test.ts` → 20/20 pass. `npx tsc --noEmit` → clean.
