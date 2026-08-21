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

### The duplicated-control trap

`MEASURED 2026-08-21` — **the first match is usually the wrong match.** The responsive toolbars
render a compact copy and a wide copy of every control, and CSS collapses the unused one to a
zero-size box instead of unmounting it. Both copies carry the same test id and both report
`display: inline-flex` / `visibility: visible`.

On `/vector?ticker=NVDA` at 2560×1440: copy 0 has rect `[0,0,0,0]` and `elementFromPoint` at its
origin returns the nav; copy 1 has rect `[570,89,116,32]` and hit-tests to itself. Playwright
reports the first as an 8-second click timeout — which reads as *"the button is broken"* rather than
*"you are pointing at the invisible one."* That single misreading blocked the Indicators menu and
`FULL SCREEN` for a day.

**Always address desk controls with a visible-only locator.**

### The auth-expiry trap

`MEASURED 2026-08-21` — a Clerk `__session` JWT lives about a minute; a capture run lives two to
five. A session minted by an earlier command and pasted in fails **every** surface at `page.goto`
with `net::ERR_CONNECTION_RESET`, because the origin 307s the expired session to `/sign-in` and the
tunnel gives the page no Clerk client to complete the bounce. It dies at the transport and names
neither auth nor expiry — it reads as *"the site is down."* It is not. Mint in-process and refresh
on a timer.

### The still-loading trap

`MEASURED 2026-08-21` — NVDA's heatmap ran a rebuild loop (`force=1&n=1..4`) and took ~30s to
render, showing "Loading heatmap…" the whole time with **every API call returning 200**. A fixed 9s
wait then clicked a ticker control that did not exist yet and reported a 20s click timeout. Wait on
a readiness signal (the expiry chips), not on a clock. Better still: `/heatmap` redirects to
`?ticker=SPY&lens=gex`, so the query *is* the page's state channel — drive the ticker through the
URL and skip the search UI entirely.

### The crosshair trap

`MEASURED` — zooming a chart leaves a crosshair readout floating over the frame. Park the pointer
off-chart before the shutter fires.

---

## 1b. PLATFORM MAP — read this before hunting for a story

`MEASURED 2026-08-21` — swept from the codebase and spot-verified against production. The catalog
in `view-catalog.ts` holds ~39 capturable views; the platform's real panel surface is **well over
100**. This section is the map; the catalog is the subset with framing rules attached.

### 🔎 START HERE: the platform finds stories for you

Two panels rank the market by "what is interesting right now". Neither is a capture target first —
they are **the story-discovery entry points**, and going to them before browsing is the difference
between hunting and searching.

**VECTOR → Universe Scanner** (`.vector-scanner-panel`, a `<details>` on `/vector`).
Four presets, and the hints are the product telling you what each one is for:

| Preset | What it ranks | The story it produces |
|---|---|---|
| **Nearest flip** | closest to a regime change — *"most actionable"* | 🎯 LEVEL THAT MATTERS · 🔥 GAMMA SHIFT |
| **Most pinned** | above flip, strongest walls — mean-revert | 🎯 pin / OpEx mechanics |
| **Most explosive** | below flip and near it — vol-expansion risk | 🔥 GAMMA SHIFT · ⚡ CONFLUENCE |
| All | every covered name, A–Z | — |

Columns: `TICKER · SPOT · REGIME (above/below) · GAMMA FLIP (+/-%) · CALL WALL · PUT WALL`.

Live example from 06:45 ET today, "Nearest flip": **TSLA 349.20 vs flip 349.20 (+0.0%), call wall
350** — a name sitting exactly on its regime boundary. SMCI −0.1%, RIOT +0.1%, MU −0.3%. That is a
ranked story queue, pre-sorted by actionability, before a single chart is opened.

⚠️ The panel renders ~2,500×3,750 px. **Crop to the top rows** — the whole table is a spreadsheet,
the top 10–15 rows are the story.

**HELIX → Net Premium Leaderboard** — tickers ranked by net premium. Same idea for flow:
it answers *"where is the money actually going"* without picking a ticker first.

### The full panel inventory

Everything below exists. Bold = not yet captured by this lane; work through them.

