## 2026-10-21 — [FINDING, swing] WATCH-bucket "Since flag" % computed off a cron-cached spot snapshot, disagreeing with the Spot the same brief prints elsewhere

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (Largo C9 precision — the brief's own disclosed numbers don't reconcile against each other) |
| **Surface** | `src/lib/swing/play-brief-intel.ts` — `watchForSection()`'s "Since flag" line |

### Root cause

`watchForSection` renders `play.trackPct` for "Since flag" — a value computed far upstream, in
`command-deck/adapters.ts`'s `terminalPlayFromHorizon`:

```js
const trackPct = watchTrack
  ? watchUnderlyingTrackPct(src.direction, flagPx, src.liveSpot ?? null)
  : null;
```

`src.liveSpot` traces through `serving-lane.ts`'s `enrichPlay()` (`liveSpot: reads?.setup?.price ??
play.liveSpot ?? null`) to `swingServingReadsFromPlan`'s `spot` argument, which ultimately reads
the **persisted** `SwingServingSnapshot.spotsByTicker` map. That map is written by exactly two
crons: `swing-discovery` (one pre-market scan per session day) and `swing-active-refresh`
(`market_hours_only: true`, every 15 min — only during RTH, per `cron-registry.ts`). Before the
9:30 ET open, `spotsByTicker` still holds the morning's one pre-market snapshot.

Meanwhile, `watchForSection` *itself* independently resolves a fresh current spot a few lines
above (`const spot = (vectorStale ? undefined : vec?.spot) ?? (gexStaleForSpot ? undefined :
gexForSpot?.spot) ?? null`), fetched fresh per-request via Vector/GEX — and prints that exact value
elsewhere in the same section (e.g. "Now trades **X** vs gamma flip **Y**"), and the same spot is
also what Chart technicals shows as "Spot". So pre-open, this one brief carries two different
numbers both implicitly claiming to be "the current spot," and "Since flag" was computed from the
staler one with no disclosure of the mismatch.

### Evidence

Live repro (SHOP WATCH play-brief, Ask Largo deep-dive, 2026-10-21, ~07:15 ET — before the 9:30
open, so `swing-active-refresh` had not run yet that day):

```
Flag anchor: **177.70** — track move from here
Since flag: **-2.4%**
Entry trigger 177.70 — pinned at Legacy promotion, not refreshed since, thesis still forming
...
Spot 173.72   (Chart technicals section, same brief)
```

Recomputing `(173.72 - 177.70) / 177.70 = -2.24%`, which rounds to **-2.2%** at the brief's own
1-decimal precision — not the displayed **-2.4%**. For -2.4% to be exact, spot would need to be
≈173.44, not the 173.72 printed twice elsewhere in the identical brief. The ~$0.28 underlying gap
is consistent with the ~2-hour-old pre-market scan snapshot vs. the fresh per-request Vector/GEX
read, not rounding noise.

Added two tests to `play-brief-intel.test.ts`: one RED repro matching the live SHOP shape (fresh
GEX spot 173.72 vs. a stale `play.trackPct: -2.4` derived from flag 177.70 — asserts the section
now shows -2.2%, not -2.4%), one control confirming the prior fix's behavior is preserved when no
fresh spot is available at all (falls back to the cron-cached `play.trackPct`). RED→GREEN
confirmed: new test failed against the pre-fix source (`'Since flag: **-2.4%**'` asserted against
`/-2\.2%/`), passes after the fix. Full regression: `src/lib/swing/play-brief-intel.test.ts`
315/315 pass; broader sweep `src/lib/swing/play-brief*.test.ts` 1123/1123 pass. `tsc --noEmit`
clean.

### Blast radius

Single call site — `watchForSection` is the only renderer of "Since flag" that fires for a real
WATCH/SKIP play (the sibling `pnlSection` copy in `play-brief.ts` is structurally dead for this
bucket, per the 2026-10-20 "trackPct dead code" fix already in `FINDINGS.md`). `play.trackPct`
itself is left untouched — it still feeds the live board card ("Since flag" badge on the deck row)
unchanged; only this one Largo-brief rendering now prefers a fresher, reconciled number when one is
available.

### Fix

Recompute "Since flag" inside `watchForSection` from the section's own already-resolved fresh
`spot` (vector-then-GEX fallback, same value the section already prints elsewhere) paired with the
pinned `play.flagUnderlyingPx`, via the existing pure `watchUnderlyingTrackPct` helper
(`src/lib/zerodte/watch-track.ts` — already used upstream for the original computation, so no new
math, just a different, fresher spot input). Falls back to the original cron-cached `play.trackPct`
only when no fresh spot is available at all (both Vector and GEX stale/absent), preserving the
behavior the 2026-10-20 fix established for that case.

### Why not a bigger fix

Did not touch the upstream `adapters.ts` computation or the `liveSpot`/`spotsByTicker` cron
pipeline — the live board card's "Since flag" badge legitimately wants a cheap, always-available
number without a per-render Vector/GEX fetch, and that tradeoff is reasonable for a board row. The
defect was isolated to the Largo brief specifically re-rendering that same stale value instead of
reconciling it against the fresher spot the brief composer already has in hand for this exact
section.
