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

**⚠️ THIRD METHODOLOGY NOTE — CORRECTION, added 2026-08-23 same day: every desktop shot in the
original pass used the WRONG user agent, and one finding built on it was FALSE. `proxy-browser.cjs`
defaults to a fixed iPhone UA (`BlackOutiOSApp/1.0`) regardless of `--viewport` — its own doc
comment says so explicitly ("note the UA stays mobile, so a UA-gated shell will still render its
mobile variant"), and every `*-desktop` shot in the original pass was taken with `--viewport
1440x900` but WITHOUT the required `--desktop` flag. Several BLACKOUT components read the UA
(`useIosNativeShell()`) to switch into a compact/native single-panel layout — so every "desktop"
shot in this file's first version was actually showing the MOBILE/COMPACT layout stretched into a
1440px frame, not the real desktop layout. This produced one confirmed false finding: §2's original
"P0" (SPX Slayer's Vector panel leaving ~45% of the desktop content blank) does not exist — it was
the compact single-panel-tab layout incorrectly engaging under the iPhone UA. **Re-shot with the
correct `--desktop` flag (real desktop UA, `deviceScaleFactor:1`, `isMobile:false`) same day; every
`§N` LIVE desktop entry below is now marked either `RE-VERIFIED 2026-08-23 (correct UA)` or, where
not yet re-shot, `UNVERIFIED — ORIGINAL SHOT USED WRONG UA, DO NOT TRUST` until it is.** The
original mobile shots are unaffected — mobile pages are supposed to render with a mobile UA, so
those entries stand as recorded. Lesson for the next pass: always pass `--desktop` alongside
`--viewport 1440x900` per `docs/audit/LIVE-UI-CONNECTION.md`'s own recipe, which shows the flag but
doesn't shout its necessity — this file now does.

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

## 1. Shared chrome — CORRECTED 2026-08-23: there are TWO nav components, not one

**This whole section originally claimed a single shared nav across the entire site. That claim was
WRONG**, and wrong for the same root cause as every other correction in this file (top-of-file
note): the original pass's screenshots all used the wrong UA, and `/`, `/pricing`, and `/upgrade`
happened to be exactly the pages where that mattered architecturally, not just cosmetically.

**Coordinates, corrected:** there are two distinct nav components. **`src/components/Nav.tsx`**
(550 lines, "Features ▾" dropdown + FAQ + Pricing + Learn + "Open desk →") is used on every
authenticated desk route (`/flows`, `/heatmap`, `/vector`, `/meridian`, `/nighthawk`, `/terminal`,
`/dashboard`) AND `/account`. **`src/components/landing/StaticMarketingNav.tsx`** (40 lines — flat
links "Platform" → `/#protocol`, "Products" → `/#modules`, "Free Tool" → `/tools/gamma-snapshot`,
"Learn", "FAQ", "Pricing", no dropdown) is used by `MarketingPageShell.tsx` on the `(marketing)`
route group: `/`, `/pricing`, `/upgrade`, and presumably the rest of that group (`/about`,
`/faq`, `/learn*`, `/vs/others`, `/why-blackout`, legal pages — not individually confirmed this
pass). `src/components/layout/DeskShell.tsx` (28 lines) wraps desk routes with a `--nav-offset`
top-padding var and does nothing else — desk pages do not add their own navigation rail,
breadcrumb, or product switcher beyond `Nav.tsx`.

**`RE-VERIFIED 2026-08-23 (correct UA)`** — confirmed `Nav.tsx` (logo · Features ▾ dropdown · FAQ ·
Pricing · Learn · "Open desk →") identical across `/flows`, `/heatmap`, `/vector`, `/meridian`,
`/nighthawk`, `/terminal`, `/account`. Confirmed `StaticMarketingNav.tsx` (BLACKOUT wordmark ·
Platform · Products · Free Tool · Learn · FAQ · Pricing · "Open desk →") identical across `/`,
`/pricing`, `/upgrade`. **The original entries for `/`, `/pricing`, `/upgrade` below are corrected
in place — see each one's own correction note** rather than re-deriving them from scratch, since
the underlying page CONTENT (pricing tiers, hero copy) was also affected, not just the nav.

### 1.1 The "Features" dropdown IS the cross-product switcher (desk pages only)

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

### 1.2b The SAME artifact also hits every CLIENT-SIDE tier display — corrected 2026-08-23

