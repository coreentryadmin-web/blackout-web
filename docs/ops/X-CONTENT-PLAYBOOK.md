# X CONTENT PLAYBOOK — @BlackOutTrade

**Source:** the operator, 2026-08-21. **Status:** authoritative for the `x-content` lane.

This is the content specification for the BLACKOUT live market newsroom. It is committed rather
than left in a chat transcript for the obvious reason — a spec nobody can read is a spec that gets
re-invented every time somebody new touches the pipeline.

Where this document and a lane brief disagree, **this document wins on content**; the brief wins on
process (publishing authority, chronology enforcement, build order).

---

## The shape of a post

```
HOOK → RECEIPT → WHY IT MATTERS → BLACKOUT EDGE → 2–3 VISUALS
```

**Numbers first. Evidence second. Explanation third. Branding last.**

### Voice

Write as if BLACKOUT is a live institutional intelligence desk reporting directly from the market.

- **Never** write like a corporate social-media manager. Never `"Today we're excited…"`, never
  `"Our platform identified…"`.
- Prefer specific timestamps, dollar amounts, levels and observable changes over adjectives.
- Make the reader think *"holy shit, how did they see that?"* — not *"this company is advertising
  to me."*
- Sometimes say less. Not every event needs an essay.

### Formatting vocabulary

Use it; do not carpet the post with it.

🚨 major event · ⚡ signal/change · 🐋 institutional flow · 🔥 exceptional move · 🎯 important level ·
👀 watch · ⚠️ caution · 🟢/🔴 direction · ↑ ↓ → movement

---

## The franchises

Recurring, recognisable formats. **Do not invent a fresh identity every hour.** A reader who has
seen ⚡ BLACKOUT CONFLUENCE three times knows what the fourth one means before reading a word.

| Franchise | Surface | Earned when |
|---|---|---|
| 🐋 **WHALE WATCH** | Helix | Large or repeated institutional premium — size, repetition and direction, not one random sweep |
| 🔥 **GAMMA SHIFT** | Thermal | Dealer positioning changes regime — flip crossed, short gamma entered, wall breaking |
| ⚡ **BLACKOUT CONFLUENCE** | cross-product | Three or more independent surfaces agree, with a first-alignment timestamp |
| 🦅 **NIGHT HAWK STRIKE** | Night Hawk | A committed play with a timestamped fire and a graded or live result |
| 🎯 **LEVEL THAT MATTERS** | Vector | One level is doing the work — a break, a reclaim, a repeated test |
| 🌎 **MARKET PULSE** | broad | Broad-market state worth stating on its own |
| 🌙 **AFTER DARK** | — | Post-close recap. **Scheduled slot only** |
| ☀️ **BEFORE THE BELL** | — | Premarket. **Scheduled slot only** |
| 🧾 **RECEIPTS** | — | Retrospective proof of an EARLIER package already on record |
| ⚔️ **SIGNAL CONFLICT** | — | Surfaces disagree. Published **as** a disagreement, never reconciled |
| 📊 **EARNINGS WAR ROOM** | Meridian | An earnings event worth mapping before, with an expected-vs-actual follow-up after |

Typed in `src/lib/x-intel/franchises.ts`. Two are schedule-locked and 🧾 RECEIPTS requires a prior
queue row to be receipts *of* — a receipts post with no record behind it is a foresight claim
wearing a different hat.

---

## Worked examples

These are quality references. Match the register, not the wording.

### 1 — "We saw it before the move"

```
🚨 NVDA — THE TAPE SPOKE FIRST

10:07 ET → Helix detects aggressive call accumulation
10:19 ET → NVDA reclaims VWAP
10:46 ET → breakout confirmed
11:12 ET → +2.4% ↑

The move wasn't the interesting part.
The positioning before the move was.

🐋 Helix saw the flow.
⚡ Vector confirmed structure.
🎯 BLACKOUT tracked the move.

Receipts attached. ↓

BLACKOUT // MARKET INTELLIGENCE
```

> ⛔ This shape asserts precedence and may only be published when the detection timestamp is on
> record and strictly earlier than the market event. Enforced by `readyBlockReason()`.

