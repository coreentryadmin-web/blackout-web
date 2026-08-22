# SPX Slayer desk — live RTH audit backlog, 2026-08-07

> **RECONCILED 2026-08-22 against `963c8448`. Read this box before acting on anything below.**
>
> This file was written by a one-off audit agent on 2026-08-07 and then went stale in the most
> expensive way available: **all ten entries still said `BACKLOG — fix after close 2026-08-07`
> while three had been fixed and one was not a defect at all.** A stale document that reads as
> current is worse than no document, because it sends the next reader to re-derive solved work.
>
> Every `### Status` block below now carries its REAL state at `963c8448`, verified by reading the
> code, with the file and line that settles it. Three entries are marked **UNVERIFIED** rather than
> judged — they are pixel/network observations that a source read genuinely cannot confirm or
> refute, and calling them "fixed" or "open" from the source would be a guess wearing a verdict's
> clothing.
>
> **Ownership changed.** The original header's "this file is mine alone" referred to an agent that
> no longer exists. This file now belongs to the permanent SPX Slayer owner lane
> (`docs/agents/briefs/spx-slayer.md`), and its live successor is **`docs/spx/SLAYER-MAP.md`** —
> keep findings there, and keep this file as the 2026-08-07 RTH capture it is. The evidence below
> (real prod captures, real Polygon ground truth) is still valuable precisely because it was taken
> during a live session; none of it has been altered.

Original header follows.

---

Owner: SPX-desk audit agent (2026-08-07 session; see the reconciliation box above for current
ownership). **This file is mine alone** — no other agent writes to it, and I do
not touch `docs/audit/FINDINGS.md` (consolidated centrally).

Audited against **LIVE PRODUCTION** `https://blackouttrades.com` during RTH on 2026-08-07,
09:38–10:15 ET. All evidence below is real captured request/response data, real prod pixels, and
real Polygon (`api.massive.com`) ground truth pulled within seconds of the app reading. Prod was
treated as READ-ONLY throughout; every probe went through the app's own REST endpoints or the
`proxy-browser`/`live-ui-audit` render transport (raw Postgres + WebSockets are blocked in this
sandbox and were not retried).

Auth: `scripts/audit/lib/audit-auth-fetch.mjs`, which resolved to the **cron bearer** (`via=cron`)
for every API probe — so no Clerk temp user was minted for the API sweep at all. The three browser
renders each minted and released their own temp user through
`scripts/audit/lib/prod-clerk-session.mjs`.

**Severity tally as filed: 1 × P0 · 2 × P1 · 5 × P2 · 3 × P3.**

**Reconciled tally at `963c8448`: 2 FIXED · 1 PARTIALLY FIXED · 3 OPEN · 1 NOT A DEFECT ·
3 UNVERIFIED (need a live render or a repro, not a source read).**

---

## [P0] SPX headline day-change is anchored to the session OPEN, not the prior close — wrong number, wrong SIGN, and it flickers
**Date:** 2026-08-07

### Symptom
The single largest number on the SPX Slayer desk — the `SPX 7,7xx.xx ±x.xx%` tile in
`SpxSniperHeader` — shows a day-change that is roughly **one tenth** of the real one, and on an up
day it regularly renders **negative and RED**. It also flips sign between polls, so a member
watching the desk sees the index change oscillate red↔green while SPX is monotonically up on the
session.

### Evidence

**Rendered pixels (both viewports, live prod, my own session):**

| Capture | Header tile | True day change | Polygon `I:SPX` at that moment |
|---|---|---|---|
| Desktop 1600x1000, 13:51 UTC | `SPX 7,741.69 **+0.08%**` (green) | **+0.41%** | val 7741.61, `session.change_percent` 0.411, `previous_close` 7709.96 |
| Mobile 430x932, 14:04 UTC | `SPX 7,734.13 **-0.01%**` (**RED**) | **+0.31%** | prev close 7709.96 |

The mobile capture is the clearest member-facing statement of the bug: the desk renders the index
**down in red** while it is up 24 points on the day, next to a `TREND Bullish` tile.

**API, `/api/market/spx/pulse` vs `/api/market/spx/desk` vs Polygon, same instant (8 consecutive
polls, 45 s apart):**

```
UTC        pulse.chg  desk.chg   POLY chg%  (price-prevClose)/prevClose  (price-open)/open
13:40:46     0.02       0.34       0.352            0.344                     0.016
13:41:32     0.03       0.35       0.364            0.361                     0.034
13:42:18     0.02       0.39       0.327            0.346                     0.019
13:43:04     0.00       0.33       0.362            0.328                     0.001
13:43:52     0.08       0.39       0.411            0.407                     0.079
13:44:49     0.10       0.44       0.444            0.426                     0.099
13:45:51     0.42       0.41       0.415            0.423                     0.095   <-- REST fallthrough
13:46:37     0.04       0.36       0.376            0.368                     0.040
```

`pulse.spx_change_pct` tracks **`(price − session open) / open`** to the second decimal on 7 of 8
polls (open = 7735.18). `desk.spx_change_pct` tracks the correct prior-close anchor and agrees with
Polygon. The single outlier at 13:45:51 — `pulse.chg = 0.42`, matching the *prior-close* value —
is the diagnostic: that is the poll where the Redis/WS lane missed and the code fell through to the
authoritative REST snapshot. **The number is not consistently wrong, it is two different numbers
alternating.**

**The oscillation, three polls inside 40 s (`/api/market/spx/pulse`):**

```
2026-08-07T14:00:01Z  pulse spx_change_pct = -0.04    desk = 0.27
2026-08-07T14:00:19Z  pulse spx_change_pct = +0.30    desk = 0.27
2026-08-07T14:00:40Z  pulse spx_change_pct = -0.01    desk = 0.27
```

**VIX is affected identically.** `pulse.vix_change_pct` at the same three instants: `-1.51`,
`-0.79`, `-1.64`, against `desk.vix_change_pct = -0.66` and Polygon `I:VIX session.change_percent`
in the `-0.20 … -0.59` band. The VIX open was 15.30 vs a 15.15 prior close, which is exactly the
~1 % offset the wrong anchor produces.

### Root cause
`src/features/spx/lib/spx-desk.ts` — the pulse fast lane and the desk slow lane resolve
`change_pct` through two different code paths with two different levels of care:

- `mergeWsIndexSnapshots()` (**spx-desk.ts:507-537**) already knows about this exact failure mode.
  Its "FIX-A" block only trusts a WS `change_pct` when `ws.open_source === "rest"`, because a
  change% computed against a raw first-seen bar open "is computed against the price AT BOOT and is
  WRONG"; otherwise it keeps the authoritative REST `change_pct`.
