# BLACKOUT Screenshot Playbook

**Living document.** Updated every capture cycle. Owned by the `x-content` lane.

The standard is not *"I generated the hourly post."* It is:

> I found the strongest story available, captured the best possible evidence from BLACKOUT,
> packaged it so it stops traders scrolling, and learned how to make the next one better.

---

## ⚠️ Read the evidence register first

This playbook mixes two very different kinds of claim, and confusing them would make it worse than
useless. Every entry is tagged:

| Tag | Meaning |
|---|---|
| **`MEASURED`** | Observed directly, with the observation recorded. Trust it. |
| **`RULED`** | The operator stated it. Binding regardless of measurement. |
| **`HYPOTHESIS`** | A plausible belief with **no data behind it yet**. Do not cite it as a finding. |

**As of 2026-08-21 there is no engagement data at all.** No package from this pipeline has been
published, so every claim about what "performs better" — close-ups vs full pages, carousels vs
single posts, which product drives signups — is `HYPOTHESIS` with **n = 0**. Writing them down is
useful; treating them as findings would be inventing a result. A rate without its denominator is
not a fact.

The performance register at the bottom stays empty until real numbers exist.

---

## 1. Capture mechanics that actually work

`MEASURED 2026-08-21` — verified against production, `Routed: 83–126 ok, 0 fail` on every run.

- Chromium here has **no network of its own**. Everything goes through the CONNECT-tunnel context
  (`scripts/audit/lib/proxy-tunnel-context.cjs`). A plain `page.goto()` harness cannot run at all.
  Health line to look for: `Routed: N ok, 0 fail`.
- Harness: `scripts/audit/x-intel-capture.cjs`.
- Clerk session JWTs last **~60 s**. Mint immediately before each run; never reuse across runs.
- One capture costs **~3–5 minutes** end to end. Budget accordingly — a five-frame package is
  ~20 minutes of wall clock, so start well before the hour you intend to post.
- **Frame a desk container, never `page.screenshot()`.** That is what keeps marketing chrome out.

### The chrome trap

`MEASURED` — the site nav is `position: fixed`, so it floats **over** the desk container and lands
inside an element screenshot anyway. Cropping it off means guessing a pixel offset that breaks the
first time the header's height changes. `hideMarketingChrome()` removes it from the layer, matched
by behaviour (fixed/sticky, top-anchored, marketing text, not owned by a desk container).

### The crosshair trap

`MEASURED` — zooming a chart leaves a crosshair readout floating over the frame. Park the pointer
off-chart before the shutter fires.

---

## 2. Per-product patterns

### 🔥 THERMAL — gamma / dealer positioning

**Best views:** `MATRIX` · `GAMMA PROFILE + CURVE + SHIFT` · `FORCED FLOW (DEPTH)` · `GRID` (sector)

**⛔ EXPIRY = ALL, ALWAYS.** `RULED` — and it is a correctness rule, not framing.

`MEASURED 2026-08-21, SPY:` the page defaults to the **front expiry**, and the front expiry reads a
different regime from the whole book:

```
AUG 21 only : LONG GAMMA  · NET GEX −$1.8B · flip 763 · call wall 770
ALL         : SHORT GAMMA at EVERY strike · NET GEX −$7.6B · resistance 780
```

A post built on the default would have told readers dealers were **dampening** volatility on a day
the book says they **amplify** it. Set ALL on MATRIX **before** switching tabs — `FORCED FLOW`
renders no expiry bar at all.

**Lens is free:** GEX / VEX / DEX / CHARM. Rotate it.

**Sector grid:** ten presets — Indices · Macro · Semis · AI · Space · Mag 7 · Crypto · Energy ·
Financials · Healthcare. Ten presets is ten distinct frames.

**Use when:** gamma flip crossed, wall migration, regime transition, short-gamma entry.
**Pairs with:** SPX/index chart + Helix flow confirmation.

---

### 🐋 HELIX — options flow

**Best views:** flow tape · `TOP PRINTS` (conviction) · `TOP STRIKES` (repeat + stack) ·
`ALL ANALYTICS PANELS` · `CONTRACT DRILLDOWN`

**The filter row is IN frame, so it is part of the evidence.** `RULED` — vary it per post:
FLOOR `$200K/$500K/$1M/$20M` · SIDE `ALL/CALL/PUT` · DTE `ALL/0DTE/≤7D/>7D` ·
QUICK `WHALES/0DTE/INDICES`.

**Strongest whale evidence is `TOP STRIKES`, not the raw tape** — it shows *repetition and
direction* (`REPEAT + STACK`, window notional, total on tape), which is the actual claim. One sweep
is noise; ten fills at one strike is a thesis.

