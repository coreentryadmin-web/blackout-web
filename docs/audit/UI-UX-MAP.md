# UI-UX-MAP — the inventory

**Lane:** UI/UX & Product Experience (owner). **Phase 0 deliverable** of `docs/agents/briefs/ui-ux.md`.
Living document — keep it current forever after; when it and the live product disagree, the
product wins and the map is a bug.

**Status:** first pass, written 2026-08-23 (Sun, market closed) against `main` at `c53ce32ae`.
Coordinates and component inventory read from source on that commit. Page structure (SECTION →
… → ERROR) measured live against production via `proxy-browser.cjs` at desktop (1440×900) and
mobile (430×932), one temp Clerk admin session per shot (`scripts/audit/lib/prod-clerk-session.mjs`
`mintClerkPremiumSession`, always deleted). Screens marked **`LIVE 2026-08-23`** were rendered and
visually inspected this pass; anything not yet shot is marked **`SOURCE-ONLY`** and is a gap to
close on the next pass, not a claim about the live page.

**Methodology note — the minted-session JWT is short-lived (~60s `exp`).** A shot that starts
navigation late in that window can land on a real transient error (a client-side error boundary,
a stalled skeleton) that has nothing to do with the product. Every "error" or "still loading" state
recorded below was reproduced on a second, freshly-minted shot before being written down as real;
where a retry wasn't run, the entry says so explicitly. This is the same trap CLAUDE.md's
"Access reality" §1 describes for long-running harnesses, just at single-shot timescale.