- `fetchPulseLaneSnapshots()` (**spx-desk.ts:540-576**) reads the cross-replica Redis snapshot
  `spx:pulse:snapshot` first and takes `e.change_pct` **at face value**:
  `change_pct: Number.isFinite(e.change_pct) ? Number(e.change_pct) : 0`. The Redis entries carry
  only `{ price, change_pct, updatedAt }` — **there is no `open_source` field on them at all**, so
  the FIX-A guard is not merely skipped, it is not expressible on this lane.

The value then flows straight out: `spx-desk.ts:1902` `spx_change_pct: spxSnap.change_pct` →
`/api/market/spx/pulse` → `usePulseStream.ts:44` → the header tile. The alternation between the
wrong and right value corresponds to whether the Redis snapshot was fresh (`updatedAt` within
`INDEX_STORE_STALE_MS`, 120 s) on that request; when it was not, the code falls through to
`fetchIndexSnapshots()` (`polygon.ts:410`, `session.change_percent`) and the correct number
appears for one poll.

Not yet traced: which writer populates `spx:pulse:snapshot` and where *its* `change_pct` anchor
comes from. The writer is outside `src/features/spx` (market-worker lane) and I did not confirm it
from the sandbox — but the app-side gap (no `open_source`, no guard) is sufficient and is where the
guard already exists on the sibling lane.

### Suggested fix
Two independent changes, either of which stops the sign error:

1. **Carry the anchor.** Add `open_source` (or better, `prev_close`) to the `spx:pulse:snapshot`
   entries and apply the same FIX-A authoritativeness test in `fetchPulseLaneSnapshots()` that
   `mergeWsIndexSnapshots()` already applies. This is the minimal, symmetric fix.
2. **Derive, don't transport.** The pulse payload already carries `prior_close` from
   `priorDayForPulseLane()`. Compute `spx_change_pct = (price − prior_close) / prior_close` at the
   payload boundary and stop transporting a change% whose anchor is unknowable. This makes the
   header self-consistent by construction (the same tile shows both numbers) and would have made
   the bug impossible.

**Deliberately leave alone:** the desk lane (`buildSpxDesk`) — it is correct and matches Polygon on
every poll; and `mergeWsIndexSnapshots`'s FIX-A logic, which is right and should be the template.
Do not "fix" this by making the header read `/desk` instead: the desk lane is a slower cache (its
`price` was observed frozen at 7730.71 across a 40 s window while pulse/flow/pin all moved), so the
header would go stale — the pulse lane is the right source, its anchor is the defect.

### Status
**FIXED — verified in code 2026-08-22 at `963c8448`.** `fetchPulseLaneSnapshots` now applies the
FIX-A authoritativeness test this entry asked for: it takes the sub-second-fresh PRICE but leaves
`change_pct` unresolved unless the Redis entry declares `open_source === "rest"`, falling through
to the authoritative REST lane otherwise. `src/features/spx/lib/spx-desk.ts:624-651`, which carries
this entry's own 2026-08-07 measurement in its comment. Suggested fix #1 ("carry the anchor") is
what shipped; #2 ("derive, don't transport") was not taken.
**Still open from this entry:** the WRITER of `spx:pulse:snapshot` was never traced, so its anchor
is UNKNOWN at source — the app now fails closed on it rather than trusting it. Tracked as work-list
item 2 in `docs/spx/SLAYER-MAP.md` §8.

---

## [P1] `/api/market/spx/flow` is the one SPX route with no `roundFloats()` — members are served raw IEEE-754 noise
**Date:** 2026-08-07

### Symptom
The known repo bug class (`7499.360000000001`), still live on exactly one SPX endpoint. Any
consumer that renders these without its own formatter shows a 16-digit number; and the *same field*
served by `/desk` and by `/flow` differs in precision, so two panels reading two lanes can disagree
on a value that is supposed to be identical.

### Evidence
Scanned every number in every SPX response for a fractional part ≥ 6 digits, over **4 polls,
20 s apart, 11 endpoints** (`/pin`, `/pulse`, `/desk`, `/flow`, `/bootstrap`, `/merged`, `/play`,
`/outcomes`, `/signals`, `/power-hour`, `/gex-heatmap?ticker=SPX`).

Result — **every endpoint clean except `/flow`**, which was dirty on all 4 polls, 14 distinct field
paths:

```
2026-08-07T13:38:41Z  /api/market/spx/flow  malformed=13
  gex_walls[0].net_gex = -1478892837.029604
  gex_walls[1].net_gex =  1724384423.8715081
  gex_walls[3].net_gex =  5920208755.728491
  gex_walls[9].net_gex =   504674399.88667214
  greek_exposure.buckets[4].gamma = 46071.269100000005
  greek_exposure.buckets[7].gamma = 23420.163399999998

aggregate over 4 polls: /api/market/spx/flow -> 14 distinct paths
  ($.gex_walls[1..9].net_gex, $.greek_exposure.buckets[*].gamma)
all other 10 endpoints -> 0 malformed on every poll
```

Same field, other lane, same session: `/api/market/spx/desk` served
`gex_walls[0].net_gex = -1394180538.29` — two decimals, because `/desk` rounds.

Also observed at the same instant (14:00:01Z): `desk.gex_net = 46952993202.26` vs
`flow.gex_net = 47606942180.69158` — the value differs *and* the precision differs.

### Root cause
`src/app/api/market/spx/flow/route.ts:18` returns `NextResponse.json(flow, …)` with **no**
`roundFloats()` wrapper. Every sibling SPX route applies it:
`desk/route.ts:29`, `pin/route.ts:18`, `outcomes/route.ts:23`, `bootstrap/route.ts`. `/flow` was
simply missed. `/pulse` also omits it, but its numbers all originate pre-rounded upstream
(`roundDeskNum`) or come straight from Polygon, so it scanned clean on all 4 polls — it is a latent
risk, not a live defect.

### Suggested fix
Wrap the `/flow` response in `roundFloats(...)`, matching `/desk`. Note the mixed-scale hazard the
helper documents: `greek_exposure.buckets[*].gamma` is O(10⁴) here so the 2 dp default is fine, but
if any greek in that payload is O(0.001) it needs a `keyDp` override — check the payload shape
before choosing, do not blanket-round blind.

**Deliberately leave alone:** the arithmetic that produces the floats. The repo has already decided
(see the header comment in `src/lib/round-floats.ts`) that rounding happens once at the response
boundary rather than at a dozen unrelated accumulation sites. `/pulse` — worth adding for symmetry
but it is not currently emitting noise, so it is a separate, lower-priority change.