### 2 — Gamma

```
⚠️ SPX JUST CROSSED THE LINE THAT MATTERS

Gamma Flip: 6,782
SPX: 6,779 ↓

Thermal now has SPX trading in SHORT GAMMA territory.

Translation:
Dealers can go from dampening volatility → amplifying it.

This is where the tape gets interesting.

🔥 Watch 6,782 on any reclaim.

BLACKOUT // THERMAL
```

### 3 — Whale

```
🐋 SOMEONE JUST GOT VERY INTERESTED IN $META

$4.7M CALL PREMIUM

41 fills.
Repeated aggression.
Same direction.
Same thesis.

This isn't one random sweep.

Helix is watching accumulation build. 👀

BLACKOUT // HELIX
```

Much stronger than *"META has bullish options flow."*

### 4 — Cross-product

```
🚨 4 BLACKOUT SYSTEMS. ONE TRADE.

$AMD

🐋 HELIX      → Call accumulation
🔥 THERMAL    → Dealer positioning supportive
⚡ VECTOR     → Structure breaks bullish
🎯 NIGHT HAWK → LONG

Then: AMD +3.8% ↑

One signal can be noise.
Four independent intelligence layers agreeing is different.

BLACKOUT
```

Markets the platform *architecture*, not just a winning trade.

### 5 — Night Hawk result

```
🦅 NIGHT HAWK STRUCK.

$META 0DTE CALL

FIRED: 11:20 ET
GRADE: A+
CONFIDENCE: 94%

Entry → $2.14
Peak  → $4.96

+131.8% 🔥

The signal is timestamped.
The chart is timestamped.

BLACKOUT // NIGHT HAWK
```

### 6 — "While everyone watched price…"

```
Everyone was watching SPX price.
We were watching what was underneath it.

10:42 ET:
🔴 Gamma deteriorating
🔴 Put aggression increasing
🔴 VWAP lost
🔴 Dealer positioning unstable

23 minutes later: SPX -31 points ↓

Price tells you what happened.
Positioning can help explain why the move had fuel.

BLACKOUT
```

Brand-building without shouting.

### 7 — Earnings

```
👀 NVDA EARNINGS ARE TOMORROW.

Expected move: ±7.4%

Calls: $84.2M
Puts:  $51.7M

🎯 Call Wall
🎯 Put Wall
⚡ IV: Elevated

Meridian is already mapping the battlefield.
Tomorrow we find out which side was right.

BLACKOUT // MERIDIAN
```

Pair with a post-earnings expected-vs-actual follow-up: a natural two-post story.

### 8 — Contrarian / no-trade

```
🚨 THIS IS EXACTLY WHEN WE DON'T FORCE A TRADE.

SPX right now:
🟢 Call flow bullish
🔴 Price below VWAP
🔴 Short gamma
🟢 TRIN supportive
🔴 Breadth weak

5 signals. No clean agreement.

Largo: WAIT

Sometimes the highest-conviction signal is:
do absolutely nothing.

BLACKOUT // LARGO
```

Builds credibility. **Note:** this is publishable content about an unclear market — distinct from a
`SKIP` row, which records an hour with nothing worth saying at all. Both are legitimate; do not
collapse them.

### 9 — Say less

```
HELIX SAW THIS AT 10:14 ET.

🐋 $8.2M NVDA call accumulation.

NVDA then:
$216.80 → $224.31
+3.46% ↑

That's the post.

BLACKOUT // HELIX
```

### 10 — "What happened?"

```
SPX just dropped 42 points.
Here's what changed underneath the market:

            10:15 ET      11:07 ET
Gamma       🟡 Neutral    🔴 Short
Flow        🟢 Calls      🔴 Puts
VWAP        🟢 Above      🔴 Below
Breadth     🟡 Mixed      🔴 Weak

This wasn't one signal flipping.
The entire market structure deteriorated.

BLACKOUT
```

### 11 — The signature format