**HELIX** (23 components) — flow tape · contract drilldown drawer · high-score prints · strike-stack
detector · split-flow radar · route breakdown · signal-outcome tracker · sector flow · dark pool
panel + spark · **velocity spike radar** · **cumulative net-premium chart** · **expiry
concentration (this week / monthly)** · **net premium leaderboard** · **flow brief** · **tide bar** ·
**ticker drawer** · **Night Hawk flow panel (cross-product)** · watchlist bar

**VECTOR** (32) — chart · GEX ladder · 0DTE matrix rail · **universe scanner** · **pulse** ·
**technicals panel** · **alerts panel** · **Helix rail** · **daily chart** · **play card** ·
**regime banner** · **replay controls** · **draw toolbar** · compare desk / pane / add-slot /
command bar · **ticker comparison strip** · **wall event tooltip** · **crosshair legend** ·
intraday zoom · bead-rail / nodes / lens / DTE toggles · indicator menu

**THERMAL** (11) — matrix · gamma profile + curve + shift · forced flow (depth) · compare grid
(10 sector presets) · regime strip · intensity rail · freshness bar · compact matrix · triple desk

**NIGHT HAWK** (12) — 0DTE board · **Bangers board** · **horizon lane board** · **playbook board
(Legacy)** · play detail modal (THESIS / MANAGEMENT / PNL / TIMELINE) · **hawk record strip
(track record)** · **feed** · **briefing** · radar backdrop

**SPX SLAYER** (17) — desk terminal · GEX matrix heatmap · pin forecast · play verdict bar ·
**intel rail** · **pulse rail** · commentary rail (Largo) · **trade alerts + panels** · **signal
analytics (Morning ORB)** · **matrix tape strip** · **strike ladder axis** · **session time bar** ·
**sniper header** · Vector embed

**MERIDIAN** (18) — timeline · analytics grid · 15 labelled panels · event tabs (Summary / Report /
Estimates / Positioning / History) · **macro report** · **OpEx cross-market** · **peer cohort**

**LARGO** (24) — terminal · answer message · **structured cards** · **compare card** ·
**pre-earnings pack card** · **play-similarity card** · **slash menu + slash prompts** · **desk
module picker** · **answer-mode toggle** · **desk scope banner** · status strip · followup chips

### What this changes about the hourly cycle

The cycle was written as *inspect seven surfaces → find a story*. That is backwards now:

```
1. Vector Universe Scanner → "Nearest flip" / "Most explosive"   ← the ranked candidate list
2. Helix Net Premium Leaderboard                                 ← where the money is
3. Meridian catalyst timeline                                    ← what is scheduled
   ↓  pick the story from those three
4. THEN open the named product and capture the evidence
```

Three panels replace a browse. Use them.

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

**⛔ BUT THE COPY MUST NAME THE HORIZON.** `MEASURED` — capturing ALL is correct; describing an
all-expiry aggregate as today's actionable level is not. For a session claim, read the near-dated
scope and say which scope each number came from. See the lessons log.

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

**⏰ THE TIME AXIS IS UTC, NOT ET.** `MEASURED` — subtract 4 (EDT) before any time reaches copy.
Two anchors fix it: the previous session's closing volume spike sits at **20:00** (16:00 ET close)
and today's opening spike at **13:30** (09:30 ET open). A first reading of an NVDA frame called the
"09:00 flush" the open; it was **05:00 ET premarket**. Getting this wrong moves every event four
hours and manufactures a session claim out of an overnight one.

**💲 SPOT IS THE BANNER OR THE PRICE TAG — NEVER THE LAST VISIBLE CANDLE.** `MEASURED` — a zoomed or
scrolled frame ends where the viewport ends, not at the latest bar. Five NVDA captures showed
rightmost candles at 216.30–217.84 while the banner read 214.89–215.26; the banner was right
(independent last trade 215.2659 at 11:04:41 ET, Thermal header 215.05 at 11:01:05 ET). At full fit
the chart's own tag read 215.12 and agreed with its banner. The disagreement was the zoom.

**Reference recipe — verified 2026-08-21.**
`--surface vector --mode fullscreen --indicators "VWAP,Opening range" --zoom 9`
→ 2512×1354, 46% ink, 0% dead band. Full RTH session, individual candles, both wall bands with
their bead stacks, gamma flip, VWAP and opening-range levels all labelled.

- **Indicators BEFORE full screen.** The other order drops the chart to column width — an identical
  run went 2512×1354 → 1196×1398 portrait.