### Status
**FIXED — verified in code 2026-08-22 at `963c8448`.** `src/app/api/market/spx/flow/route.ts:24`
wraps the payload in `roundFloats(flow)`, and its comment cites this entry's measurement
(`net_gex -1478892837.029604`). Every SPX route now rounds at the data layer.

---

## [P1] Four different "gamma flip" numbers, two "max pain" numbers, two "net GEX" numbers — and two tabs that give OPPOSITE trading instructions
**Date:** 2026-08-07

### Symptom
A member looking at the SPX Slayer desk can read the gamma flip as **four different prices**, max
pain as **two**, and net GEX as **two**, with disclosure on only one of them. Because the flip is
the regime boundary the whole desk narrates, spot sitting *between* two of the published flips makes
two panels of the same desk issue **contradictory instructions**: the Vector tab says short gamma
("moves accelerate — trade momentum"), the Intel tab says long gamma (mean-revert / fade).

### Evidence — the contradiction, captured in one render pass

One browser session, 430x932, `/dashboard`, tabs clicked in sequence 14:13:2x–14:13:5x UTC
(10:13 AM ET). Every line below is text scraped from the live rendered DOM:

**Vector tab** (14:13:2x), header `Γ FLIP ▼ 7,722.58`, commentary card:
```
SHORT GAMMA
Spot 7,722.56 is below the gamma flip (7,735.99) → short gamma: dealers sell weakness
and buy strength, so moves accelerate — trade momentum, respect breaks.
```

**Intel tab** (14:13:21–14:13:26), header `Γ FLIP ▲ 7,724.33`, Pulse rail badge:
```
LONG GAMMA · UNSTABLE · +$44.7B γ
```

**Matrix tab** (14:13:55 ET stamp on the panel), header `Γ FLIP ▲ 7,723.47`:
```
Γ FLIP (0DTE)   7,736.7            NET GEX   +$13.9B      21 EXPIRIES / FULL
Header γ flip 7,723.5 uses 8-expiry aggregate. King node · GEX anchor (near-term) 7,750.
```
…while the header tile in the very same frame reads `GEX $45.0B`.

So within ~30 seconds and three clicks: gamma flip = **7,722.58 / 7,724.33 / 7,735.99 / 7,736.7**
(spread **14.1 pts**), net GEX = **$45.0B** (header) vs **+$13.9B** (matrix, 3.2× apart), regime =
**SHORT** on one tab and **LONG** on the next.

**Credit where due:** the Matrix panel is the *only* surface that discloses the split, and it does
it well — it names the header's flip, its expiry basis, and the near-term anchor in plain text. The
header tile, the Vector commentary card and the Pin Forecast panel carry no such note. The fix
below is to extend that disclosure, not to invent it.

### Evidence — the API layer underneath

**Max pain — sustained, not a race.** Six polls of `/pin` + `/desk` 8–10 s apart, 14:02:22 →
14:03:08 UTC. `desk.max_pain` (the header `MAX PAIN` tile) was **7630** on all six; the Pin
Forecast panel's top-weighted driver read, on all six:

```
• 7700 max pain is the dominant magnet — Heaviest positive-gamma level below spot
  (5% of |gamma|). Hedging drags price down into the close.
```

70 points apart, same instant, both labelled "max pain", both member-facing.

**I verified which one is right, independently.** Pulled the full SPXW 2026-08-07 chain from
Polygon (336 contracts, strikes 7275–8205, spot 7739.37 at 13:48:13Z) and computed max pain both
ways:

```
maxPain OI-only  = 7630   <-- matches desk.max_pain EXACTLY
maxPain OI+volume = 7680  (7700 at the later poll, as volume accumulated)
```

So **neither number is wrong** — `desk` reports the OI-only max pain and the pin engine reports
OI+intraday-volume (`pinMaxPain()`, `spx-pin-forecast-core.ts`, `oi = c.openInterest +
Math.max(0, c.dayVolume ?? 0)`). They are two legitimate metrics wearing one label. The bug is the
label, not the math.

**Gamma flip — three lanes, same instant:**

```
2026-08-07T14:00:01Z   pin.flip 7734.78   desk.gamma_flip 7725.42   flow.gamma_flip 7724.76
2026-08-07T14:00:19Z   pin.flip 7728.63   desk.gamma_flip 7725.42   flow.gamma_flip 7724.76
2026-08-07T14:00:40Z   pin.flip 7728.05   desk.gamma_flip 7725.42   flow.gamma_flip 7726.61
```

Max spread **10.02 pts** (14:00:01). And in pixels, one mobile frame at 14:04 UTC:

- header `Γ FLIP  ▲ 7,724.12`
- chart overlay line label `Gamma flip 7728`, axis tag `7728.26`
- commentary card `Spot 7,734.04 is sitting on the gamma flip (7,728.26)`

An earlier desktop frame at 13:51 UTC showed the same three-way split with different values:
header `Γ FLIP ▲ 7,726.90`, chart overlay `Gamma flip 7730 / 7729.52`, commentary
`gamma flip (7,729.52)`.

**Consequence, observed live:** at 14:00:01 `pin.regime` was `short_gamma` (spot 7732.04 < flip
7734.78) while `desk.gamma_regime` was `mean_revert` / `above_gamma_flip: true`. 18 seconds later
`pin.flip` moved to 7728.63 and `pin.regime` flipped to `long_gamma` — the Pin Forecast panel's
headline driver text swung from *"Short gamma below flip — dealer hedging AMPLIFIES moves"* to
*"Long gamma above flip — dealer hedging DAMPENS moves"*, and the dominant magnet jumped from
`put_wall 7730` to `max_pain 7700`, a 30-point relocation, in under 20 seconds.

Ground-truth sanity: my own crude cumulative-net-gamma crossing over the same Polygon chain landed
at **7745**, and `gex_king` was **7750** on both `/desk` and `/flow`, matching my top-|GEX| strike
(7750, 2.94 B) exactly. So all three app flips are in a plausible neighbourhood — this is a
*coherence* finding, not a "the flip is wrong" finding.

### Root cause
Three independent ladders, by construction:
- `spx-pin-forecast-core.ts:319` `pinFlip(ladder, spot)` over an **OI-only, 0DTE-only** BSM ladder
  at a fixed structural tenor (`structYears`, `prepare()`).
- `desk.gamma_flip` comes from `canonicalGex` / UW intel via `spx-desk.ts:1464-1501` (cached on the
  slower desk lane — observed frozen at 7725.42 across 40 s while the others moved).