```
⚡ BLACKOUT CONFLUENCE

$TSLA

HELIX       🟢 BULLISH
THERMAL     🟢 BULLISH
VECTOR      🟢 BULLISH
NIGHT HAWK  🟢 LONG

4 / 4 ALIGNED

First alignment: 10:31 ET
TSLA then: +4.7% ↑

When independent systems start telling the same story,
we pay attention.

Receipts ↓
```

Actively search for these.

---

## Attachments

### Live exploration is mandatory

**Do not use the same predefined screenshots repeatedly.** For every story, open the live platform
and behave like a human researcher looking for the strongest visual evidence *for that specific
story*.

Search the ticker. Navigate between products. Click tabs. Open panels and drawers. Change filters,
expirations and timeframes. Sort tables. Search contracts. Hover values. Expand analytics. Zoom and
pan charts. Move crosshairs. Toggle indicators and overlays. Switch GEX/VEX/DEX/Charm. Use Largo
when cross-product context would help.

> **Browse BLACKOUT like a curious expert human, not a screenshot automation script.**

### The carousel is a sequence

| # | Role | Content |
|---|---|---|
| 1 | **WHAT HAPPENED** | The price/chart view showing the move |
| 2 | **WHAT BLACKOUT SAW** | The product intelligence that identified or explained it |
| 3 | **CONFIRMATION** | A *different* product or lens adding context |

The set should tell the story before a word is read. **Three screenshots of essentially the same
panel is a failed package** — if only two surfaces genuinely apply, ship two.

### Find a better screenshot

Do not capture the first usable screen. Ask:

- Can I make the move clearer by changing timeframe?
- Can I zoom into the exact moment?
- Can I remove irrelevant panels?
- Can I highlight the critical strike?
- Would Gamma Profile say this better than Matrix?
- Would Helix contract detail beat the main tape?
- Would Night Hawk Timeline beat P&L?
- Would a before/after view communicate the move better?

### Quality — reject and re-take

Irrelevant clutter · unreadable text · cut-off panels · loading skeletons · stale states · broken
charts · tooltips obscuring the cited value · awkward scroll position · excessive empty space.

The evidence must be legible **without the viewer zooming**. Crop tight, but keep enough BLACKOUT
product context that the reader knows where the intelligence came from.

> Private/admin/debug content is **not** a quality reject — it is refused outright at the source URL
> by `capture-guard.ts`. "Take a better picture" and "this picture must never exist" are different
> rules and are enforced separately.

### Visual memory — the anti-laziness rule

Track, per attachment: **product · page · panel · visualization · ticker · timeframe · filter state
· composition · the post it was used in.**

Check that history before selecting. Avoid repeating the same product, panel, zoom, filter
configuration or visual angle unless it is genuinely the best evidence for an important story.

This is the rule most likely to be lost, because any chooser with a quality signal converges on
whatever worked once. Implemented as a *penalty*, not a ban — see `visual-memory.ts`.

### Spread across the platform

Over a week of scrolling, a follower should discover how deep the platform is. Maintain diversity
across: Helix live flow / contract detail / sector rotation / dark pool · Thermal Matrix / Profile /
Shift / dealer views · Vector charts / levels / overlays · SPX Slayer · Night Hawk queue / Thesis /
Management / P&L / Timeline · Meridian earnings / estimates / positioning / history · Largo.

Catalogued in `src/lib/x-intel/view-catalog.ts`.

Never:

```
Helix · Helix · Helix · Thermal · Helix
```

### Continuous discovery

As you browse, keep a catalog of high-performing screenshot locations, interesting views, unique
visualizations, useful filter combinations, strong chart configurations, and new features worth
showcasing. When BLACKOUT ships new UI, explore it and fold it in. **The visual strategy must not go
static.**

---

## Links and CTA

The CTA is a **reply**, not a post footer — see `src/lib/x-intel/cta.ts` for why (reach on a cold
account, room inside 280 characters, and keeping the post a demonstration rather than an advert).

Confirmed live by the operator 2026-08-21: the Discord invite, the Whop link and the `BLACK50`
promo code (50% off first month). Pricing: **full desk $199/mo · SPX Slayer $49/mo**.

Rotation is deterministic and least-recently-used, never random, and the chosen variant is recorded
on the queue row so conversions can be attributed per package.
