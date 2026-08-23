# FULL PRODUCT CERTIFICATION — SPX SLAYER

Ordered directly by the user, relayed by the coordinator. Do not treat this as a routine chokepoint
task or a continuation of the Monday RTH validation queue. This supersedes the standing RTH backlog
in priority terms only — finish anything already mid-flight, then treat this as the top of your
queue. Do not assume SPX Slayer is complete, correct, optimized or feature-complete because it
shipped or CI is green. This is not a code review and not a superficial UI walkthrough. You must
independently PROVE your entire product is correct, useful, reliable, fast and competitive.

Your member route is `/dashboard`.

## 1. Inventory everything
Build (or bring current) a complete inventory of everything a member can see or interact with:
page → section → panel → card → field → label → value → badge → status → table → column → chart →
level → tooltip → button → tab → filter → search → sort → dropdown → modal → drawer → link → alert
→ empty state → loading state → error state. `docs/spx/SLAYER-MAP.md` is your Phase-0 inventory —
bring it current rather than starting from zero (it says §8 is complete except item 2 — this audit
is broader than item 2, so don't treat §8-complete as covering it). Treat any gap between the map
and the live product as a finding in itself.

## 2. Validate every number
What it means, where it originates, upstream source, transformation, calculation, units, timestamp,
freshness, source-unavailable behavior, independent verifiability. Trace SOURCE → INGESTION →
NORMALIZATION → STORAGE/CACHE → CALCULATION → API → FRONTEND → DISPLAY. Compare the rendered value
against the underlying source (Polygon ground truth via `data-validator.mjs`'s SPX-desk block).
Never assume a reasonable-looking number is correct — you already flagged the "96% conviction"
constant as computed from n=51 with measured-infeasible calibration; extend that same skepticism to
every other number on the desk, not just the one already caught.

## 3. Validate every label
Is "conviction"/confidence honestly calibrated or is it a raw score dressed up as confidence (look
for siblings of the 96% constant)? Does a playbook label (VWAP Reclaim/Reject) match what actually
triggered it? Does GEX/gamma-flip/max-pain terminology match the underlying math? Words are product
correctness.

## 4. Validate every panel
For each panel on `/dashboard` (including the embedded Vector panel — coordinate with the Vector
lane rather than re-auditing its internals, but DO verify the embed itself renders correctly and
doesn't degrade the SPX desk): why does it exist, what decision does it help make, is it correct, is
anything missing or redundant, is a different visualization better, does it deserve more/less
prominence, should it be redesigned or removed.

## 5. Test every interaction
Use the deployed product like a human member via the tools you already built (`spx-collision-localise.mjs`,
`spx-rendered-text-probe.mjs`, `proxy-browser.cjs`). Click everything: filters, sort every table,
open/close panels, expand/collapse, drawers/modals, hover charts, crosshairs, zoom/pan, timeframes,
overlays, refresh mid-state, navigate away/back, deep links, browser back/forward, desktop AND phone
viewport (device CLASS changes the answer — always state which class you measured), loading/empty/
stale/disconnected/error/recovery states. Confirm the RESULTING DATA is correct, not just that the
button responds. Chase the two already-reported-but-unresolved defects: the nav wordmark/☰ toggle
overlap on phone, and the React #418 hydration mismatch after clicking Learn — marketing-lane chrome,
so file findings and route them rather than dropping them.

## 6. Validate the logic
RAW INPUT → FEATURES → CALCULATIONS → RULES → THRESHOLDS → MODELS → SCORES → GATES →
CLASSIFICATIONS → SIGNALS → STATE TRANSITIONS → OUTPUT. Wrong calculations, hidden fallbacks,
arbitrary thresholds, unreachable logic, contradictory rules, race conditions, stale state, bad
caching, look-ahead leakage, overfitting, duplicated logic, wrong edge cases, misleading confidence,
wrong classifications. Your own item-2 finding (calibrated confidence measured infeasible at n=51)
is a data point, not a closed question — decide with evidence whether the desk should render a raw
score instead of implying calibration it doesn't have.

## 7. Audit the architecture
Map providers → ingestion → processing → engines → databases → caches → jobs → queues → APIs →
WebSockets → frontend → member for your slice, including the playbook/trade-governor gates you
already flagged (severe/degraded data-quality modes behind a dead flag). Bottlenecks, unnecessary
complexity, duplicated computation, excessive provider calls, fragile dependencies, single points of
failure, poor failure isolation, bad caching boundaries, unnecessary coupling, scalability
constraints, observability gaps, technical debt.

## 8. Performance certification
MEASURE, don't assert "fast": initial load, time to useful data, API latency, feed freshness (the
30s TTL+SWR question you already flagged as unmeasured), chart render, interaction latency, search/
filter latency, rerenders, payload sizes, cache hit/miss, resource usage.

## 9. Product & UX review
Think like a trader paying for BLACKOUT, for SPX specifically. What matters right now? Can I
understand it immediately? Where's the opportunity/risk? What changed and why? What should I watch
next? What am I still missing? Hierarchy, visualization, navigation, discoverability, density,
mobile usability.

## 10. Find new features
USER PROBLEM, PROPOSED CAPABILITY, WHY EXISTING PRODUCT DOESN'T SOLVE IT, DATA REQUIRED, EXPECTED
TRADER VALUE, IMPLEMENTATION COMPLEXITY, RISK, HOW SUCCESS WILL BE MEASURED. Classify P0/P1/P2/P3.

## 11. Competitive review
What do excellent SPX/index-options products make possible that SPX Slayer lacks? What does it
already do better? What proprietary BLACKOUT data creates an advantage competitors can't reproduce?

## 12. Find what wasn't asked about
What haven't you inspected? What would an expert index-options trader / quant / CTO / product
designer / security engineer complain about? What fails during an extreme SPX session (gap, VIX
spike, halt)? What feature would make SPX Slayer dramatically more valuable?

## 13. Evidence — the certification matrix
Produce and commit `docs/spx/SPX-SLAYER-CERTIFICATION.md`: COMPONENT | FIELD/INTERACTION |
SOURCE/LOGIC | VALIDATION PERFORMED | RESULT | ISSUE | SEVERITY | ACTION | EVIDENCE | STATUS
(NOT TESTED/TESTING/FAILED/FIXING/DEPLOYED/LIVE VERIFIED). Nothing is LIVE VERIFIED without
production evidence.

## The five open decisions you already owe the coordinator
Fold your answers on production_eligible gating, the 96% conviction constant, #2693 category A/B,
and the 12 unaudited crons into this certification rather than a separate side conversation.

## Reporting back
The coordinator will challenge "everything looks good" / "tests pass" / "CI is green" — show the
inventory, data lineage, interaction coverage, production validation, what you found wrong, what you
improved, what new capabilities you considered. Every real defect gets the standard fix/branch/test/
findings-staging/PR treatment per CLAUDE.md — P0s first, one issue per PR, small PRs, normal
draft→ready flow. Do not batch every fix into one giant PR. The coordinator pulls status on its own
cycle — front-load anything P0. No permanent DONE — CURRENT VERSION CERTIFIED is the ceiling, then
back to OBSERVE → QUESTION → DISCOVER → ANALYZE → IMPROVE → TEST → DEPLOY → VERIFY → MEASURE →
REPEAT with the certification matrix as your new baseline.