- `flow.gamma_flip` from the flow lane's own GEX snapshot.

Plus a fourth, self-declared: the header tile aggregates **8 expiries** while the matrix computes a
**0DTE** flip over a 21-expiry book (matrix disclosure line, quoted above), and the Vector
commentary card reads yet another value.

Commit `daad28d5` ("unify the 0DTE gamma flip — pin OI-only ladder + matrix live spot") unified the
pin lane with the **matrix**; the desk header tile, the flow lane and the Vector commentary card
were not brought along, and nothing enforces the remaining split or surfaces it outside the matrix.

### Suggested fix
Do **not** force one number — the ladders answer different questions and collapsing them would make
the pin engine wrong. Instead:
1. **Regime first.** The regime word (`SHORT GAMMA` / `LONG GAMMA`) is an instruction, not a
   reading, and it must be computed from ONE flip across every panel. Pick the 0DTE flip (the right
   one for a 0DTE desk) and have the commentary card, the Intel Pulse badge and the header tile all
   derive their regime from it. This alone removes the contradictory-guidance failure.
2. **Extend the Matrix's disclosure pattern** to the header tile and commentary card — the Matrix
   already names its basis in plain text and that is exactly the right treatment. Same for `GEX`
   ($45.0B, 8-expiry) vs `NET GEX` (+$13.9B, near-term): two labels, two bases, no note.
3. Disambiguate the labels: header `MAX PAIN` → `MAX PAIN (OI)`; the pin driver → `max pain
   (OI+vol)`. Cheap, and it converts a contradiction into two honest metrics.
4. Add a coherence assertion to the pre-open gate: any two member-facing values sharing a label
   must agree within a stated tolerance, or the label must differ.

**Deliberately leave alone:** `pinMaxPain()`'s OI+volume definition (it is the right input for an
intraday pin forecast — the volume term is live positioning) and the desk's OI-only max pain (it
matches the industry-standard definition and, verified above, matches Polygon exactly).

### Status
**PARTIALLY FIXED — verified in code 2026-08-22 at `963c8448`.** Superseded by
`docs/spx/SLAYER-MAP.md` §5, which records the intended per-lane scoping so no future lane
"fixes" this by collapsing the ladders (which would make the pin engine wrong).
- **Shipped:** suggested fix #3 on the pin side — `SpxPinForecast.tsx:18,281` now say
  "effective max pain" / `EFF MAX PAIN`; and suggested fix #2's disclosure now lives in the header
  tooltips, which name the basis split for `flip`, `maxPain` and `regime`
  (`SpxSniperHeader.tsx:96-98`).
- **Still open:** the VISIBLE header label is still bare `Max Pain` (`SpxSniperHeader.tsx:223`) and
  `Max pain` on iOS (`SpxIosMetricGroups.tsx:115`) — and **a tooltip is not disclosure on a touch
  device, where there is no hover.** Suggested fix #4 (a coherence assertion in the pre-open gate:
  two member-facing values sharing a label must agree within a stated tolerance, or the label must
  differ) is not built — work-list item 6 in the map's §8.

---

## [P2] SPX Slayer mobile: brand text collides with the menu button, and the chart control row overlaps itself
**Date:** 2026-08-07

### Symptom
On a 430 px iPhone viewport the top bar renders `SPX Slayer` **overprinted on the hamburger
glyph**, and in the chart control cluster the `0DTE` pill is drawn **on top of** the
`INDICATORS 1` button, obscuring the badge. Both are plain overlaps, not clipping — the page has
zero horizontal overflow, so no scroll reveals them.

### Evidence
Live prod render, `https://blackouttrades.com/dashboard`, viewport 430x932, iPhone UA
`BlackOutiOSApp/1.0`, `Routed: 122 ok, 1 fail` (the 1 fail is the long-lived SSE stream, expected),
captured 2026-08-07 ~14:04 UTC. Screenshot: `spx-mobile.png`.

- Top bar: the `SPX Slayer` wordmark's final glyphs sit inside the circular menu button's bounds,
  with the ☰ rule drawn through the `e`.
- Control cluster: rows wrap as `[SPX] [3 MIN ▾] [INDICATORS 1]` / `[0DTE] [WEEKLY] [MONTHLY]`, and
  the `0DTE` pill's box intersects the `INDICATORS` button's box — the blue `1` badge is half
  covered.
- The same collision is visible at desktop width under the same (mobile) UA: `Features SPX Slayer`
  renders as overlapping glyphs in the 1600x1000 capture (`spx-desktop.png`).

`horizontalOverflowPx: 0` at **both** 430 px and 1600 px, and `pageErrors: []` — so this is a
stacking/wrap defect inside a container, not an overflow or a crash.

### Root cause
**Not yet traced.** I did not localise the CSS rule. Both collisions are between siblings in a
wrapping flex row, which points at a wrap that drops an element into a neighbour's box rather than
onto a new line — but I did not confirm that against the computed styles, and I am not going to
guess a rule for a layout bug (per the lesson recorded in FINDINGS for #1843, a layout modifier is
only correct for the flex direction it was written for).

### Suggested fix
Localise with `live-ui-audit.cjs --inject-css` before/after (the harness renders live prod and can
apply an unshipped stylesheet to the real DOM). Measure the two `getBoundingClientRect()`
intersections as the before/after metric — note the #1848 lesson that a rect-based measurement is
blind to an absolutely-positioned `::after`, but for an *overlap* test the rect is exactly the right
instrument.