**Use when:** large or repeated institutional premium.
**Pairs with:** Vector chart (the move) + Thermal (where dealers sit).

---

### 🎯 VECTOR — structure, beads, walls

**Best views:** desk (ladder + chart + intel rail) · `FULL SCREEN` · `COMPARE` (4-up)

**⛔ ZOOM UNTIL BEADS ARE *SEPARATELY* LEGIBLE.** `RULED`

`MEASURED` — my own SPX capture failed this: beads ran together into a smear. The bar is not "the
chart rendered", it is *a reader can count the beads and read the wall bands without pinching.*

**Vary the controls, not just the ticker.** `RULED` — horizon (0DTE / WEEKLY / MONTHLY), lens
(GEX / VEX), timeframe, indicator set, node density. A WEEKLY + GEX·2S NVDA chart and a 0DTE SPX
chart are visibly different pictures of the same product.

**Carry the surrounding intel** — GEX ladder rail, signals, wall integrity, confluence, expected
move — not the bare chart.

**`COMPARE` presets:** MAG 7 / INDICES / SEMIS / MOMENTUM.
**`Replay`** — scrub a past session. `UNEXPLORED` by this lane; used by the Jul-30 batch and it is
one of the most distinctive things the platform does. Prioritise showcasing it.

**Use when:** a level is doing the work — break, reclaim, repeated test.

---

### 🦅 NIGHT HAWK — trades

**Best views:** `CLOSED` tab (winning stack) · per-play `THESIS / MANAGEMENT / PNL / TIMELINE`

**⛔ P&L GATE.** `RULED` — post only for winning plays above **+50%**, or a green day with strong
0DTE plays. Enforced in `src/lib/x-intel/nighthawk-gate.ts`; requires **both** a >50% closed play
**and** a session that did not finish red.

`MEASURED` — the operator's own exemplar session runs **+97% at the top of the CLOSED tab to −23%
at the bottom**. An unfiltered screenshot of that tab advertises the losses. Frame the winning
stack, and **state the session's total play count in the copy** — the denominator is the difference
between a track record and a highlight reel.

Four sub-tabs per play = four distinct frames of one trade. Rotate them.

**Use when:** the gate passes. Not otherwise.

---

### 📊 MERIDIAN — earnings & macro

**Best views:** per-event tabs `SUMMARY / REPORT / ESTIMATES / POSITIONING / HISTORY` ·
macro event report · 15 named analytics panels

**Frame the panel, never the page.** `MEASURED` — `.meridian-page-root` measured **14,704 px tall**
on the analytics view. That is a screenshot of a spreadsheet. Panels are labelled semantically;
target `[aria-label="…"]`. An opened event frames on `.meridian-detail`.

**The rich frames are the per-event tabs.** `MEASURED` — the analytics-grid panels are wide, thin
strips (~100 px). Honest and legible, but weak as a lead. Use them as a **confirmation** slot where
a calendar or catalyst count is the supporting fact.

**Rotate the tab.** Summary answers *"so what do I do"*; Report carries the conviction ring and
expected move; Estimates the trajectories; Positioning the dealer structure and flow into the print;
History the prior reactions.

**Select the event by its theme class, not by position** — the timeline mixes earnings/macro/FDA/
OpEx, so "the first row" for an earnings story is usually a macro print with no earnings tabs.

**Macro (CPI / FOMC / NFP / PMI):** `--class macro` gives stance, warnings, release clock,
consensus, beat/miss scenarios, SPX positioning, flow skew. Capture it the same way on event days.

---

### ⚡ SPX SLAYER · LARGO

**SPX Slayer:** desk (header stats + PULSE + gamma map + pin forecaster + chart) · pin forecaster
with **`Why this pin?` expanded** — `RULED`, the reasoning is the evidence, not the cone.

**Largo:** cross-product answer card. A `NEUTRAL` / `WAIT` read is **publishable content**, not a
failed capture — see the contrarian exemplar. Credibility compounds.

---

## 3. Composition — the 1-second test

Before accepting any frame:

1. **Would this stop someone scrolling?**
2. **Can a trader get the point in 1–2 seconds?**
3. **Is the key number/level/signal obvious, or does it need hunting?**
4. **Does it show something only BLACKOUT has?**
5. **Is there a more powerful panel elsewhere for this same claim?**

### Reject and re-take

Huge empty areas · irrelevant panels · unreadable data at timeline size · clutter · awkward
cropping · loading skeletons · stale values · tooltips over the cited number · repetitive layouts ·
evidence you have to search for.