**Second methodology gap found the same day as the UA correction above, same underlying cause.**
§1.2 already identified that Clerk's client library never hydrates a real session for our minted
cookie. That fact is broader than the nav CTA — `useAppAuth()` (`src/lib/auth-client.tsx`) is the
ONE shared hook every client component uses for tier-gated UI, and it is built entirely on Clerk's
client SDK (`useAuth`/`useUser`), not on the server-rendered JWT our sessions actually carry. Since
that hook never hydrates for a minted session, `isLoaded` stays `false` and `tier` stays `null` for
the whole life of every screenshot in this pass — independent of, and not fixed by, the `--desktop`
UA correction above.

**Confirmed affected, this pass:** `src/components/account/AccountMembershipPanel.tsx`'s "CURRENT
PLAN" display (§2/§9's `/account` entries) reads `useAppAuth().tier` → `parseTier(null)` → always
**"Free"**, regardless of the real `{role:"admin", tier:"premium"}` our session actually carries in
`publicMetadata` and in the JWT server-rendered pages correctly read. `src/components/upgrade/
PlanLadder.tsx` (`/pricing`, `/upgrade`) uses the identical hook for its `hasCommunity`/`hasPremium`
gates, so the CTAs captured in this pass ("GET SPX ACCESS," "START MONTHLY →," "GO YEARLY," "UNLOCK
PREMIUM →") are the **not-yet-subscribed default state**, not necessarily what our synthetic
premium account would see with a fully-hydrated session (e.g. a "Manage subscription" state
instead). **The `/account` "Free" plan entries in §2 and §9 are corrected in place below** — they
previously asserted this was the account's real tier rather than flagging the hydration gap.

**One more thing this surfaced, NOT confirmed either way:** `ClerkAuthBridge` in `auth-client.tsx`
sets `tier = "admin"` (a literal string) for `role:admin` users, but `parseTier()`
(`src/lib/tiers.ts`) only recognizes `"premium"`/`"pro"`/`"elite"`/`"community"` — `"admin"` falls
through to `"free"`. **If a REAL admin member's browser fully hydrates a Clerk session** (unlike
our minted ones), `parseTier("admin")` would still resolve to `"free"` and their own account page
would show "Free" too. This cannot be confirmed or ruled out from this pass's tooling — it needs a
real signed-in admin browser session, not a minted one, to test. Recorded as an **OPEN QUESTION**,
not a finding, and specifically NOT filed to `findings-staging/` without that confirmation — an
unverified claim about real admin members' billing display is exactly the kind of thing that must
not be asserted as fact on a guess (per this file's own opening rule).

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

**`UNVERIFIED — ORIGINAL SHOT USED WRONG UA` (see the top-of-file correction) →
`RE-VERIFIED 2026-08-23 (correct UA)`** (`dashboard-desktop`, 1440×900, real desktop UA):

```
PAGE /dashboard
└─ HEADER "SPX Slayer" wordmark + "SPX · 0DTE DESK"
   └─ inline stat strip   SPX 7,674.37 +0.00% | EMA 20/50/200 | SMA 50/200 | SESSION HOD/LOD | VIX 15.13 | VWAP — | GEX -$21.1B | TREND Bullish | Γ FLIP — | OI MAX PAIN ▼7,700.00 | IV RANK 9
└─ TAB group (left rail)   PULSE (active) | LARGO
└─ 4-COLUMN GRID, all panels mounted simultaneously (this is the real desktop layout — NOT tabs):
   ├─ COL 1 "⚡ PULSE" — filter chips ALL/REGIME/WALLS/FLOW/MACRO/PLAYS, "Watching the tape — no events yet this session", "structure holding — no Tier-1 events yet this session"
   ├─ COL 2 "SPX · GEX MATRIX · NEAR-TERM — DEALER GAMMA MAP" — GEX/VEX toggle, Γ FLIP (COL)/NET GEX stats, "Loading gamma matrix…"
   ├─ COL 3 "EOD PIN FORECASTER" (SPX · 0DTE) — Analytic/Monte Carlo toggle, explainer copy ("No 0DTE expiry today… the desk reports nothing rather than projecting a close from a later expiry"), + "SPX PLAY — Slayer CLOSED — Session closed, play engine idle until next RTH" card
   └─ COL 4 — embedded Vector chart, "Loading Vector chart…" (still hydrating at the 9s capture point — a loading state, not blank/broken; same pattern as the mobile shot's honest "Loading Vector chart…" label)
```

**CORRECTION — the original "P0" (blank left half of the desktop content area) was FALSE, caused
by this pass's own methodology error (see the top-of-file note), not a product defect.** The
original desktop shot used `proxy-browser.cjs` WITHOUT `--desktop`, so it rendered with the fixed
iPhone UA even at a 1440×900 viewport, which engaged `useIosNativeShell()`'s compact single-panel
`iosPanel: "vector"|"matrix"|"intel"` tab layout — exactly the behavior the component's own code
comment says is compact/native-only. **The real desktop layout is a 4-column grid with all panels
(Pulse/Largo rail, Dealer Gamma Map, EOD Pin Forecaster, Vector chart) mounted simultaneously, no
tabs, no blank space.** This is corroborated by the SPX lane's own same-day
`docs/spx/SPX-SLAYER-CERTIFICATION.md` (PR #2776, merged the same day as the original version of
this file), which describes this exact 4-panel composition and reports **zero blank-panel
findings** — only 3 small CSS collision defects (Replay button overlapping the GEX tile, etc.,
already handed to/partly fixed by the Vector lane) at desktop 1440×900. **Retracted, not filed to
`findings-staging/`.** The `iosPanel` single-panel-tab layout itself is real and correctly
compact/native-scoped — it just isn't what desktop 1440×900 shows with the right UA, and this
pass's tooling was the bug, not the product.

**One genuine observation surviving the correction:** the Vector chart column was still showing
"Loading Vector chart…" at the 9s capture mark on desktop, same as the mobile shot recorded in the
original pass. Not filed as a finding — 9s may simply be short for this specific embed's cold load,
and the SPX certification doc's own §4.1/§4.2 found the Vector embed sound. Worth a longer `--wait`
on a future re-check if it recurs.

**LIVE 2026-08-23** (`dashboard-mobile`, 430×932) — same header stat cards, stacked; Vector/Matrix/
Intel tabs render as a full-width 3-way segmented control — correctly so on mobile, this shot used
the iPhone UA on purpose. Below it, the content panel is centered text **"Loading Vector chart…"**
that never resolved inside the 9s wait — a full-width, correctly-labeled loading state, not a
blank. Matches the corrected desktop shot above (§2's retraction note) showing the same "Loading
Vector chart…" state in its own column — consistent behavior across viewports, not a discrepancy.
No finding here.

---

## 3. Helix — `/flows`

**Coordinates:** `src/app/(site)/flows/page.tsx` (`requireTier("premium")`, no per-tool gate) →
`HelixPageShell` → `FlowFeed` (`src/features/helix/components/FlowFeed.tsx`, 1224 lines — the
largest single component on the platform). 24 component files. Full pipeline/timestamp/data-model
detail already lives in `docs/audit/HELIX-MAP.md` (Helix lane's own Phase-0 map) — this section
only covers what's relevant to cross-product UX; defer to that file for data correctness.

**LIVE 2026-08-23** (`flows-desktop`, 1440×900):

**Original version of this entry used the wrong UA (see top-of-file correction) — re-shot
2026-08-23 same day with `--desktop`. Corrected structure:**

```
PAGE /flows (RE-VERIFIED, correct desktop UA)
└─ HEADER  Helix wordmark + BULLISH badge + bidirectional $ bar ("$17M calls sold" / "$130M puts sold", properly spaced, no overflow — the concatenation/overflow bug in the mobile finding below does NOT reproduce on desktop) + "TIDE" label
└─ SECTION filter bar
   ├─ FLOOR chips        $200K · $500K · $1M · $20M  (radio-style, one active)
   ├─ SIDE chips         ALL 500 · CALL 253 · PUT 247
   ├─ SYMBOL search       "SPX" (free text)
   ├─ QUICK filter chips  WHALES · 0DTE · INDICES · WATCH
   ├─ DTE chips           ALL DTE · 0DTE · ≤7D · >7D
   └─ STATUS badge        "● STALE  500 · 46h ago"  (correct — weekend, market closed)
   TOOLBAR                HIDE ANALYTICS toggle · TOOLS
   ├─ TABLE flow tape (left, ~2/3 width) — a REAL TABLE, not cards: columns TIME ▼ · SYM · SIDE ·
   │  EXPIRY · STRIKE · PREM · FILL · DTE, color-coded by call(green)/put(red), one row per print
   └─ PANEL analytics rail (right, ~1/3 width)
      ├─ tab-like header  ALL FLOW · "MORE PANELS" button
      └─ CARD "TOP PRINTS" list — Δ, ticker, strike/exp, $ premium, "No hits in last 15 min" / At bid|ask / %sold|bought
```

**Correction:** the original entry described a card-based tape with STACK/WHALE badges on desktop —
that was the mobile `HelixMobileFlowTape` card layout (§ below) rendered under the wrong UA at a
1440px viewport, not the real desktop component. The real desktop tape is `HelixFlowTable.tsx`
(541 lines, cited in the coordinates above but not previously distinguished from the mobile
component in this section) — a genuine data table with a sortable TIME column, no STACK/WHALE
badge chips visible in this shot (badges may be a mobile-only affordance, or a column this table
expresses differently — not yet confirmed either way, flagged as an open question rather than
asserted).

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
viewport horizontally** — its trailing edge (the "Tide" label, clipped to a bare "T") runs off the
right side of the 430px frame instead of wrapping or shrinking to fit. In the same row, the two
stat strings run together with **no separating space**: `"$17M calls sold$130M puts sold"` reads as
one unbroken run of text. Both are in the same header component (`HelixTideBar.tsx`) — **P1**
(visible on every mobile Helix load, first thing under the wordmark).

**FIXED same day.** Root cause: the stats row used `justify-between` with no explicit gap and no
wrap — `justify-between` has nothing to distribute once the row is narrower than the two stats'
combined natural width (the row's neighbors in the header, a `shrink-0` brand block and `shrink-0`
"Tide" label, squeeze it down on mobile). Fix adds `flex-wrap` + `gap-x-2 gap-y-0.5`, so a squeezed
row wraps to two spaced lines instead of colliding with zero gap and bleeding into "Tide". Verified
with an isolated CSS repro reproducing the exact bug and confirming the fix (local dev data wasn't
populated, so the live component couldn't be screenshotted directly this pass — see the staged
finding for the full repro method). Finding staged:
`docs/audit/findings-staging/2026-08-23-helix-mobile-tide-bar-overflow.md`. Regression-guarded by
`src/features/helix/components/HelixTideBar.test.ts` (verified to fail pre-fix, pass post-fix).
Pending live validation before this is fully closed (rule 6).

---

## 4. Thermal — `/heatmap`

**Coordinates:** `src/app/(site)/heatmap/page.tsx` (`requireDeskTool`) → `ThermalPageShell`
(35 lines) → `Heatmap` → `GexHeatmap.tsx` (4530 lines — by far the largest single file in the
product, larger than the next 3 Thermal components combined). 11 component files total, `dp*Rail`/
`Matrix`/`Strip` composition, e.g. `ThermalTripleDesk` (537), `ThermalCompactMatrix` (396),
`ThermalCompareStrip` (213), `ThermalGridSectorPicker` (169), `ThermalRegimeStrip` (159),
`ThermalFreshnessBar` (91), `ThermalIntensityRail` (70).

**`RE-VERIFIED 2026-08-23 (correct UA)`** (`heatmap-desktop`, 1440×900) — layout/structure below is
unchanged from the original wrong-UA shot (Thermal's page structure is not `useIosNativeShell()`-
gated the way SPX Slayer's is, so the UA bug did not distort this section's structural claims) — the
ONE thing that changed on re-shoot is the cross-product Helix strip, corrected below the block:

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
   ├─ CARD cross-product strip       "[HELIX] FLOW UNAVAILABLE" (CORRECTED — see below; the original wrong-UA shot showed a populated "+$403.8K" bar here, which does not reproduce with the correct UA)
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

**OPEN QUESTION above — RESOLVED, and not the way originally framed.** The original desktop shot
(populated `+$403.8K` Helix flow bar with a call/put split) used the wrong UA (top-of-file
correction). Re-shot 2026-08-23 with the correct `--desktop` UA: **desktop ALSO shows `[HELIX]
FLOW UNAVAILABLE`** (see the corrected structure block above), identical to the mobile-retry shot.
So there is **no desktop/mobile divergence** — both real viewports agree. The actual open question
is now the reverse of what it was: why did the WRONG-UA "desktop" shot show populated data at all,
when the two CORRECT-UA shots (one mobile, one desktop) both show unavailable? Possibly the
compact/native code path the wrong UA accidentally engaged reads a different (possibly stale-cached
Friday) source for this strip than the real desktop path does — or it's simply a timing
coincidence across three separate short-lived sessions. Not chased further this pass; flagged as a
loose thread rather than asserted. **Genuinely new observation:** `[HELIX] FLOW UNAVAILABLE` on
BOTH correct-UA viewports for a weekend-closed market — worth confirming during the next LIVE
VALIDATION window whether this strip populates correctly once the market is open, since a
cross-product strip that's "unavailable" even off-hours (when Thermal's own data is happily
showing Friday's close) is a different, milder question than the one originally asked.

---

## 5. Vector — `/vector`

**Coordinates:** `src/app/(site)/vector/page.tsx` (`requireDeskTool`, reads `searchParams.ticker`/
`.compare`) → `VectorPageClient` → `VectorPageShell.tsx` (936 lines). 32 component files — largest
product by component count. `VectorChart.tsx` is 4978 lines, the single largest file on the
platform. Also embeds into `/dashboard` via `SpxVectorEmbed`.

**`RE-VERIFIED 2026-08-23 (correct UA)`** (`vector-desktop`, 1440×900) — structure below CONFIRMED
unchanged with the correct desktop UA (toolbar, 0DTE matrix, composite chart, LIVE HELIX rail all
present and laid out identically to the original shot). The chart's bottom volume/footer strip
(where the overlap finding in Finding #3 was recorded on mobile) is below the 900px fold in this
non-full-page capture, so this re-shoot can neither confirm nor deny the withdrawn desktop half of
that finding — still open, per §10's table.

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
not necessarily the real API). Originally treated as resolved by the mobile shot ~1 minute later,
which loaded cleanly. **Update: the desktop re-shoot taken specifically to fix the UA methodology
bug (same day, `RE-VERIFIED` marker below) hit the SAME timeout a second time** — 2 of 3 desktop
attempts now stall on this fetch within a 9s capture window, only the one mobile attempt succeeded.
Downgrading from "one-off artifact" to **OPEN QUESTION**: still plausibly this harness's own 9s
wait being short for a genuinely-slower-than-that desktop-only query, but a 2-for-3 stall rate is
too consistent to keep calling a fluke without a longer `--wait` re-check. Not filed as a finding
pending that re-check — a slow endpoint and a broken one need different fixes and this pass can't
yet tell which it is.

**`RE-VERIFIED 2026-08-23 (correct UA)`** — layout structure otherwise unchanged from the original
shot; the loading-skeleton state above is what this second desktop attempt also captured, so no
new structural detail to add beyond the timeout note.

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
└─ TAB group (engine)   "0DTESwingsBangersLegacy" — see defect below
└─ subtitle copy         "Same-day trades across the whole market — hot flow, minutes-to-hours."
└─ PANEL board (left)
   ├─ HEADER strip        "0DTE · SAME-DAY  OPPS 0  TOP —  EDGE —"  ·  ENGINE Standby ✓  ·  UPDATED 8 sec ago  ·  chip "SPX SLAYER  IDLE"  ·  RISK —  ·  P&L —
   ├─ FILTER tabs          ALL 0 (active) · OPEN 0 · WATCH 0 · CLOSED 0
   └─ EMPTY state           "No session today — Night Hawk's evening playbook covers the next open." (correct — Sunday)
└─ PANEL detail (right)
   └─ EMPTY state           "◂ select a play to break it down"
```

**`RE-VERIFIED 2026-08-23 (correct UA)` — and this re-shoot surfaced a NEW real defect the original
wrong-UA shot did not show.** The original entry described the engine tab row as four
visually-distinct pill buttons ("0DTE | Swings | Bangers | Legacy"), each in its own rounded box —
that was, ironically, the compact/mobile CSS applying styling that happens to look correct. **The
real desktop render has NO spacing or visual separation between the four tab labels at all** —
"0DTESwingsBangersLegacy" reads as one unbroken run of text with no button boundaries, no gaps, no
distinguishing "0DTE" (the active one) from the rest except by careful reading. This is a genuine
desktop-only regression, the opposite direction from every other correction in this pass (here the
WRONG UA accidentally looked fine and the RIGHT UA is broken) — candidate **P1** (primary
navigation for the product's 4 trading engines, unreadable as tabs on the platform's own reference
desktop viewport).

Otherwise a clean, correctly-labeled empty state for a weekend/no-session day — good reference
pattern for brief item 4 (progressive disclosure: the header strip states OPPS/TOP/EDGE/ENGINE/
RISK/P&L as "—" rather than hiding the fields or showing 0 where 0 would be misleading). "UPDATED
8 sec ago" confirms the engine polling loop is live even with nothing to show, which is itself
useful information the UI is correctly surfacing.

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

**`RE-VERIFIED 2026-08-23 (correct UA)`** (`terminal-desktop`, 1440×900) — structure and content
below CONFIRMED unchanged with the correct desktop UA:

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

**`RE-VERIFIED 2026-08-23 (correct UA)` — MAJOR CORRECTION** (`home-desktop`, 1440×900). The
original entry is wrong in two ways, not one: it described the nav as bare "BLACKOUT wordmark, no
Features/FAQ/Learn," attributing the missing links to scroll position — the real reason is `/`
uses the entirely different `StaticMarketingNav.tsx` (§1), whose real content ("Platform · Products
· Free Tool · Learn · FAQ · Pricing") was ALSO suppressed under the wrong UA. **The `isIosAppShell()`
detection (`src/lib/ios-app-shell.ts`) reads the exact same `BlackOutiOSApp` UA token
`proxy-browser.cjs` defaults to** — so every original shot wasn't just triggering a compact CSS
layout, it was telling the app "you are the real iOS native app," which per an App Store guideline
3.1.1 comment in the source hides purchase-flow links/language site-wide. With the correct UA the
nav shows in full. The hero itself (animated cracked-glass "B" mark, particle field, "TRADE LIKE"
headline mid-reveal at the 9s capture point) is unchanged — that part of the original entry stands.
Full scroll-depth inventory (module grid, membership block, footer) still not captured this pass.

**`RE-VERIFIED 2026-08-23 (correct UA)` — the original `/pricing` entry was ENTIRELY WRONG, same
root cause.** The original said `/pricing` shows a "Your membership is managed on the web…"
redirect message instead of pricing tiers, and attributed it to deliberate signed-in-member
routing. **That is not what happens.** With the correct UA, `/pricing` renders the REAL pricing
page in full: "ONE DESK. YOUR PRICE." headline, three tier cards (**SPX Slayer $49/mo**; **Premium
Monthly $199/mo**, marked "FULL DESK"; **Premium Yearly $1,999/yr ≈$167/mo, "BEST VALUE — SAVE
$389"**), each with a feature checklist and its own CTA ("GET SPX ACCESS" / "START MONTHLY →" /
"GO YEARLY"), then the standard footer. **The "managed on the web" message the original entry
described is the copy `isIosAppShell()` swaps in specifically to satisfy App Store guideline
3.1.1** (no in-app purchase links) — it is what a member sees inside the native iOS app, not what
a desktop web visitor sees. Confusing the two is exactly the false-positive trap this file's
methodology notes exist to prevent, and this entry fell into it originally. Not filed as a defect —
the swap is correct App-Store-compliance behavior — but the original inventory row was simply
describing the wrong platform's UI as if it were the desktop web page. **Separately, per §1.2b:**
the three CTAs are `PlanLadder.tsx`'s not-yet-subscribed default state — our minted session's
client-side tier hook never hydrates, so this pass cannot confirm whether a real hydrated premium
session would show these same CTAs or a "Manage subscription" state instead.

**`RE-VERIFIED 2026-08-23 (correct UA)` — the original `/upgrade` entry inherited the same error**
("same signed-in-member routing pattern as `/pricing`, no drift found" — there was no such pattern
to begin with). Corrected: `/upgrade` renders "PREMIUM ACCESS — Unlock the full floor." then a
single featured **Premium Yearly $1,999/yr** card ("BEST VALUE — SAVE $389", feature checklist,
"UNLOCK PREMIUM →" CTA) followed by two smaller cards (**Premium Monthly $199/mo**, **SPX Slayer
$49/mo**) below the fold. Real pricing content, same as `/pricing`, laid out with the yearly plan
as the hero rather than three equal columns — a legitimate design difference between the two entry
points (upgrade nudges toward yearly; pricing presents three options evenly), not a defect.

**`RE-VERIFIED 2026-08-23 (correct UA)`** (`account-desktop`, 1440×900) — content and nav (`Nav.tsx`,
correctly rendering here in both the original and corrected passes, since `/account` was never
`StaticMarketingNav.tsx`-routed) CONFIRMED unchanged from the original entry:

```
PAGE /account
└─ HEADER "Account Settings" + subheading "PROFILE · SECURITY · CONNECTED DEVICES" (reads as a
   section index, not confirmed as functional in-page anchors/tabs this pass)
└─ CARD "Membership & Billing"  →  CURRENT PLAN "Free" (see correction below — NOT confirmed as the
   real tier) + "Upgrade" link
└─ CARD "Personal Play Alerts" (DISCORD WEBHOOK · NIGHT HAWK PLAYS)
   ├─ explainer copy — "Your webhook stays server-side — we only show a redacted host here."
   ├─ INPUT "Discord webhook URL" (placeholder `https://discord.com/api/webhooks/…`)
   └─ BUTTON "SAVE WEBHOOK"
```

**CORRECTION, same day (§1.2b) — the "Free" plan reading is NOT confirmed as our account's real
tier.** The original entry asserted the account was "genuinely tier Free with role:admin." That
conflated two different things: `publicMetadata` (which `mintClerkPremiumSession` sets to
`{role:"admin", tier:"premium"}` by default, and which every server-rendered gate in this pass
correctly read — explaining why every desk screenshot showed full premium data) versus what THIS
PAGE displays, which reads `useAppAuth()` — a client-side-only hook that never hydrates for our
minted `__session` cookie (§1.2b) and therefore always resolves to "Free" regardless of the
account's actual tier. **This card's "Free" reading has not been shown to reflect anything real
about the account — it reflects the hook never loading.** Whether a real, fully-hydrated premium
session would show "Premium" here is unconfirmed (§1.2b's open question about `parseTier("admin")`
is the specific reason it's not a safe assumption either way).

`home-mobile` scroll-depth beyond the hero fold not yet reviewed — fold in on next edit.

---

## 10. Candidate findings — summary table

Every row below is a screenshot-backed observation from this pass, cross-referenced to its full
writeup. **None of these are filed to `docs/audit/findings-staging/` yet** — per the standing
issue-handling policy a finding is staged in the same PR as its code fix, and this PR is the Phase 0
inventory, not a fix. This table is the punch list the next PRs work from.

**Status as of this revision: every desktop route in §2–§9 has now been re-shot with the correct
`--desktop` UA (`docs-audit/UI-UX-MAP.md`'s top-of-file correction).** Two more real findings
surfaced during re-verification (#8, #9 below) that the original wrong-UA pass never saw because
the wrong UA rendered those specific spots differently — one accidentally cleaner (#8), proving the
wrong UA can mask real bugs, not just invent fake ones.

| # | Surface | Summary | Severity | Section | Confidence |
|---|---|---|---|---|---|
| ~~1~~ | ~~`/dashboard` desktop~~ | ~~Vector panel tab leaves ~45% of the content width blank~~ | **RETRACTED** | §2 | **FALSE — original shot used wrong UA (iPhone UA at desktop viewport); real desktop layout is a 4-col grid, no blank space.** |
| ~~2~~ | ~~`/flows` mobile~~ | ~~Header flow-split bar overflows viewport horizontally; two stat strings concatenate with no separating space~~ | **FIXED** | §3 | Root-caused (`justify-between` with no gap/wrap) and fixed same day — see §3 and `docs/audit/findings-staging/2026-08-23-helix-mobile-tide-bar-overflow.md`. Verified via isolated CSS repro (live component couldn't be locally rendered — no dev flow data). Pending live validation post-deploy. |
| 3 | `/vector` mobile | Chart footer legend text overlaps itself ("16:30" on "08:30", "RECONSTRUCTED" on "SPOT-ALIGNED") | **P1** | §5 | Correct mobile UA. **Desktop half still unconfirmed** — the re-shot's Vector column was still "Loading Vector chart…" at capture, footer never rendered to compare. Plausibly the same shared `VectorChart.tsx` bug, not proven on desktop. |
| 4 | `/nighthawk` mobile | Header stat strip truncates ("UPDATED 12" cuts off "sec ago") instead of wrapping | **P1** | §7 | Correct mobile UA |
| 5 | `/terminal` mobile | Toolbar label collapses to bare "L…"; composer placeholder overflows its input box | **P3** | §8 | Correct mobile UA |
| 6 | `/nighthawk` mobile | ~45% of viewport left blank below the no-session empty state | **P2/P3** | §7 | Correct mobile UA |
| 7 | `/vector` mobile | Drops ticker search, metric/expiry toggles, matrix table, and live tape entirely (chart-only) — scope call | **P2** (needs Vector-lane input) | §5 | Correct mobile UA |
| 8 | `/nighthawk` **desktop** | Engine tab bar ("0DTE/Swings/Bangers/Legacy") renders with NO spacing between labels — reads as one unbroken word, no button boundaries | **P1** | §7 | Correct desktop UA, single shot. **The wrong-UA original shot showed this correctly styled** — an inversion of every other finding in this pass, worth independent confirmation before a fix PR. |
| 9 | `/meridian` desktop | Catalyst-list fetch (`/api/market/meridian/timeline?days=21`) has now timed out on 2 of 3 desktop attempts (one mobile attempt succeeded) | **OPEN QUESTION**, not yet a finding | §6 | 2 correct-UA desktop attempts, both stalled; needs a longer `--wait` re-check to separate "slow" from "broken." |

Cross-product patterns, not yet P0–P3 classified pending more coverage:

1. **TWO navs, not one (§1, corrected)** — `Nav.tsx` on desk pages + `/account`, `StaticMarketingNav.tsx`
   on `/`, `/pricing`, `/upgrade` (and presumably the rest of the `(marketing)` route group). Any
   navigation-consistency work has to treat these as two systems to reconcile, not one to extend.
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
5. **Chart footer legend overlap (finding #3 above) is confirmed on `/vector` mobile and PLAUSIBLE
   but not yet confirmed on `/dashboard` desktop** (same `VectorChart.tsx`, 4978 lines, embedded on
   both surfaces via `SpxVectorEmbed`) — if a desktop re-check confirms it, this is exactly the
   "fix once at the system level" case brief item 14 asks for; if it doesn't, the bug may be
   mobile-viewport-specific rather than shared-component-wide, which changes the fix's scope.

---

## 11. Gaps in this pass — the honest list

Per the file's own opening rule (an honest gap is a finding, a plausible guess is a lie that
outlives whoever wrote it):

- **`home-mobile` beyond the hero fold** — not yet reviewed.
- **No interaction testing yet** — every shot in this pass, including all the corrected-UA
  re-shots, is a default-state screenshot, which brief item 2 and `_COMMON.md` rule 6b are explicit
  is "a photograph of the feature having not been touched," not a test of it. Tabs, filters,
  search, sort, drawers/modals, chart zoom/pan, and ticker switching are all unexercised. Queued
  for the next LIVE VALIDATION window against a moving tape, where most of this class of defect is
  actually observable (§0).
- **No admin surfaces** (`/admin*`) — explicitly noted as lower priority in the charter, not
  covered this pass.
- **Three OPEN QUESTIONs remain:** `/meridian`'s slow desktop fetch (§6/§10 #9) and §5's withdrawn
  desktop-half of the Vector footer-overlap finding both need a longer `--wait` or a chart-loaded
  re-check rather than another default 9s shot. §1.2b's `parseTier("admin")` fallthrough needs a
  REAL signed-in admin browser session (not this lane's minted, unhydrated sessions) to confirm or
  rule out — this pass's tooling structurally cannot answer it.
- **A second, distinct methodology gap found the same day as the UA correction (§1.2b): every
  client-side tier-dependent UI element (`useAppAuth()` consumers — the `/account` plan display,
  `/pricing` and `/upgrade` CTAs) rendered in its default/unhydrated state in EVERY screenshot this
  pass**, separate from the UA bug and not fixed by re-minting the same way. Unlike the UA bug,
  there is no proposed tooling fix for this one yet — establishing a genuinely hydrated Clerk
  client session from a headless mint is a bigger change than a CLI flag, and worth its own design
  discussion rather than a quick patch. Flagged, not solved, this pass.
- **`docs/audit/UI-UX-OPPORTUNITIES.md`** stubbed in this PR per brief item 16 but not yet
  populated with real backlog items beyond what's in §10's table.
- **This correction pass itself is proof the methodology needs a permanent fix, not just a one-time
  re-shoot:** `proxy-browser.cjs`'s own doc comment already warned that the UA stays mobile without
  `--desktop`, and this pass still shipped 8 desktop entries (later corrected) without it. The
  durable fix is upstream of any single map entry — see `docs/audit/UI-UX-OPPORTUNITIES.md` for the
  proposed tooling change (a loud default-arg warning or requiring `--desktop` explicitly) so the
  next lane pass, or this lane's own next pass, can't repeat it silently.

Next edit of this file should close these gaps rather than starting a second document.