**Second methodology note — the market is closed for this whole pass (Sunday).** Every "STALE" /
"MARKET CLOSED" / "no session today" badge captured below is the CORRECT closed-market state, not
a defect. Live-market interaction testing (clicking, filtering, sorting, hovering charts — brief
item 2's "a single screenshot is not enough") is queued for the next **LIVE VALIDATION** window
(Mon–Fri 09:30–13:00 ET, `_COMMON.md` rule 6b-i) and is a known gap in this pass, not an omission.

---

## 0. What this map covers

BLACKOUT's seven product surfaces plus the shared chrome and public site, per the lane charter:

| Product | Member route | Gate | `ToolKey` |
|---|---|---|---|
| SPX Slayer | `/dashboard` | `requireTier("community")` (lowest bar — the flagship/entry desk) | `spx` |
| Helix (options flow) | `/flows` | `requireTier("premium")` | `flows` |
| Thermal (GEX/gamma) | `/heatmap` | `requireDeskTool("premium", "heatmap")` → `ComingSoon` if not launched | `heatmap` |
| Vector (walls/flow chart) | `/vector` (+ embedded on `/dashboard` via `SpxVectorEmbed`) | `requireDeskTool("premium", "vector")` | `vector` |
| Meridian (earnings/catalysts) | `/meridian` | `requireDeskTool("premium", "meridian")` | `meridian` |
| Night Hawk (0DTE/swing/banger) | `/nighthawk` | `requireDeskTool("premium", "nighthawk")` | `nighthawk` |
| Largo (AI desk analyst) | `/terminal` | `requireDeskTool("premium", "largo")` | `largo` |

Plus shared chrome (`src/components/Nav.tsx`, `StaticLandingFooter.tsx`, `DeskShell.tsx`) and the
public surfaces: `/`, `/pricing`, `/upgrade`, `/faq`, `/learn*`, `/about`, `/vs/others`,
`/why-blackout`, `/track-record`, `/account`, sign-in/up, plus admin (`/admin*`, out of scope for
member-facing UX but noted where it shares components).

`src/lib/tool-access.ts`'s `TOOL_BY_KEY` is the source of truth for which tools exist and their
`defaultLaunched` flag — `largo` is the one tool that ships `defaultLaunched: false` (per-member
launch gate on top of the tier gate), everything else defaults launched. A tool that fails BOTH
gates renders `ComingSoon` (§1.3 below), never a 404 or a blank page.

---

## 1. Shared chrome — the one thing every route has in common

**Coordinates:** `src/components/Nav.tsx` (550 lines) is the ENTIRE top navigation for the whole
site — marketing pages and every authenticated desk page render the exact same component. There is
no separate "app nav" / desk-only chrome. `src/components/layout/DeskShell.tsx` (28 lines) wraps
desk routes with a `--nav-offset` top-padding var and does nothing else — desk pages do not add
their own navigation rail, breadcrumb, or product switcher on top of it.

**LIVE 2026-08-23** — confirmed identical nav bar (logo · Features ▾ dropdown · FAQ · Learn ·
"Open desk →" CTA) rendered pixel-for-pixel across `/flows`, `/heatmap`, `/vector`, `/meridian`,
`/nighthawk` screenshots.

### 1.1 The "Features" dropdown IS the cross-product switcher

`Nav.tsx:22-30`'s `FEATURE_LINKS` is the complete list a member uses to move between products:

```
SPX Slayer  → /dashboard   HELIX        → /flows      BlackOut Thermal → /heatmap
Largo       → /terminal    Night Hawk   → /nighthawk  Vector           → /vector
Meridian    → /meridian
```

This is the same dropdown shown to a signed-out marketing visitor, reused unmodified as the
in-desk product switcher. Consequences worth having on record before any nav redesign (brief
item 10):

- **No current-product indicator.** Nothing in the dropdown marks which of the 7 items is the page
  the member is already on.
- **No ticker/context carryover.** Every link is a bare static `href` — switching from Helix
  (viewing e.g. NVDA flow) to Thermal does not deep-link NVDA; the member lands on Thermal's
  default ticker and re-searches. The brief's "investigating the same market object through
  different intelligence lenses" standard (item 10) is not met by the current nav — it is 7 separate
  static links, not a context-preserving switch.
- **Full navigation, not a tab switch.** Every product-to-product move is a full Next.js route
  change (2 clicks: open dropdown, click item), not a client-side panel swap — reasonable given
  each product is its own route/bundle, but worth naming as the ceiling on how fast a
  Helix→Thermal→Vector investigation can currently be.
- **iOS native shell is the one exception, and only for 2 of 7 products.**
  `IosIntelligenceHubSegment` (`src/components/ios/IosIntelligenceHubSegment.tsx`) renders a
  Flow | Thermal segmented control INSIDE the native app shell only (`useIosNativeShell()` gate),
  switching `/flows` ↔ `/heatmap` client-side. No equivalent exists for the other 5 products, and
  nothing equivalent exists on web desktop at all.

### 1.2 Auth-state nav fallback (a real design decision, not a bug we tripped over)

`Nav.tsx:434-439`: when the server/cookie says signed-in but Clerk's client JS hasn't confirmed
the session yet (`isSignedIn && !(isLoaded && clerkSignedIn)`), the nav shows an "Open desk →" CTA
rather than falling back to "Sign In". Every screenshot in this pass shows exactly this state,
because `mintClerkPremiumSession` sets a raw `__session` JWT cookie without a matching `__client`
cookie, so Clerk's client library never reaches `clerkSignedIn`. **This is expected for our
minting method, not a member-facing defect** — the code comment at that line states the intent
directly ("Cookie/server say signed-in but Clerk JS hasn't confirmed yet — never fall back to
Sign In"). Recorded here so a future pass doesn't re-discover it as a false positive.

### 1.3 Locked-tool empty state

`src/components/ComingSoon.tsx` — full-page padlock screen shown when a member is tier-eligible but
the specific tool isn't `defaultLaunched` for them (currently only reachable for `largo`, since
every other tool defaults launched). Product mark + lock badge + "Coming soon" + a pointer to the
two always-available tools (SPX Slayer, HELIX). Not shot live this pass (no non-launched test
account minted) — **SOURCE-ONLY**.

---

## 2. SPX Slayer — `/dashboard`

**Coordinates:** `src/app/(site)/dashboard/page.tsx` → `SpxDashboard`
(`src/features/spx/components/SpxDashboard.tsx`, 481 lines) wrapped in `DeskShell`. Lowest gate on
the platform (`requireTier("community")`) — the flagship/entry desk. 19 component files under
`src/features/spx/components/`.

**Composition** (`SpxDashboard.tsx`, all dynamic-imported, no SSR): `SpxSniperHeader` →
`SpxGexMatrixHeatmap` (897 lines, largest component in the product) → `SpxPinForecast` →
`SpxPlayVerdictBar` → `SpxIntelRail`. Each wrapped in its own `SpxPanelErrorBoundary` — a panel
that throws renders "Panel unavailable — reload the page to reconnect." in isolation rather than
white-screening the whole desk. A `vectorEnabled` prop gates an embedded Vector chart
(`SpxVectorEmbed`) inline on the dashboard — deliberately, per the in-code comment at
`SpxDashboard.tsx:44-49`: the standalone Trade Alerts / kanban panel and a second terminal were
REMOVED from this desk 2026-07-13 ("member-directed... one flagship desk, one source of truth") in
favor of the single embedded Vector chart; the removed components remain in the repo
(`SpxTradeAlerts.tsx`) rather than deleted, in case the call is reversed.

3-way panel focus state on compact/native layouts: `iosPanel: "vector" | "matrix" | "intel"`,
persisted to `sessionStorage["spx-ios-panel"]`.

**LIVE 2026-08-23** (`dashboard-desktop`, 1440×900):

```
PAGE /dashboard
└─ HEADER "SPX Slayer" wordmark + "SPX · 0DTE DESK"
   └─ inline stat strip   SPX 7,674.37 +0.00% | EMA 20/50/200 | SMA 50/200 | SESSION HOD/LOD | VIX 15.13 | VWAP — | GEX -$21.1B | TREND Bullish | Γ FLIP — | OI MAX PAIN ▼7,700.00 | IV RANK 9
└─ TAB group (panel)   Vector (active) | Matrix | Intel
└─ CONTENT — with "Vector" selected: the embedded Vector toolbar + chart (SPX · 3 MIN · INDICATORS 3 · Replay · GEX/VEX · 0DTE/WEEKLY/MONTHLY · EVENTS · NODES · AUG 21 CLOSE) plus candlestick+GEX-band+volume chart, right-aligned in the content area
```

**Real defect, screenshot-confirmed, severe:** with the "Vector" panel tab active, roughly the
**left half of the content area (~830px of 1440px wide, full height) renders completely blank** —
no panel, no loading state, no placeholder, just background. `SpxDashboard.tsx`'s `iosPanel:
"vector" | "matrix" | "intel"` state (§2) is documented in-code as a **compact/native-only**
concept, but this shot is desktop at 1440×900 and is clearly showing single-panel tabs (Vector /
Matrix / Intel) rather than the multi-panel grid the component composition (`SpxSniperHeader` →
`SpxGexMatrixHeatmap` → `SpxPinForecast` → `SpxPlayVerdictBar` → `SpxIntelRail`, all mounted
together) implies for a full desktop layout. Either the compact single-panel mode is incorrectly
engaging at a desktop viewport width, or the non-Vector panels (Matrix/Intel) are meant to render
beside the chart and are not. This is the single most visually severe issue found in this pass —
**candidate P0** — **reproduced on an independent retry** (fresh session mint, same viewport,
~10 minutes later: identical blank left half, identical proportions). Not a one-off timing
artifact. Still needs a click-through on Matrix/Intel tabs and a real-browser confirmation before a
fix PR (this pass only exercised the default Vector tab), but the blank-on-load state itself is now
confirmed, not provisional.

**Second, smaller defect, likely shared with §5's Vector-mobile finding:** the chart footer legend
at the bottom overlaps its own x-axis time labels — "ODTE · RECONSTRUCTED" text sits on top of the
"18:00"/"20:00" axis ticks. Same class of bug as the Vector-mobile footer overlap (§5); since this
is the SAME embedded `SpxVectorEmbed`/`VectorChart.tsx` component on both surfaces, this is likely
**one root cause in the shared chart component**, not two separate bugs — worth fixing once at the
component level rather than twice per surface (brief item 14).

**LIVE 2026-08-23** (`dashboard-mobile`, 430×932) — same header stat cards, stacked; Vector/Matrix/
Intel tabs render as a full-width 3-way segmented control (not the desktop's asymmetric bar). Below
it, the content panel is centered text **"Loading Vector chart…"** that never resolved inside the
9s wait — a full-width, correctly-labeled loading state, not a blank. This is useful corroborating
context for the desktop P0 above: mobile's panel is honest about still loading and reserves the
FULL width for the eventual chart, while desktop's identical panel finished loading but only into
the right ~55% — supporting "the left column is unfilled reserved space" over "the chart is
deliberately narrow" as the likely root cause. Still needs the live click-through before a fix PR.

---

## 3. Helix — `/flows`

**Coordinates:** `src/app/(site)/flows/page.tsx` (`requireTier("premium")`, no per-tool gate) →
`HelixPageShell` → `FlowFeed` (`src/features/helix/components/FlowFeed.tsx`, 1224 lines — the
largest single component on the platform). 24 component files. Full pipeline/timestamp/data-model
detail already lives in `docs/audit/HELIX-MAP.md` (Helix lane's own Phase-0 map) — this section
only covers what's relevant to cross-product UX; defer to that file for data correctness.

**LIVE 2026-08-23** (`flows-desktop`, 1440×900):

```
PAGE /flows
└─ SECTION filter bar
   ├─ FLOOR chips        $200K · $500K · $1M · $20M  (radio-style, one active)
   ├─ SIDE chips         ALL 500 · CALL 253 · PUT 247
   ├─ SYMBOL search       "SPX" (free text)
   ├─ QUICK filter chips  WHALES · 0DTE · INDICES · WATCH
   ├─ DTE chips           ALL DTE · 0DTE · ≤7D · >7D
   └─ STATUS badge        "● STALE  500 · 45h ago"  (correct — weekend, market closed)
   TOOLBAR                HIDE ANALYTICS toggle · TOOLS
   ├─ PANEL flow tape (left, ~2/3 width)
   │  └─ CARD × N          ticker+side+STACK/WHALE badges, strike/expiry/DTE, $ premium, Δ%+age
   └─ PANEL analytics rail (right, ~1/3 width)
      ├─ tab-like header  ALL FLOW · "MORE PANELS" button
      └─ CARD "TOP PRINTS" list — Δ, ticker, strike/exp, $ premium, "No hits in last 15 min" / At bid|ask / %sold|bought
```

STACK and WHALE are visually distinct badge chips on each row (STACK = repeated-print marker,
WHALE = size marker) — this is the tape's own visual vocabulary for "what makes this print
notable," worth reusing as a pattern name if the design system formalizes badge semantics
platform-wide (brief item 14, "different meanings for identical colors").

**LIVE 2026-08-23** (`flows-mobile`, 430×932):

```
PAGE /flows (mobile)
└─ HEADER  Helix wordmark + BULLISH badge + bidirectional $ bar (calls sold vs puts sold) — this row overflows the viewport horizontally, see below
└─ PANEL "Filters" collapsed bar + STATUS "500 · 46h ago"
└─ LIST CARD × N — ticker+side+STACK/WHALE badges, strike/exp/DTE, $ premium, Δ%+age (same fields as desktop's tape cards, one per row, full width)
```

`HelixMobileFlowTape.tsx` (303 lines) is confirmed a dedicated mobile component, not a responsive
collapse of the desktop table — the card layout is visually distinct from `HelixFlowTable.tsx`,
though the fields shown (badges, strike/expiry/DTE, premium, Δ%+age) match 1:1 with what desktop's
tape cards show, so no field drift found this pass.

**Real defect, screenshot-confirmed:** the header's bidirectional flow-split bar **overflows the
viewport horizontally** — its trailing edge (a bar segment plus what looks like the start of a
"TODAY" label, clipped to a bare "T") runs off the right side of the 430px frame instead of
wrapping or shrinking to fit. In the same row, the two stat strings run together with **no
separating space**: `"$17M calls sold$130M puts sold"` reads as one unbroken run of text. Both are
in the same header component — candidate **P1** (visible on every mobile Helix load, first thing
under the wordmark, and a horizontal-overflow bug is exactly the class `_COMMON.md`'s own
interaction-testing guidance calls out by name).

---

## 4. Thermal — `/heatmap`

**Coordinates:** `src/app/(site)/heatmap/page.tsx` (`requireDeskTool`) → `ThermalPageShell`
(35 lines) → `Heatmap` → `GexHeatmap.tsx` (4530 lines — by far the largest single file in the
product, larger than the next 3 Thermal components combined). 11 component files total, `dp*Rail`/
`Matrix`/`Strip` composition, e.g. `ThermalTripleDesk` (537), `ThermalCompactMatrix` (396),
`ThermalCompareStrip` (213), `ThermalGridSectorPicker` (169), `ThermalRegimeStrip` (159),
`ThermalFreshnessBar` (91), `ThermalIntensityRail` (70).

**LIVE 2026-08-23** (`heatmap-desktop`, 1440×900):

```
PAGE /heatmap
└─ PANEL command bar
   ├─ SEARCH ticker dropdown       "SPY ▾  765.72  +0.41%"
   ├─ TAB group (view)             MATRIX (active) · GAMMA PROFILE + CURVE + SHIFT · FORCED FLOW (DEPTH)
   ├─ STATUS "as of 2:06:11 PM ET"
   ├─ TOGGLE GRID | PNG
   └─ BADGE "MARKET CLOSED"        (correct — weekend)
   TAB group (metric)              GEX (active) · VEX · DEX · CHARM
└─ PANEL "THERMAL STATE" summary card
   ├─ regime dot + label            ● SHORT GAMMA
   ├─ inline stat row                NET GEX -$778.7M ↑$397.3M · MAGNET 765 · FLIP 767 · CALL WALL 772 · PUT WALL 765 · MAX PAIN 768 · VOL EXPANDED
   ├─ CARD cross-product strip       "FLOW TODAY [HELIX] +$403.8K" — mini bidirectional bar (C $1.2M green / P $749.6K red)
   └─ 2-line plain-English narrative  "Dealers are amplifying moves below 767. 765 is the dominant pin..."
└─ FILTER expiry chip row (horizontal scroll)  ALL · 0DTE · NEAR · MONTHLY (active=AUG 24) · [15 more dated chips through JAN 15]
└─ BAR key-levels strip             "SPY · GEX  Shift  C 770 +0% 768 -0% | P 771 -0% 759 -0% 765 +0% 766 +0%"
└─ TABLE strike ladder               STRIKE | AUG 24 | NET FLOW columns, one row per strike, $ flow annotations on non-zero rows
```

**LIVE 2026-08-23** (`heatmap-mobile`, 430×932) — **first shot hit a full-page client error
boundary** ("SOMETHING WENT WRONG / We couldn't load this page" — `ErrorBoundary`/`error.tsx`-style
screen with TRY AGAIN / GO HOME). **Retried immediately with a fresh session mint and it rendered
cleanly** (same Matrix/GEX view, stacked single-column layout, all the same data as desktop).
Per the methodology note in §0, this reads as a minted-session timing artifact (60s JWT racing a
heavier hydration path on mobile), not a reproducible product defect — **not filed as a finding**,
but flagged for anyone re-running this: mobile Thermal is worth a second live confirmation with a
longer-lived member session before ruling it out completely.

**One real cross-viewport difference worth chasing, not yet confirmed as a defect:** the retried
mobile shot's cross-product strip renders `[HELIX] FLOW UNAVAILABLE` where the desktop shot (same
day, same closed-market data) renders a populated `+$403.8K` bar with a call/put split. Both are
reading the same underlying Helix-flow-today figure for a closed market, so a genuine
desktop/mobile divergence in whether that fetch resolves would be a real defect — but this was
observed on ONE retried mobile shot against ONE clean desktop shot, not a controlled A/B, so it is
recorded as an **OPEN QUESTION**, not a finding, pending a same-session comparison.

---

## 5. Vector — `/vector`

**Coordinates:** `src/app/(site)/vector/page.tsx` (`requireDeskTool`, reads `searchParams.ticker`/
`.compare`) → `VectorPageClient` → `VectorPageShell.tsx` (936 lines). 32 component files — largest
product by component count. `VectorChart.tsx` is 4978 lines, the single largest file on the
platform. Also embeds into `/dashboard` via `SpxVectorEmbed`.

**LIVE 2026-08-23** (`vector-desktop`, 1440×900):

```
PAGE /vector
└─ TOOLBAR
   ├─ SEARCH ticker              "SPX" input
   ├─ BUTTON COMPARE · FULL SCREEN
   ├─ DROPDOWN timeframe          "3 MIN ▾"
   ├─ BUTTON INDICATORS (badge count "3") · TOOLS
   ├─ CONTROL ▶ Replay
   ├─ TAB group (metric)          GEX (active) · VEX
   ├─ TAB group (expiry)          0DTE (active) · WEEKLY · MONTHLY · EVENTS
   ├─ DROPDOWN NODES               "AUTO 11 ▾"
   └─ STATUS chip                  "● AUG 21 CLOSE"
   sub-toolbar: INTRADAY (active) · 4H · 1D · 1W
└─ PANEL "0DTE MATRIX" (left rail)
   ├─ spot price + timestamp       "7,674.4  2:09:52 PM ET"
   ├─ TAB GEX (active) | VEX
   └─ TABLE STRIKE | GEX | Δ% — color-coded rows (green=positive/call-side, red=negative/put-side), current-price row highlighted teal, one strike tagged 🏆 (max-pain-style marker)
└─ CHART main candlestick panel
   ├─ price candles + dashed current-price line (7674.37, highlighted)
   ├─ overlaid GEX heat bands (horizontal, magenta/purple intensity = wall strength, per strike level)
   └─ scatter markers (circles/diamonds sized by size, gold vs purple = presumably call/put or aggressor)
└─ PANEL "LIVE HELIX" (right rail)
   ├─ header + STATUS "● STALE"
   ├─ "SPX LIVE TAPE" heading + "Session closed · full history on Helix desk" + "Full Helix tape →" link
   ├─ TAB ALL (active) · CALL · PUT
   └─ EMPTY state "Session closed — Live Helix resumes at the open"
```

Vector is the most information-dense screen shot this pass — a full 0DTE GEX matrix table, a
candlestick+heatband+scatter composite chart, AND a live cross-product Helix tape rail
simultaneously on one 1440px screen. Directly relevant to brief item 9 ("trading-desk density")
as the platform's current density ceiling/reference point, and to item 6 (visualization) as the
one screen already doing heatmap-band-on-candlestick overlay — worth studying before proposing new
chart idioms elsewhere, since this pattern is proven in production, not proposed.

**LIVE 2026-08-23** (`vector-mobile`, 430×932):

```
PAGE /vector (mobile)
└─ HEADER  Vector wordmark · ☰ menu · "Open desk →"
└─ TAB group (range)   INTRADAY (active) · 4H · 1D · 1W
└─ CHART (full-bleed, ~85% of viewport height) — same candlestick + GEX heat-band + scatter-marker composite as desktop
└─ BAR volume histogram (bottom)
└─ FOOTER legend row     "SPY VOL  16:30  ◇ 0DTE · RECONSTRUCTED · SPOT-ALIGNED"
```

**Real defect, screenshot-confirmed:** the footer legend row has two labels overlapping at the same
position — "16:30" is drawn on top of "08:30", and "RECONSTRUCTED" is drawn on top of
"SPOT-ALIGNED" (both pairs legible only as garbled overlapping glyphs in the capture). This is the
exact "labels overlap into garbage" defect class `meridian-interaction-audit.mjs`'s own rationale
describes — two footer elements sharing one position instead of being laid out sequentially.
Candidate **P1** (visibly broken, low-traffic footer text but on every mobile Vector load) —
needs a fix PR with a live re-check before/after, not just this screenshot, per rule 6.

**Also notable — mobile drops far more than a responsive reflow of desktop:** no ticker search, no
COMPARE/FULL SCREEN/INDICATORS/TOOLS buttons, no GEX/VEX metric toggle, no 0DTE/WEEKLY/MONTHLY/
EVENTS expiry tabs, no 0DTE MATRIX table, and no LIVE HELIX rail — mobile Vector is chart-only.
Some of this is a reasonable mobile simplification; whether the metric/expiry toggles specifically
should survive on mobile (they're compact chip rows, not dense tables) is a candidate **P2** worth
raising with Vector's owning lane rather than deciding unilaterally (boundary rule).

---

## 6. Meridian — `/meridian`

**Coordinates:** `src/app/(site)/meridian/page.tsx` (`requireDeskTool`) → `MeridianPageShell` →
`MeridianDesk.tsx` (704 lines). 18 component files: `meridian-viz.tsx` (1024, largest — the shared
visualization primitives file), `MeridianEarningsTabs.tsx` (538, tabs = `"summary" | "report" |
"estimates" | "positioning" | "history"`), `MeridianEarningsAnalytics.tsx` (509),
`MeridianEarningsReportPanel.tsx` (380), `MeridianEventDetailPanel.tsx` (370),
`meridian-spatial.tsx` (345), `meridian-ui.tsx` (301). `scripts/audit/meridian-interaction-audit.mjs`
and `scripts/audit/meridian-earnings-ui-audit.mjs` are existing live-interaction harnesses for this
product — reuse rather than re-invent for the next pass's click-through testing.

**LIVE 2026-08-23** (`meridian-desktop`, 1440×900):

```
PAGE /meridian
└─ HEADER "CATALYST STRUCTURE DESK" — Meridian wordmark + "EVENT ANALYTICS" + tagline + STATUS "● LIVE STRUCTURE" + icon button
└─ TAB group (view)     TIMELINE (active, gradient pill) | ANALYTICS GRID | REFRESH button
└─ PANEL "Catalyst lane" (left)
   ├─ SEARCH "Search ticker or name…"
   ├─ FILTER chips        ALL (active) · MACRO · EARNINGS · IMP ≥4 · FDA · OPEX · WATCHLIST · BOARD
   └─ LOADING skeleton     4 shimmering placeholder rows — list never resolved within the shot window
└─ PANEL detail (right)
   └─ EMPTY/LOADING state  spinner + "Select a catalyst to open the structure brief."
```

**The catalyst list did not finish loading in this shot** — the harness log recorded
`FAIL [GET] /api/market/meridian/timeline?days=21: timeout` (the tunnel's own 20s fetch timeout,
not necessarily the real API). **Resolved by the mobile shot taken ~1 minute later (below), which
loaded the same data cleanly** — treated as a one-off tunnel/session timing artifact, not a
Meridian defect. Not filed as a finding.

**LIVE 2026-08-23** (`meridian-mobile`, 430×932):

```
PAGE /meridian (mobile)
└─ HEADER  same CATALYST STRUCTURE DESK card as desktop, + "As of 02:10 PM ET" timestamp
└─ PANEL KPI stat tile grid (2-column)   196 CATALYSTS · 194 EARNINGS · 65 MEGA-CAP ER · 6 NEXT 24H · 0 BOARD NAMES
   (not visible on the desktop shot — that shot's panel hadn't resolved past the loading skeleton)
└─ TAB group (view)     TIMELINE (active) | ANALYTICS GRID | REFRESH
└─ PANEL "Catalyst lane"
   ├─ SEARCH "Search ticker or name…"
   ├─ FILTER chips (2-row wrap)   ALL 196 (active) · MACRO 2 · EARNINGS 194 · IMP ≥4 65 · FDA 0 · OPEX 0 · WATCHLIST · BOARD 0
   ├─ NOTICE strip   "166 prints hidden — no listed options"  — an honest absence disclosure (brief item 4/`_COMMON.md` rule 7 pattern done right: it says what was filtered out and why, not a silently shorter list)
   └─ LIST grouped by month header ("2026-08"), CARD per catalyst: kind badge (EARNINGS) + importance (MED) + days-out (1d) + ticker+event name + date/time/confirmation status (e.g. "GRRR earnings — 2026-08-24 · 16:15 ET · confirmed")
```

---

## 7. Night Hawk — `/nighthawk`

**Coordinates:** `src/app/(site)/nighthawk/page.tsx` (`requireDeskTool`, reads
`searchParams.view` via `parseNightHawkView`) → `NighthawkPageShell` → `NightHawkFeed` (dynamic,
`ssr:false`, custom `NightHawkLoadingSkeleton` fallback) → `ZeroDteBoard.tsx` (1550 lines, largest
component in the product). 17 component files: `PlaybookBoard` (464), `BangerBoard` (320),
`PlaybookPlayRow` (218), `HawkRecordStrip` (186), `zerodte-board-strips.tsx` (173),
`PlayDetailModal` (166), `HorizonLaneBoard` (141). View model: `NightHawkView = "ZERO_DTE" |
"SWING" | "BANGER" | "LEGACY"` — the top-level tab set is these 4 engines, not sub-tabs of one
engine.

**LIVE 2026-08-23** (`nighthawk-desktop`, 1440×900):

```
PAGE /nighthawk
└─ HEADER "OVERNIGHT PLAYBOOK" kicker + "Night Hawk" wordmark + radar icon + STATUS pill "● NIGHT HAWK"
└─ TAB group (engine)   0DTE (active) | Swings | Bangers | Legacy
└─ subtitle copy         "Same-day trades across the whole market — hot flow, minutes-to-hours."
└─ PANEL board (left)
   ├─ HEADER strip        "0DTE · SAME-DAY  OPPS 0  TOP —  EDGE —"  ·  ENGINE Standby ✓  ·  UPDATED 13 sec ago  ·  chip "SPX SLAYER  IDLE"  ·  RISK —  ·  P&L —
   ├─ FILTER tabs          ALL 0 (active) · OPEN 0 · WATCH 0 · CLOSED 0
   └─ EMPTY state           "No session today — Night Hawk's evening playbook covers the next open." (correct — Sunday)
└─ PANEL detail (right)
   └─ EMPTY state           "◂ select a play to break it down"
```

Clean, correctly-labeled empty state for a weekend/no-session day — good reference pattern for
brief item 4 (progressive disclosure: the header strip states OPPS/TOP/EDGE/ENGINE/RISK/P&L as
"—" rather than hiding the fields or showing 0 where 0 would be misleading). `UPDATED 13 sec ago`
confirms the engine polling loop is live even with nothing to show, which is itself useful
information the UI is correctly surfacing.

**LIVE 2026-08-23** (`nighthawk-mobile`, 430×932) — same structure as desktop, stacked
single-column. Two things worth recording:

- **Header stat strip truncates rather than wraps:** desktop reads "UPDATED 13 sec ago" in full;
  the identical strip on mobile is clipped to "UPDATED 12" with "sec ago" cut off at the container
  edge — an overflow bug, not a redesign, on the `OPPS/TOP/EDGE/ENGINE/UPDATED` info strip
  (`zerodte-board-strips.tsx`, 173 lines). Candidate **P1** (small fix, high-visibility position —
  first thing on the page).
- **~45% of the mobile viewport is blank below the empty-state card** on a no-session day. Not a
  bug — the layout simply doesn't have content to fill it — but a candidate **P2/P3** per brief
  item 9's "do not solve density problems with whitespace" read backwards: an empty state that
  could show something (recent closed plays, a teaser for the other 3 engine tabs, next-session
  countdown) instead of the page just stopping.

---

## 8. Largo — `/terminal`

**Coordinates:** `src/app/(site)/terminal/page.tsx` (`requireDeskTool`) → `LargoPageShell.tsx` —
full-viewport chat UI, distinct shell shape from the other 6 desk products (no `PageShell` grid,
just a `main` wrapping `LargoTerminal` or `LargoNativeTerminal`, plus `useFullscreen` support
scoped to the whole terminal surface). 24 component files: `LargoTerminal.tsx` (658),
`LargoMessageBody.tsx` (385), `LargoNativeTerminal.tsx` (328), `LargoTerminalToolbar.tsx` (226,
conversation history menu, historical-mode toggle, new-conversation, regenerate-last-answer,
fullscreen toggle), `LargoAnswerMessage.tsx` (199), `LargoDeskModulePicker.tsx` (186),
`LargoSlashPromptsMenu.tsx` (165), `LargoShareRow.tsx` (155).

**Notable in-code decision, worth preserving:** `LargoPageShell.tsx`'s header comment states the
status-badge slot was deliberately left empty — it used to hardcode a green "AI Online" dot with no
actual health check behind it ("would have kept rendering it with the Anthropic key removed
entirely"). A fabricated-liveness badge is exactly the class of defect `_COMMON.md` rule 7
("Absence is a finding, not a blank") warns about, and this is a case where the product side
already caught and fixed it — a pattern to hold other status badges platform-wide to (brief item 14,
consistent status semantics).

**LIVE 2026-08-23** (`terminal-desktop`, 1440×900):

```
PAGE /terminal
└─ HEADER "AI DESK ANALYST" kicker + Largo wordmark/mark + "Live desk intel · grounded in platform data"
└─ STATUS bar   ● LIVE | CLOSED | DATA 2S AGO   ⋯   ● HELIX ● THERMAL ● VECTOR ● NIGHT HAWK ● SLAYER ● 0DTE  "5/6 ONLINE"  ·  "92 ACTIVE SIGNALS"
└─ TOOLBAR      "LARGO TERMINAL · GROUNDED IN LIVE PLATFORM DATA"  ·  HISTORY · CONCRETE|DEEP DIVE toggle · HISTORICAL · NEW · REGENERATE · fullscreen
└─ CONTENT (empty-conversation state)
   ├─ prompt copy   "Pick a desk (optional: a module lens), type your question, send — or use /spx-slayer /gex in the composer."
   └─ GRID "PICK A DESK" — one CARD per product (SPX SLAYER · HELIX · BLACKOUT THERMAL · VECTOR · NIGHT HAWK · MERIDIAN, 7th presumably below the fold), each with a one-line description + module count ("14 MODULES · TYPE AFTER PICK")
└─ FOOTER "92 active signals" pill (repeats the header stat) + COMPOSER (image-attach, mic, text input placeholder "Type / For Desk Commands — SPX, Flow, Thermal, Vector…", SEND) + disclaimer "Educational. Not advice. You decide."
```

**Worth citing as a positive pattern, not a defect:** Largo's status bar (`● HELIX ● THERMAL ●
VECTOR ● NIGHT HAWK ● SLAYER ● 0DTE  5/6 ONLINE`) is the one place on the platform that already
shows a live per-subsystem health readout in one glance. That is exactly the kind of shared,
legible status vocabulary §10.2 below is asking every product to converge toward — this is
evidence a good version of it already exists in the codebase, not a green-field design problem.
The "5/6 ONLINE" (one of six dots implicitly down) wasn't decoded from this shot alone — worth a
follow-up to identify which subsystem and whether that's correct for a closed-market Sunday.

**LIVE 2026-08-23** (`terminal-mobile`, 430×932) — same status bar and desk-picker cards, stacked
full-width. Two small mobile-only truncations: the toolbar's "LARGO TERMINAL · GROUNDED IN LIVE
PLATFORM DATA" label collapses to a bare **"L…"** (all context lost, not just shortened), and the
composer placeholder "Type / For Desk Commands — SPX, Flow, Thermal, Vector…" overflows past the
input's visible edge instead of truncating with an ellipsis inside the box. Both candidate **P3**
(cosmetic, non-blocking, but avoidable truncation-to-nothing on the toolbar label specifically is
worth a one-line fix — a label that becomes zero-information is worse than omitting it).

---

## 9. Public site — coordinates only this pass

`/` (`RedesignHome` via `MarketingPageShell`, live GEX-wall hero canvas + `MARKETING_PRODUCTS`
module grid + one-price membership block, `revalidate: 3600`), `/pricing`, `/upgrade`, `/faq`,
`/learn` + `/learn/[slug]`, `/about`, `/vs/others`, `/why-blackout`, `/track-record` (+
`/embed/track-record`), `/account`, `/contact`, `/sign-in`, `/sign-up`, legal pages
(`/terms`, `/privacy`, `/disclaimer`, `/cookie-policy`, `/refund-policy`). Shared footer:
`StaticLandingFooter.tsx`.

**LIVE 2026-08-23** (`home-desktop`, 1440×900) — above-the-fold hero: BLACKOUT wordmark nav (no
Features/FAQ/Learn on this exact fold — those appear once scrolled/on other pages per §1) +
animated cracked-glass "B" mark with a lightning/particle field + large headline mid-reveal
("TRADE LIKE" — the rest of the line, presumably "…THE DESK" or similar, is either still animating
in or below the fold at the 9s capture point; not a defect, just an animation-timing artifact of a
single-frame screenshot). Confirms `RedesignHome`'s "lights on" canvas hero is live in production
as documented in the page's own source comment. Full scroll-depth inventory (module grid,
membership block, footer) not yet captured — fold in on next pass.

**LIVE 2026-08-23** (`pricing-desktop`, 1440×900) — for our signed-in test account, `/pricing`
does not render plan tiers at all: it shows "HOME / PRICING" breadcrumb, a centered **"MEMBERSHIP
— Your membership is managed on the web. Once active, sign in here to access the full desk."**
message, then the full site footer (DESK / LEGAL / COMMUNITY link columns, risk disclosure,
copyright). This reads as deliberate signed-in-member routing (don't show pricing tiers to someone
who already has an account) rather than a defect — consistent with `/account` (below) showing a
real "Free" plan + "Upgrade" CTA as the actual upgrade path for a signed-in member. Not confirmed
against an anonymous visit this pass.

**LIVE 2026-08-23** (`account-desktop`, 1440×900):

```
PAGE /account
└─ HEADER "Account Settings" + subheading "PROFILE · SECURITY · CONNECTED DEVICES" (reads as a
   section index, not confirmed as functional in-page anchors/tabs this pass)
└─ CARD "Membership & Billing"  →  CURRENT PLAN "Free" + "Upgrade" link
└─ CARD "Personal Play Alerts" (DISCORD WEBHOOK · NIGHT HAWK PLAYS)
   ├─ explainer copy — "Your webhook stays server-side — we only show a redacted host here."
   ├─ INPUT "Discord webhook URL" (placeholder `https://discord.com/api/webhooks/…`)
   └─ BUTTON "SAVE WEBHOOK"
```

Confirms our minted test account is genuinely tier `Free` with `role:admin` — the admin role
bypasses tool gates (per CLAUDE.md's auth model) without upgrading the billing tier itself, which
is why every desk screenshot in this pass rendered full data despite this page showing "Free."

**LIVE 2026-08-23** (`upgrade-desktop`, 1440×900) — "PREMIUM ACCESS" kicker + headline "Unlock the
full floor." + subcopy, then the same "Your membership is managed on the web…" card as `/pricing`
plus an "OPEN SPX DESK" button and "← Back to home" link, then the standard footer. Same
signed-in-member routing pattern as `/pricing` — consistent copy/behavior between the two upgrade
entry points, no drift found.

`home-mobile` scroll-depth beyond the hero fold not yet reviewed — fold in on next edit.

---

## 10. Candidate findings — summary table

Every row below is a screenshot-backed observation from this pass, cross-referenced to its full
writeup. **None of these are filed to `docs/audit/findings-staging/` yet** — per the standing
issue-handling policy a finding is staged in the same PR as its code fix, and this PR is the Phase 0
inventory, not a fix. This table is the punch list the next PRs work from.

| # | Surface | Summary | Severity | Section | Confidence |
|---|---|---|---|---|---|
| 1 | `/dashboard` desktop+mobile | Vector panel tab leaves ~45% of the content width blank (desktop) / stuck on "Loading Vector chart…" (mobile) | **P0** | §2 | Reproduced on independent retry |
| 2 | `/flows` mobile | Header flow-split bar overflows viewport horizontally; two stat strings concatenate with no separating space | **P1** | §3 | Single shot |
| 3 | `/vector` mobile + `/dashboard` desktop | Chart footer legend text overlaps itself ("16:30" on "08:30", "RECONSTRUCTED" on "SPOT-ALIGNED") — likely one root cause in the shared `VectorChart.tsx`/`SpxVectorEmbed` component, hit twice | **P1** | §5, §2 | Single shot each, same defect shape on 2 surfaces |
| 4 | `/nighthawk` mobile | Header stat strip truncates ("UPDATED 12" cuts off "sec ago") instead of wrapping | **P1** | §7 | Single shot |
| 5 | `/terminal` mobile | Toolbar label collapses to bare "L…"; composer placeholder overflows its input box | **P3** | §8 | Single shot |
| 6 | `/nighthawk` mobile | ~45% of viewport left blank below the no-session empty state | **P2/P3** | §7 | Single shot |
| 7 | `/vector` mobile | Drops ticker search, metric/expiry toggles, matrix table, and live tape entirely (chart-only) — scope call, not necessarily a bug | **P2** (needs Vector-lane input) | §5 | Single shot |

Cross-product patterns, not yet P0–P3 classified pending more coverage:

1. **One nav for marketing + every desk (§1)** — by far the biggest structural fact this pass
   surfaced. Any navigation redesign work starts here, not per-product.
2. **STATUS/freshness badge vocabulary already has 4+ visual forms** across the shots so far:
   Helix's "● STALE  500 · 45h ago", Thermal's "MARKET CLOSED" pill + "as of HH:MM:SS ET" text,
   Vector's "● STALE" + "● AUG 21 CLOSE", Meridian's "● LIVE STRUCTURE", Largo's per-subsystem
   "5/6 ONLINE" dot row (§8 — the one existing example worth converging the others toward).
   Candidate for a single shared freshness-badge component — needs the live-market pass first to
   see the "fresh" states too, not just closed-market ones.
3. **Badge/tag vocabulary (STACK, WHALE on Helix; call/put color coding on Vector and Thermal)**
   is per-product so far in what's been shot — worth a dedicated color/semantics audit once more
   surfaces are captured (brief item 14's "conflicting bullish/bearish semantics" is exactly this
   class of question, and it needs same-session desktop+mobile+all-7-products evidence before
   drawing a conclusion).
4. **Density ceiling reference:** Vector desktop (§5) is the most information-dense single screen
   shot so far — matrix table + composite chart + live cross-product rail on one 1440px viewport
   with no panel feeling like it needed to be cut. Worth using as the density baseline other
   products are compared against, rather than inventing a new density target from scratch.
5. **Chart footer legend overlap (finding #3 above) is the clearest evidence yet found that a bug
   in a SHARED component (`VectorChart.tsx`, 4978 lines, embedded on both `/vector` and
   `/dashboard`) manifests on every surface that embeds it** — exactly the "fix once at the system
   level" case brief item 14 asks for, and a concrete first candidate for that discipline.

---

## 11. Gaps in this pass — the honest list

Per the file's own opening rule (an honest gap is a finding, a plausible guess is a lie that
outlives whoever wrote it):

- **Shot but not yet visually reviewed:** `upgrade-desktop`; `home-mobile` beyond the hero fold.
- **No interaction testing yet** — every shot in this pass is a default-state screenshot, which
  brief item 2 and `_COMMON.md` rule 6b are explicit is "a photograph of the feature having not
  been touched," not a test of it. Tabs, filters, search, sort, drawers/modals, chart zoom/pan, and
  ticker switching are all unexercised — in particular, finding #1 (§2, the P0) still needs an
  actual click on the Matrix/Intel tabs before a fix PR, not just the default Vector tab. Queued for
  the next LIVE VALIDATION window against a moving tape, where most of this class of defect is
  actually observable (§0).
- **No admin surfaces** (`/admin*`) — explicitly noted as lower priority in the charter, not
  covered this pass.
- **One OPEN QUESTION remains unresolved:** mobile Thermal's Helix-flow-strip divergence (§4) —
  desktop showed a populated flow bar, one retried mobile shot showed "FLOW UNAVAILABLE." Meridian's
  equivalent open question (§6) was resolved this same pass (mobile shot loaded cleanly ~1 minute
  after the desktop timeout) — Thermal's has not yet had that same second look.
- **`docs/audit/UI-UX-OPPORTUNITIES.md`** stubbed in this PR per brief item 16 but not yet
  populated with real backlog items beyond what's in §10's table.

Next edit of this file should close these gaps rather than starting a second document.