> Admin / private / debug content is **not** a quality reject — it is refused outright at the source
> URL by `capture-guard.ts`. *"Take a better picture"* and *"this picture must never exist"* are
> different rules, enforced separately.

### Prefer

Clear focal point · strong numbers · obvious direction · visible timestamps · accurate drama · clean
chart framing · the product's **own** annotations (BOS / CHOCH / wall labels / king node) ·
contrasting product views.

---

## 4. Cross-product pairings

| Story | 1 · WHAT HAPPENED | 2 · WHAT BLACKOUT SAW | 3 · CONFIRMATION |
|---|---|---|---|
| Gamma break | index chart at the flip | Thermal profile/shift | Helix put-flow |
| Whale flow | Vector chart, the move | Helix TOP STRIKES | Thermal dealer positioning |
| Night Hawk win | Night Hawk TIMELINE | Night Hawk PNL / trim ladder | Helix or Vector, why it worked |
| Earnings | Meridian POSITIONING | Meridian HISTORY | Thermal chain for the name |
| Macro day | Meridian macro report | Thermal SPX (ALL) | Vector SPX zoomed |
| Divergence | Helix (one read) | Vector (the other read) | — ship the conflict, do not resolve it |

---

## 5. Lessons log

Append-only. Newest first.

### 2026-08-21 — first live capture cycle

- **The default view is not the honest view.** Thermal's front-expiry default inverted the regime.
  Generalise: for any product with a scope/filter default, check whether the default changes the
  *claim*, not just the framing. Assert the control took (`aria-pressed`), never click and hope.
- **Frame level matters more than crop.** Two of my first three captures were wrong at the
  container level, not the pixel level — Meridian's page root (14,704 px) and Vector's chart-only
  crop that dropped the toolbar the operator wanted. Choose the container first, crop second.
- **My beads clustered.** Zoom that "looks fine" at full resolution fails at timeline size. Judge
  every frame at the size a phone renders it.
- **`FULL SCREEN` click failed** — retried and timed out. **UNRESOLVED.** Selector needs work.
- **Market-closed states are honest but weak.** Helix `FLOW UNAVAILABLE`, Night Hawk 0 plays,
  thin premarket candles. Fine as proof the harness works; not publishable evidence of a move.
- **Studied the Jul-30 batch** (7 posts, 40 attachments). Strong: the four-tools carousel, the
  7-tweet deep thread, and an **honest session recap covering misses** — credibility content.
  Weak signal: attachment names like `desk-full.png` suggest full-page captures, the exact pattern
  the composition rules above reject. No record of whether any of it was published or how it did.
- **Found `Replay`** (Vector) — used by the Jul-30 batch, unexplored by this lane. High priority:
  it is one of the most distinctive things the platform does.

---

## 6. Unexplored — work through these

Vector `Replay` · Vector `COMPARE` per-pane mode · Thermal `CHARM` lens · Thermal `Shift` with real
intraday history · Helix dark pool · Helix sector rotation · Night Hawk `Swings` / `Bangers` /
`Legacy` tabs · SPX Slayer `PULSE` filters · Largo slash-commands · `/track-record` ·
`/research/gamma-levels`.

---

## 7. Performance register

**EMPTY — n = 0.** No package from this pipeline has been published.

When posts exist, this table fills from `/api/admin/analytics/x`, joined to packages by
`posted_tweet_id`, and every row carries its denominator:

| Package | Franchise | Attachments | Impressions | Engagement | Profile visits | Signups | n |
|---|---|---|---|---|---|---|---|

**Attribution note:** the existing analytics key on **tweet text** and cover the 10 most recent
tweets. That cannot attribute a package. The `posted_tweet_id` join key on the queue row is what
makes per-package attribution possible, and it is filled by the human who publishes.

**Two disciplines when this fills:**

1. **Report the denominator.** "62% engagement" over 8 posts is not a finding.
2. **Do not let it collapse into one ticker.** If NVDA measures best, the loop will converge on NVDA
   and stop being a market newsroom. Optimise *within* a coverage-breadth floor.

**And do not repeat a winning screenshot forever.** Extract the *principle* behind why it worked and
apply it to new stories.

---

## 8. The objective

```
ATTENTION → CURIOSITY → TRUST → CLICK → EXPLORATION → SIGNUP
```

Every post should provoke one of: *"What just happened?"* · *"How did they see that?"* ·
*"What is this tool?"* · *"I need to look at BLACKOUT."*

**Never overstate what the platform actually detected.** A precedence claim needs timestamped
evidence that detection preceded the move — enforced by `readyBlockReason()`, which refuses to mark
a package READY otherwise. Accuracy is the only thing that compounds.