**Deliberately leave alone:** the desktop-UA rendering — the harness pins a mobile UA, so I have no
true desktop-UA capture and must not claim the desktop shell is or is not affected (see "Not
covered" below).

### Status
**UNVERIFIED at `963c8448` — needs a live render, not a source read.** This is a pixel defect; its
own root-cause section correctly declines to guess a CSS rule, and reading the source cannot
confirm or refute it either. Deliberately NOT marked fixed or open. Closing it honestly is
work-list item 5 in `docs/spx/SLAYER-MAP.md` §8 (the SPX interaction-audit harness, built on the
`meridian-interaction-audit.mjs` pattern — physical text intersection, gated on a PAGE-LOADED
proof so a blank render reports HARNESS, never a product verdict).

---

## [P2] SPX chart controls are all under the 44 px touch minimum, on mobile and desktop alike
**Date:** 2026-08-07

### Symptom
Seven controls on the SPX desk chart are 29–31 px tall on a phone. A fingertip is ~44 px. These are
the controls that switch the member between GEX and VEX and between 0DTE / weekly / monthly
exposure — i.e. the ones that change what the whole panel means.

### Evidence
`live-ui-audit.cjs` hit-target report, live prod `/dashboard`, viewport **430x932**, 2026-08-07
14:04 UTC:

```
tinyTapTargets: [
  button"Indicators1"     117x31
  button"Replay session"   70x29
  button"GEX"              45x29
  button"VEX"              45x29
  button"0DTE"             47x29
  button"Weekly"           61x29
  button"Monthly"          68x29
]
horizontalOverflowPx: 0
```

The same seven appear in the 1600x1000 capture, plus the site nav (`Features▾` 102x36, `FAQ` 61x36,
`Learn` 71x36) and the TradingView attribution link (`a"Charting by Tradin"` 35x19).

Every one of them is short in the **height** axis only — widths are already ≥ 44 px.

### Suggested fix
This is the exact shape #1848 solved for Helix and Thermal: a coarse-pointer-only, absolutely
positioned transparent `::after` centred on the control, so the hit area reaches 44x44 without the
box growing and shoving its neighbours in a dense row. Reuse the existing `.tap44` utility rather
than inventing a second mechanism, and measure with the **hit-test** probe (`elementFromPoint` at
the four corners), not `getBoundingClientRect()` — #1848 records that the rect-based measurement
reports the correct fix as a total no-op.

**Deliberately leave alone:** the widths (already compliant) and the mouse/fine-pointer case — a
29 px control is a fine mouse target and a 44 px invisible box there would steal hovers from
neighbours.

### Status
**OPEN — verified still open in code 2026-08-22 at `963c8448`.** The `.tap44` utility this entry
asks for exists (`src/app/globals.css:20195`, coarse-pointer-only `::after`), but **no SPX
component references it** — its only consumers are Helix (`HelixMobileFlowTape`, `HelixFlowTable`,
`TickerDrawer`). The suggested fix is still exactly right and still unapplied.

---

## [P2] The desk lane's price and gamma flip go stale for tens of seconds while every other lane moves
**Date:** 2026-08-07

### Symptom
The header tiles fed by `/api/market/spx/desk` (`Γ FLIP`, `GEX`, `MAX PAIN`, `TREND`) can sit on a
value for the better part of a minute while the price tile, the chart and the Pin Forecast panel —
fed by `/pulse`, `/flow` and `/pin` — all move. On a 0DTE desk this reads as "the regime hasn't
changed" when it may have.

### Evidence
Same-instant probe of all four lanes, three rounds ~20 s apart:

```
                       pin       desk      flow      pulse
14:00:01Z  spot       7732.04   7730.71   7732.02   7732.40
14:00:19Z  spot       7732.15   7730.71   7732.02   7733.17
14:00:40Z  spot       7734.50   7730.71   7734.80   7734.50
                                ^^^^^^^ frozen for the whole 39 s window

14:00:01Z  gamma_flip 7734.78   7725.42   7724.76
14:00:19Z  gamma_flip 7728.63   7725.42   7724.76
14:00:40Z  gamma_flip 7728.05   7725.42   7726.61
                                ^^^^^^^ frozen

14:00:01/19/40Z gex_net desk = 46952993202.26 (identical all three) ;
                        flow = 47606942180.69158 / 47606942180.69158 / 47184290984.3524
```

`desk.price` drifted 3.8 pts behind the live tape by the end of the window. `/desk` does carry
`polled_at` / `as_of` and `gex_age_ms` honestly (`gex_age_ms: 4619`, `gex_stale: false` on the
13:38 capture), so the staleness is *disclosed* in the payload — it is just not surfaced next to
the tiles it affects.

### Root cause
By design, partly: `/desk` serves from `peekSpxDesk()` / `loadSpxDesk()`, a single shared cache lane
(`src/app/api/market/spx/desk/route.ts:16-33`) deliberately shared with `/spx/play` and the admin
dashboard "so the member dashboard and the trade-alert panel can never diverge". The cache TTL for
that lane is what sets the freeze window; I did not measure the TTL constant, so **the specific TTL
is not yet traced**. What is confirmed is the observable: a ≥39 s freeze on `price` and
`gamma_flip` while three sibling lanes moved.

### Suggested fix
Do not shorten the shared cache blindly — its whole point is cross-panel consistency, and the
comment at `desk/route.ts:20-24` is explicit that splitting it caused a real divergence bug before.
Instead surface the age the payload already carries: badge the desk-fed header tiles with the same
staleness treatment `gex_stale` already drives, so a frozen `Γ FLIP` visibly reads as "as of 40 s
ago" rather than as current.

**Deliberately leave alone:** the single-cache-lane design, and `/pulse`'s independent fast lane —
the split is correct, the disclosure is what is missing.

### Status
**OPEN, and structural rather than a bug — superseded by `docs/spx/SLAYER-MAP.md` §2.** Confirmed
at `963c8448`: the desk lane is a 20s TTL (`SPX_DESK_CACHE_SEC`, `src/lib/providers/config.ts:19`)
**plus `staleWhileRevalidate`**, so a served value can be older than 20s — the TTL governs when a
refresh STARTS, not how stale a response may be. The header tiles ride this lane while price/chart/
pin ride the 1s/2s/1s lanes.
The map records a second consequence this entry did not reach: `/merged` and `/bootstrap` cache at
20s while CONTAINING the 1s pulse, so any consumer reading pulse fields off the merged bundle
inherits 20× staleness silently. The dashboard avoids it by convention, not by constraint.

---

## [P2] Intel tab opens to ~200 px of dead space above the fold on mobile
**Date:** 2026-08-07

### Symptom
Tapping **Intel** on a phone renders an empty band roughly 200 CSS px tall between the
`Vector | Matrix | Intel` tab bar and the `⚡ PULSE / LARGO` segmented control. On a 932 px-tall
viewport that is ~21 % of the screen showing nothing, and it pushes the first actual Pulse event
card to the very bottom of the fold.

### Evidence
Live prod render, `/dashboard`, 430x932, iPhone UA, Intel tab clicked, captured 2026-08-07
14:13 UTC (`spxtab-intel.png`). The tab bar bottom edge and the `⚡ PULSE / LARGO` control are
separated by a fully empty region; the first event card (`🧱 WALL 7,715P wall dissolving`) starts
below it. The panel itself rendered fine — four live event cards with fresh timestamps
(`14:13:26`, `14:13:21` ×3) and correct values. So the content is present; the space above it is
the defect.

The same gap is **not** present on the Vector or Matrix tabs in the same session, which rules out
the header/tab-bar chrome as the cause.

### Root cause
**Not yet traced.** Most likely a reserved slot for a component that renders nothing in this state
(`SpxDashboard.tsx:334-356` wraps `SpxIntelRail` in a `SpxPanelErrorBoundary` alongside sibling
content), but I did not confirm it against the computed layout and will not guess.

### Suggested fix
Localise with `live-ui-audit.cjs` by dumping the bounding boxes of the tab bar's next siblings on
the Intel tab; whatever occupies that band either has no content (and should collapse) or has a
fixed min-height that is not earning it.

**Deliberately leave alone:** the Pulse rail itself — content, timestamps and filter chips
(`ALL / REGIME / WALLS / FLOW / MACRO / PLAYS`) all rendered correctly and live.

### Status
**UNVERIFIED at `963c8448` — needs a live render.** Same treatment as the mobile-collision entry
above: a layout measurement cannot be confirmed from source. Closed by work-list item 5 in
`docs/spx/SLAYER-MAP.md` §8.

---

## [P3] The pin temporal-stability gate never fires — `pinConfirmed` tracked `pin` on 16/16 polls
**Date:** 2026-08-07

### Symptom
No member-visible breakage. But `spx-pin-stability.ts` exists specifically so the surfaced pin is
"held steady across noisy polls in between", and in live RTH it held nothing: the number the UI
headlines moves on every single poll, exactly as it did before the gate was added.

### Evidence
`/api/market/spx/pin`, 12 consecutive polls ~2.5 s apart (14:00:55 → 14:01:27 UTC) plus 4 polls
3 min apart (13:49 → 13:58):

```
14:00:55.755  pin=7728.79  pinConfirmed=7728.79  pinStable=true
14:00:58.331  pin=7729.75  pinConfirmed=7729.75  pinStable=true
14:01:00.766  pin=7729.84  pinConfirmed=7729.84  pinStable=true
...  (12/12 identical pattern)
14:01:27.353  pin=7728.77  pinConfirmed=7728.77  pinStable=true
```

`pinConfirmed === pin` on **all 16 observations**, `pinStable === true` on all 16. Over the wider
window the "confirmed" pin still travelled 7721.33 → 7731.15 (**+9.8 pts in 6 minutes**), i.e. well
beyond the 5-point tolerance the gate is calibrated on — it just never travelled 5 points *within
one 3-sample window*.

### Root cause
`PIN_STABILITY_WINDOW = 3` at `SPX_PIN_POLL_MS` (5 s) means the gate asks "did the pin move more
than one strike in 15 seconds". At observed intraday drift (~1.6 pt/min) the answer is
structurally always no, so `isPinStable()` returns true continuously and
`pinStabilityConfirmed` is overwritten with the raw pin every pass
(`spx-pin.ts` `trackPinStability`, `if (stable) pinStabilityConfirmed = …`). The gate catches only
a *discontinuous* >5 pt single-poll jump — a real failure mode, but not the "flicker" the module
header describes.

Second, structural: the window is **module-level, per-process** (`spx-pin.ts:57-60`,
`let pinStabilitySamples`). Production web runs more than one ECS task, so a member polling every
5 s round-robins across replicas and each replica's "last 3 consecutive polls" actually span
3xN x 5 s of wall clock — the tolerance is being applied over a window several times longer than
it was calibrated for, and each replica carries its own `pinConfirmed`. I could **not** confirm the
replica count from this sandbox (AWS creds here are placeholders), so this half is reasoned from the
code, not measured.

### Suggested fix
Decide what the gate is for and calibrate to it. If it is anti-flicker, the window must span a
meaningful slice of session time (e.g. 30–60 s of samples), and the state must be shared —
the Redis lane the desk already uses — not per-replica. If it is only meant to catch discontinuous
jumps, say so in the module header and drop the "held steady across noisy polls" claim, because as
written the comment describes behaviour the code does not produce.

**Deliberately leave alone:** the pure helpers (`isPinStable` / `pushPinSample`) — they are correct
and well tested; this is a calibration and state-scope question, not a logic bug.

### Status
**OPEN, UNCHANGED — verified in code 2026-08-22 at `963c8448`.** Every element of the root cause
still stands verbatim: `src/features/spx/lib/spx-pin.ts:55-57` still holds the window in
module-level per-process state, `trackPinStability` at line 67 still overwrites
`pinStabilityConfirmed` with the raw pin on every pass where `stable` is true, and the window is
still 3 samples. The calibration question this entry raises — anti-flicker vs discontinuous-jump —
has not been answered, so the module header still describes behaviour the code does not produce.

---

## [P3] Analytic and Monte-Carlo cones plot different quantities on the same axes
**Date:** 2026-08-07

### Symptom
The Pin Forecast chart's analytic cone starts at full width at "now", where the price is known
exactly; the Monte-Carlo cone starts at a point and bulges. If both are drawn on one chart a member
reads two incompatible shapes as one uncertainty band.

### Evidence
One `/api/market/spx/pin` response, 13:38:41Z, spot 7738.5, `timeToCloseMin` 382:

```
analytic cone[0]  tMin 382  p10 7698.11  p50 7738.50  p90 7778.89   width 80.78
analytic cone[26] tMin   0  p10 7709.43  p50 7714.28  p90 7719.13   width  9.70

mc cone[0]        tMin 382  p10 7738.50  p50 7738.50  p90 7738.50   width  0.00
mc cone[1]        tMin 367.3 p10 7730.73 p50 7738.28  p90 7745.49   width 14.76
```

The analytic band at `tMin = 382` is the distribution **of the close**, conditional on being 382 min
out (`medianPath()` pairs `median[i]`, the drifting price at step i, with `sigmaRemain[i]`, the vol
remaining from step i **to the close**). The MC band at the same step is the distribution **of the
price at that time**. Both are internally coherent; they are not the same quantity.

### Root cause
By construction — `coneFromPath()` (`spx-pin-forecast-core.ts:473`) vs the empirical per-step
quantiles in `montecarlo()` (`spx-pin-forecast-core.ts:571-575`). Not a defect in either engine.
**I did not confirm whether the UI overlays them on one axis** — `SpxPinForecast.tsx` renders the
panel and I read the payload, not the plot. If it shows only one at a time this item is a
documentation nit; if it overlays them it is a real readability defect.

### Suggested fix
First confirm what the panel actually draws. If overlaid, label them distinctly ("close
distribution" vs "path distribution") or plot only the MC cone, which is the one whose shape matches
a member's intuition for a live forecast.

**Deliberately leave alone:** both cone constructions. The analytic cone's semantics are the reason
it pinches monotonically, which is the panel's whole point.

### Status
**NOT A DEFECT — CLOSED. The check this entry asked for has now been done.** It said: *"I did not
confirm whether the UI overlays them on one axis … If it shows only one at a time this item is a
documentation nit."* It shows one at a time. `SpxPinForecast.tsx:22` is a
`useState<"analytic" | "montecarlo">` toggle; `buildChart` receives a single `cone` array
(line 50); the caption at line 106 names which construction is on screen. The two cones are never
drawn on one axis, so the member-facing readability defect this entry hypothesised does not exist.
The underlying observation — that the two cones plot different QUANTITIES — remains true and is
correctly documented here as by-construction.

---

## [P3] Browser console showed 411 / 502 / ERR_CONNECTION_FAILED on `/dashboard` — NOT reproduced, recorded so it is not lost
**Date:** 2026-08-07

### Symptom
Three `502 Bad Gateway` and two `411 Length Required` console errors during the mobile render of
`/dashboard`.

### Evidence
`live-ui-audit.cjs`, `/dashboard`, 430x932, 2026-08-07 14:04 UTC:

```
consoleErrors: [
  "Failed to load resource: the server responded with a status of 411 (Length Required)",
  "Failed to load resource: the server responded with a status of 502 (Bad Gateway)",   x3
  "Failed to load resource: net::ERR_CONNECTION_FAILED"
]
pageErrors: []   selfRedirects: 0
```

**Counter-evidence — I could not reproduce any of it.** Direct GET sweep of every endpoint the
dashboard calls, **3 rounds** at 14:04:12 / 14:04:33 / 14:04:59 UTC — i.e. overlapping the render
window:

```
200 /api/market/spx/{pin,pulse,desk,flow,play,merged,power-hour,signals,outcomes,bootstrap,journal}
200 /api/market/gex-heatmap?ticker=SPX
200 /api/market/vector/walls?ticker=SPX&dte=0dte
200 /api/market/vector/gex-heatmap?ticker=SPX&dte=0dte
405 /api/market/spx/commentary        <-- expected: POST-only route, GET is correctly 405
```

33/33 GETs returned 200. The 411s are almost certainly the audit transport (a POST replayed through
the manual CONNECT tunnel without a `Content-Length`), and the 502s most likely the SSE lanes
(`/api/market/spx/pulse/stream`, `/api/market/flows/stream`) which the tunnel cannot hold open and
which are logged separately as `FAIL … timeout`.

### Root cause
**Not traced, and possibly not a product bug at all** — the evidence points at the audit harness's
transport, not the app. Recorded rather than dismissed because I cannot prove that from here.

### Suggested fix
Re-check from a real browser (or from the app's own error telemetry for `/dashboard`) before
spending any engineering time. If the 502s appear there too, they are real and this becomes a P1;
if not, close it.

### Status
**UNVERIFIED at `963c8448`, as originally recorded.** This entry was filed explicitly as
not-reproduced so the observation would not be lost, and nothing since has reproduced it. A source
read cannot confirm a transient network status. It stays recorded, not open and not closed.

---

# GREEN — verified correct, with numbers

Recording these so they need not be re-checked tonight.

### Prices, session extremes and prior close — GREEN
`/api/market/spx/pulse` and `/api/market/spx/desk` vs Polygon `I:SPX` / `I:VIX`, 13:38–13:46 UTC.
Everything except the change% (the P0 above) matched:

| Field | App | Polygon | Δ |
|---|---|---|---|
| SPX price | 7738.75 | 7738.38 | 0.37 pt (0.005 %) |
| prior_close | 7709.96 | 7709.96 | **exact** |
| hod | 7742.63 | 7742.63 | **exact** |
| lod | 7731.50 | 7731.50 | **exact** |
| VIX | 15.20 | 15.19 | 0.01 |
| gap_pct / gap_source | 0.33 / SPX | (7735.18−7709.96)/7709.96 = 0.327 | 0.003 |

Across 8 further paired polls the app's SPX price never diverged from Polygon by more than 2.7 pt
(0.035 %), and that only during fast ticks. `market_status: "open"`, `market_label: "RTH OPEN"`,
`feed_stalled: false`, `price_age_ms: null`, `active_halts: []`, `data_quality.missing: []`
throughout.

### Max pain (desk lane) — GREEN, exact
`desk.max_pain = 7630` on every poll. Independently computed from the full Polygon SPXW 2026-08-07
chain (336 contracts, strikes 7275–8205, spot 7739.37 @ 13:48:13Z), OI-only definition: **7630**.
Exact match.

### GEX king strike — GREEN, exact
`desk.gex_king = flow.gex_king = 7750` on every poll. My top-|net GEX| strike over the same chain:
**7750 (2.94 B)**, with 7775 / 7740 / 7730 / 7760 next — the same neighbourhood the desk's
`gex_walls` ladder ranks.

### `gex_walls` geometry — GREEN
13:38:20Z, desk price 7737.74. Ladder: 8000 / 7760 / 7755 / 7750 / 7745 / 7740 (`resistance`) then
7735 / 7730 / 7725 / 7720 (`support`). `distance_pts` is internally exact — `8000 − 7737.74 =
262.26` matches the served `262.26`, and every other row checks out. Support/resistance labelling
correctly follows above/below spot.

### Pin forecast cone pinches, and its vol input is real — GREEN
One 13:38:41Z response: cone width **80.78 pts at tMin 382 → 9.70 pts at tMin 0**, monotonically
decreasing across all 27 steps. Back-solving the implied σ from the served band
(`(p90−p50)/1.2816` at step 0) gives an ATM IV of **0.1511**; the true ATM IV I computed from the
Polygon chain at the same time was **0.1533**. The cone width is grounded in real implied vol, not a
fallback guess — consistent with `ivFallback: false` in the payload.

### Pin moves intraday and the chart agrees with the API — GREEN
```
13:49:07  spot 7736.47  pin 7721.33  tMin 371  cone 80.94 -> 9.71
13:52:08  spot 7743.91  pin 7728.51  tMin 368  cone 75.74 -> 9.09
13:55:08  spot 7743.67  pin 7731.15  tMin 365  cone 68.94 -> 8.27
13:58:09  spot 7730.50  pin 7730.00  tMin 362  cone 75.00 -> 9.00
```
The pin tracks spot rather than freezing (the 2026-07-29 "projected close frozen 120 pts below spot"
failure mode is not present), and `tMin` decrements correctly in real time. The desktop chart
overlay captured at ~13:51 read `Pin 7,728 / 7728.20` — matching the 13:52:08 API value 7728.51.
Chart and API are the same number.

### PR #1851 (`horizonMin` / `structYears` became optional) — NO behaviour change, GREEN
The stated risk was that parameterising the two roles of `RTH_MIN` would move the SPX numbers.
It did not. `charmState` requires `tFrac > 0.55` for `"early"`, i.e. `tMin > 214.5` at the default
`horizonMin = 390`; every observed sample from `tMin 382` down to `tMin 357` correctly read
`"early"`, and `tFrac` is the only thing #1851 could have perturbed on the SPX path. The default
resolution (`spx-pin-forecast-core.ts` `prepare()`:
`input.horizonMin != null && input.horizonMin > 0 ? input.horizonMin : RTH_MIN`) is a pure
fall-through, no SPX caller passes either field (`grep` across `src/`: the only references are the
core file itself), and the cone's per-step progress now measures against `p.horizonMin`, which
equals `RTH_MIN` for every SPX call. Live numbers are consistent with the pre-#1851 model
throughout. **I could not observe the early→moderate→accelerating transitions** (they land at
~12:26 and ~14:23 ET, after my window) — see "Not covered".

### 0DTE option ticket on `/play` — GREEN, cross-checked contract-for-contract
`/api/market/spx/play` at 13:38:29Z offered `O:SPXW260807C07760000`. Polygon snapshot of that exact
contract:

| Field | App | Polygon | |
|---|---|---|---|
| expiration_date | 2026-08-07 | 2026-08-07 | exact |
| strike | 7760 | 7760 | exact |
| open_interest | 2844 | 2844 | **exact** |
| delta | 0.30 | 0.2893 | ok |
| gamma | 0.01 | 0.00882 | ok (2 dp) |
| implied_volatility | 0.15 | 0.1478 | ok |
| bid/ask | 7.40 / 7.60 | 7.10 / 7.20 (2 min later) | plausible drift |

`spread_pct: 2.67` is arithmetically correct for 7.40/7.60. It is a real, tradeable, live 0DTE
contract — not a synthesised ticker.

### Play geometry — GREEN
13:38:29Z, spot 7738.5: `entry 7739.1`, `stop 7732`, `target 7751.1`, invalidation
`"Below 7732 (GEX support wall − 3pt)"`. Risk 7.1 pt, reward 12.0 pt, **R:R 1.69**. The stop is
anchored 3 pt under the 7735 GEX support wall that `/desk`'s `gex_walls` actually served in the same
poll — the levels are attached to live structure, not stale constants. `mtf` honestly reported
`ok: false` with a specific reason (`"3m close 7735.96 below level 7736.85"`) rather than silently
passing, and `phase: SCANNING` / `signal_committed: false` matched the un-met gates.

### Power Hour — GREEN (correct closed state)
`/api/market/spx/power-hour` at 13:38:37Z (09:38 ET) returned `phase: "NONE"` with
`"Outside power hour window (2:45–3:15 PM ET)"` and every price field `null` — no fabricated
levels outside the window. `target_pts: 13` / `stop_pts: 4` are static config, correctly not
dressed up as live prices.

### Endpoint availability — GREEN
33/33 authenticated GETs returned 200 across three rounds (see the P3 item above for the list).
`/api/market/spx/commentary` correctly 405s on GET (POST-only). No 5xx, no self-redirects, and
`pageErrors: []` on both renders.

### Layout overflow — GREEN
`horizontalOverflowPx: 0` at both 430x932 and 1600x1000. DOM 11,722 / 11,815 nodes,
`h1Count: 1`, `lang: en`, `title: "SPX Slayer · BlackOut"`, and **zero** unlabeled controls, zero
unlabeled inputs, zero images missing alt, zero heading-order jumps on both viewports.

### Malformed-number scan — GREEN on 10 of 11 endpoints
See the P1 item: `/pin`, `/pulse`, `/desk`, `/bootstrap`, `/merged`, `/play`, `/outcomes`,
`/signals`, `/power-hour`, `/gex-heatmap?ticker=SPX` were clean on all 4 polls. Only `/flow` was
dirty.

---

# Not covered — say so rather than guess

1. **Session-phase states other than "open, first 90 minutes".** Everything above was captured
   09:38–11:05 ET. I did not observe pre-open, midday, the `charmState` early→moderate (~12:26 ET)
   and moderate→accelerating (~14:23 ET) transitions, power hour (14:45–15:15 ET), the close, or
   post-close. The charm thresholds are verified *arithmetically* against the code
   (`tFrac > 0.55` / `> 0.25`) and the observed `"early"` at `tMin 382…357` is consistent, but the
   transitions themselves were **not observed live**.
2. **True desktop rendering.** `proxy-browser.cjs` / `live-ui-audit.cjs` pin an iPhone UA
   (`BlackOutiOSApp/1.0`) regardless of viewport, so the 1600x1000 capture is the *mobile shell at
   desktop width*. It showed a large empty left half — I am **not** reporting that as a bug, because
   I cannot separate it from the UA pinning. A desktop-UA capture is needed.
3. **The un-entitled / lower-tier view.** `/dashboard` requires `requireTier("community")` and my
   temp user was admin+premium. I did not capture what a community-tier or logged-out member sees.
4. **Degraded and empty states.** `degraded: false`, `ivFallback: false`, `data_quality.missing:
   []`, `active_halts: []` and `feed_stalled: false` throughout — the desk never entered a degraded
   state while I watched, so the degraded rendering path is untested here.
5. **SSE (`/api/market/spx/pulse/stream`).** WebSocket/SSE cannot be held open through the agent
   proxy; both renders logged it as `FAIL … timeout`. I read the route source
   (shared module-level poller, O(1) Redis) but did **not** exercise it live. Note the P0 above
   flows through this stream too, since it serves the same `spx:pulse:snapshot`.
6. **The Redis pulse-snapshot writer.** Raw Redis/Postgres are blocked here. I could not inspect
   `spx:pulse:snapshot`'s contents directly and therefore could not confirm *which* writer sets the
   bad `change_pct` anchor — only that the app-side lane accepts it without the guard its sibling
   applies.
7. **ECS replica count** (needed to size the per-process pin-stability concern) — sandbox AWS creds
   are placeholders.

---

# Scratch files I created (do not commit)

All under `/tmp` — nothing left in the repo working tree except this file:
`/tmp/spx-tabs.cjs`, `/tmp/mint.mjs`, `/tmp/ck.txt`, and
`…/scratchpad/{spx-probe,pulse-anchor,pin-timeline,spx-gt,wide-scan,coherence,drivers,ep-sweep}.mjs`
plus `spx-desktop.png`, `spx-mobile.png`, `pin-timeline.jsonl`.
`.tmp-ui-probe.cjs` in the repo root is **not** mine.
