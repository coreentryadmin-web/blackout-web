## 2026-09-12 — [FINDING, P2 product-quality/trust] Four Ask Largo swing-brief sections rendered TODAY's live market data for a CLOSED position with zero "as-of" disclosure

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (trust — not a wrong number, but a closed-position post-mortem brief silently presenting current market data as if it described the trade's own conditions) |
| **Area** | `src/lib/swing/play-brief-intel.ts` — `chartTechnicalsSection`, `chartLevelsSection`, `gexPostureSection`, `wallDynamicsSection` |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — 2026-09-12 cycle, live `GET /api/market/swing/play-brief` audit |

### What was found

Live `GET /api/market/swing/play-brief?playId=SWING:AAPL:36&ticker=AAPL&positionId=36&status=CLOSED`
(2026-09-12) — a real closed AAPL swing position (327.5C, closed **2026-09-04 09:45 ET**, -56.2%
stopped) — rendered, 8 days after the trade closed and with no framing whatsoever:

```
## Chart technicals
Spot: 332.58
EMA 9/21/50 stack: down
VWAP 333.37 — price below session VWAP
RSI: 52
MACD: bull
...

## Levels on chart
Call wall (GEX): 340.00 — +2.2% ...
Put wall (GEX): 332.50 — -0.0% ...
Gamma flip: 323.17 — -2.8% ...
...

## GEX posture
Gamma posture: dealers long gamma — dips tend to get bought, range/pin behavior
Net GEX: 1632.7M
...
```

All of these are **today's live numbers** (spot 332.58 as of the 2026-09-12 read), not the market
conditions this already-closed position actually traded under. Nothing in any of these four
sections says so — a member reviewing a "what did we learn" post-mortem brief has no way to tell
these are current-market noise, not historical fact, and could easily read "Chart technicals:
Spot 332.58" as describing the trade itself.

The SAME envelope already carries the fix for this exact defect class in three other places,
proving it is a known, deliberate contract (Largo identity/freshness, C1/C2) that these four
sections simply never received:
- `vectorDeskSection`'s closed-bucket branch: "Current Vector read: grade A · conviction 77
  **(since this play closed)**" — forced neutral bias, no live directives.
- `watchForSection`'s closed-bucket branch (its own title becomes "Since it closed"): "Now trades
  332.58 vs gamma flip 323.17 — **where the dealer regime sits since this play closed**".
- `dataFreshnessSection`'s `isClosed` gate (fixed the same day, per that section's own comment):
  scan/Vector/GEX/HELIX staleness lines are suppressed entirely once a play is CLOSED, because
  "today's data is stale" stops being a meaningful claim about a historical record.

`chartTechnicalsSection`, `chartLevelsSection`, `gexPostureSection`, and `wallDynamicsSection` were
the one place this bucket-awareness was missed — they render unconditionally regardless of
`bucket`, duplicating (unlabeled) the exact spot/gamma-flip/wall numbers `watchForSection`'s
"Since it closed" section already discloses honestly a few sections later in the same brief.

### Root cause

`buildIntelSections` (the section assembler) already threads `bucket: "watch"|"open"|"closed"`
into `tradeManagerNarrativeSection`, `vectorDeskSection`, and (via `ctx.play`) `watchForSection` —
but called `chartTechnicalsSection(vec, ctx.sessionDate)` and `wallDynamicsSection(vec,
ctx.sessionDate)` with no bucket argument at all (the functions didn't accept one), and
`chartLevelsSection(ctx)` / `gexPostureSection(ctx)` — which DO receive the full `ctx` (and
therefore `ctx.play`) — never checked `statusBucket(ctx.play)` despite every other section in the
file doing exactly that for the identical reason.

### Blast radius

Every CLOSED-bucket swing play brief (`status=CLOSED`), for every swing position that ever
resolves — i.e. this fires on every real historical trade a member reviews, not an edge case.
`chartTechnicalsSection` additionally forced a directional bias badge (bullish/bearish) from
today's technicals onto a closed position's envelope-level bias field, the same "live guidance on
an already-resolved trade" violation `vectorDeskSection`'s comment already documents for its own
old behavior.

### Fix

- `chartTechnicalsSection(vec, sessionDate, bucket = "open")` — new optional third param
  (default preserves every existing call site's behavior exactly). When `bucket === "closed"` and
  the section has real content, prepends `"_Current chart read — not the technicals this trade
  closed under._"` and forces `bias: "neutral"`. Content is computed BEFORE the disclosure is
  added so a genuinely-empty section still returns `null` rather than a disclosure with nothing to
  disclose.
- `wallDynamicsSection(vec, sessionDate, bucket = "open")` — same shape: `"_Current wall activity
  — not what this trade traded under._"` prepended only when there are real wall events to show.
- `chartLevelsSection(ctx)` / `gexPostureSection(ctx)` — no signature change needed (both already
  receive `ctx`); each now checks `statusBucket(ctx.play) === "closed"` internally and prepends
  `"_Current levels — not what this trade traded under._"` / `"_Current dealer posture — not what
  this trade traded under._"` respectively, again only after confirming real content exists.
- `buildIntelSections` now passes `bucket` through to `chartTechnicalsSection` and
  `wallDynamicsSection` (the two that needed the new param); the other two already had what they
  needed via `ctx`.

Deliberately NOT suppressing these sections entirely for closed plays: `chartTechnicalsSection`
carries fields (RSI, MACD, structure, golden pocket) that `watchForSection`'s narrower "Since it
closed" section doesn't cover, so dropping the section would lose real information a member
reviewing the setup's current state might want — the fix discloses instead of hides, matching
`vectorDeskSection`'s own precedent (kept the grade/conviction line, added the caveat) rather than
`dataFreshnessSection`'s (suppressed entirely) — the right choice depends on whether the
information has any residual value once disclosed, and here it does.

### Tests

`src/lib/swing/play-brief-intel.test.ts` — five new tests:
- `gexPostureSection: CLOSED bucket prefixes a current-not-as-traded disclosure` (+ open-bucket
  unchanged check)
- `chartLevelsSection: CLOSED bucket prefixes a current-not-as-traded disclosure` (+ open-bucket
  unchanged check)
- `chartTechnicalsSection: CLOSED bucket prefixes a current-not-as-traded disclosure and forces
  neutral bias` (+ default-arg and open-bucket unchanged checks)
- `chartTechnicalsSection: CLOSED bucket returns null rather than a disclosure-only section when
  there is no real content`
- `wallDynamicsSection: CLOSED bucket prefixes a current-not-as-traded disclosure` (+ default-arg
  and open-bucket unchanged checks)

Verified RED before the fix (`git stash` on `play-brief-intel.ts` only, keeping the new tests):
4 failing / 100 passing. GREEN after: 104/104. Full existing suite for this file (99 pre-existing
tests) unaffected — every pre-existing call site relies on the new params' default value
(`"open"`), so behavior for watch/open buckets is provably unchanged.

`npx tsc --noEmit` clean; full `npm test` (Node 20) run alongside this change.