- **The zoom wheel anchors at 90% width.** The chart zooms about the cursor, so a centre anchor
  walks the newest bars off-frame: at `--zoom 11` the last candle shown was 12:12 on a chart live to
  14:00. For a "caught it first" post the right edge *is* the evidence.
- Vector ships with indicators already on (the trigger carries a badge count), so a named toggle can
  turn one **off**. The run reports the resulting count.

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

### Reject and re-take — now measured, not judged

```bash
node scripts/audit/x-intel-frame-quality.mjs frame.png     # exit 1 if it fails
```

Thresholds: ink < 2% (empty/loading) · dead band > 28% · empty grid regions > 45% ·
timeline legibility < 0.55 · aspect > 3.2:1 (sliver) or < 0.8 (X crops it) · content into the
bottom edge > 50% (truncated panel).

Judging a frame at 100% zoom on a desktop is exactly how a capture whose beads cluster at phone
size gets approved. Run the scorer.

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

### 2026-08-21 — the operator's frames had two controls set that mine did not

Side by side, the beads were the tell. The reference captures show dense, continuous rails of
individually countable beads at every strike near spot. Mine showed a thin dotted scatter.

It was not framing, zoom, or timing. It was **`NODES`**, which defaults to `AUTO` and resolves to
**11 rows** — and the reference frames run **20**, on **3-minute** candles. Nothing else about the
capture had to change.

Two things this cost that are worth remembering:

1. **I had been looking at the wrong variable for hours.** Zoom, anchor, full screen, indicators —
   all real improvements, none of them the thing. The answer was legible in the operator's own
   toolbar the whole time (`3 MIN`, `NODES 20 ROW`); I was comparing my output to their output
   instead of comparing my *controls* to their *controls*.
2. **It was non-deterministic and I nearly shipped it that way.** Two identical runs: the first set
   both controls, the second silently skipped both and captured an AUTO-11 chart. The toolbar
   hydrates after the chart, so testing whether a control exists at the settle is a coin flip. A
   frame that quietly lacks what the caption promises is worse than a failed capture, because
   nothing about it looks wrong.

Rule that came out of it, now general: **wait for a control, then report what it holds.** Never ask
whether it is there yet and move on. An absent control has to say so in the step log.


### 2026-08-21 — the best-looking frame was the weakest attachment

The BAC package went out with three slots: scanner at 11:36, Thermal at 11:39, Vector chart at
11:43. The Vector frame was easily the prettiest thing captured all day — full-bleed session,
individual candles, both wall bands, VWAP and opening-range levels labelled.

Then I went back at 12:06 and recaptured the **same Thermal panel**. `LONG GAMMA / 62.20 / vol
SUPPRESSED` had become `SHORT GAMMA / 61.89 / vol EXPANDED`. Same ticker, same strikes, 27 minutes
apart, every field that matters inverted.

That pair is the post. A third *view* of one moment adds a camera angle; the same panel *later*
adds a second moment, which is the only kind of evidence that can show a mechanism working. It also
fills `market_outcome`, which nothing captured before the move can.

So the rule for slot 3 is now: **prefer the same panel, later.** Go back and look at what happened.
The prettiest frame is not automatically the most load-bearing one, and on this package it was the
one to cut.


### 2026-08-21 — I read a chart four hours wrong, and the fix was to stop reasoning and measure

Chasing an apparent contradiction — the Vector regime banner said NVDA spot ~215 while the chart's
last visible candle read 216.30–217.84 — I built a theory that the banner was stale, and nearly
wrote it down as a rule that said *never source a price from the banner*.

It was exactly backwards. An independent last trade (215.2659 at 11:04:41 ET) and the Thermal header
(215.05 at 11:01:05 ET) both agreed with the **banner**. What was wrong was my reading of the chart:
a zoomed frame ends where the viewport ends, and the rightmost *visible* candle was simply not the
latest bar. At full fit the chart's own price tag read 215.12 and agreed with its own banner all
along.

The same run turned up the real finding underneath: **the time axis is UTC.** The previous session's
closing volume spike sits at "20:00" and today's opening spike at "13:30" — 16:00 ET and 09:30 ET.
I had already described that 09:00 flush as the open in my own notes. It is 05:00 ET premarket.

Three things worth keeping:

1. **A discrepancy is a question, not a finding.** I had five captures showing the same gap and was
   one step from publishing a rule built on the wrong half of it. What settled it was one unzoomed
   capture bracketed by wall-clock, plus an independent price — thirty seconds of measurement
   against an hour of plausible reasoning.
2. **The honest intermediate answer was "I cannot resolve this from here."** The market-data feed I
   reached for did not reconcile with the platform's own volumes, and saying so and going back to
   the product beat picking whichever source flattered the theory.
3. It is the operator's error class again, one level up. *Right number, wrong horizon* became
   *right number, wrong clock.*


Append-only. Newest first.

### 2026-08-21 — frames are now MEASURED, and the first thing it caught was mine

Built `scripts/audit/x-intel-frame-quality.mjs` + `lib/frame-quality-eval.cjs`: the reject list was
prose, and prose gets applied by whoever remembers to apply it. Every item on it is a measurable
property of the PNG.

**The first version passed all nine frames I fed it, which meant the metric was broken, not that
the frames were perfect.** `timelineLegibility` normalised gradient energy by the scale factor,
which cancels the signal it was measuring and returns 1.00 for everything. Rewritten as
downscale → upscale → reconstruction error, measured only over pixels that carry content (a large
empty canvas otherwise dilutes the error of the one panel a reader needs).

Scored against every frame captured today:

| frame | ink | empty | legibility | aspect | verdict |
|---|---|---|---|---|---|
| V-spx-zoom (operator-approved) | 17.7% | 0% | **0.88** | 0.91 | PASS |
| T-semis2 | 16.5% | 0% | 0.60 | 1.70 | PASS |
| PKG-thermal-spx | 11.2% | 0% | 0.57 | 1.94 | PASS |
| M-nvda-report | 7.3% | 10% | 0.57 | 1.64 | PASS |
| T-depth | 6.1% | 36% | 0.68 | 2.54 | PASS |
| **M-macro** | 8.3% | 15% | **0.51** | 2.34 | **REJECT** |
| **SCAN-top14** | 2.3% | 34% | **0.43** | **4.89** | **REJECT** |
| **M-heatgrid** | 8.6% | 26% | 0.63 | **20.68** | **REJECT** |

**The operator-approved Vector zoom scores highest on legibility (0.88), by a wide margin.** That
is real evidence the metric tracks their judgement rather than my own — it was not tuned to
produce that result.

**It rejected a frame I had just praised.** I sent SCAN-top14 describing it as "a genuinely postable
attachment". At 4.89:1 with legibility 0.43 it is a letterboxed strip whose numbers a reader cannot
read without tapping. The scanner is a superb story-FINDING tool and a poor standalone attachment —
those are different jobs, and I had conflated them.

**Rule added:** the scanner and the thin Meridian strips are CONFIRMATION-slot frames or internal
research, never the lead attachment. If a ranking must be shown, crop to ~6 rows and pair it.

### 2026-08-21 — the horizon error (caught by the operator)

**I drafted a post that was wrong, and the number was transcribed correctly.** That is what makes
it worth writing down.

A premarket package quoted `CALL WALL 7,900` for a post about that day's session. The value came
straight off the attachment — but the attachment was the **ALL-expiry** view, where far-dated OpEx
positioning dominates, and the post was about the next six hours. The near-dated read of the same
ticker at the same minute was not a different number, it was the **opposite story**:

```
ALL  : SHORT GAMMA · net GEX -$39.2B · call wall 7,900 · vol EXPANDED   · "no gamma flip"
0DTE : LONG  GAMMA · net GEX -$13.4B · call wall 7,700 · vol SUPPRESSED · flip 7,633
```

The draft told readers dealer hedging would **amplify** the move into a 09:45 print, on a session
whose 0DTE book says dealers are **stabilizing** and volatility is **suppressed**.

**The ALL-filter capture rule was not the problem — it is correct and stays.** The failure was in
the copy: an aggregate across every expiry narrated as though it described today.

**Rule now enforced in code:** every options-book value carries the horizon it was read at, and
`readyBlockReason()` refuses a package that claims something about today's session while every
cited level is all-expiry. A mixed set is fine — far-dated context alongside a near-dated basis is
exactly right.

**The general lesson, which is bigger than Thermal:** an accurate transcription of the wrong scope
is still a false claim. Ask *"what horizon is this number about, and what horizon is my sentence
about?"* before every level that reaches copy.

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
