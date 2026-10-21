## 2026-10-21 — [FINDING, swing] "Since flag" (trackPct) in Watch levels is dead code for every real WATCH/SKIP candidate — Ask Largo round-3 deep-dive

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (a 2026-10-20 fix was functionally inert for its target population) |
| **Surface** | `src/lib/swing/serving-lane.ts` — `enrichPlay()`; `src/lib/swing/legacy-confirm-promote.ts` — `buildLegacySwingArtifacts()`'s `enrichedPlay` |

### Root cause

`watchForSection`'s "Since flag" bullet (`play-brief-intel.ts`, added 2026-10-20 citing a live TSLA
WATCH repro) renders `trackPct`, computed in `adapters.ts`'s `terminalPlayFromHorizon`:

```ts
const watchTrack = status === "WATCH" || status === "SKIP";
const trackPct = watchTrack ? watchUnderlyingTrackPct(src.direction, flagPx, src.liveSpot ?? null) : null;
```

`src.liveSpot` (`HorizonPlay.liveSpot`) had exactly one real writer anywhere in the repo:
`live-plays.ts`'s `livePlaysFromOpenPositions`, which only ever runs for **committed** ledger rows
(status OPEN/HOLD/TRIM). That status set is mutually exclusive with WATCH/SKIP, so `trackPct` was
structurally always `null` for every genuine pre-entry WATCH/SKIP candidate — the entire population
the 2026-10-20 fix was built for. The fix shipped a correct render branch pointed at a field nothing
upstream of it had ever populated for that bucket.

Two distinct pre-entry origins both had the gap: `serving-lane.ts`'s `enrichPlay()` (organic
discovery) and `legacy-confirm-promote.ts`'s `buildLegacySwingArtifacts()` (Legacy-morning-confirm
promotion) — neither ever set `.liveSpot` on the play it returns.

### Evidence

Live TSLA WATCH envelope (SHORT 400P, no positionId): "Watch levels" showed "Flag anchor:
**374.61**" immediately followed by "Entry trigger: **373.71**" with no "Since flag" line between
them, even though the same envelope's GEX/trade-manager-read section reported a fresh live spot of
380.45 — a real, computable (380.45-374.61)/374.61 ≈ +1.56% raw move (-1.56% signed for a SHORT),
exactly the figure the feature was built to surface, silently absent.

Confirmed via exhaustive repo-wide grep: the only `liveSpot:` assignment to a
`HorizonPlay`/`HorizonDeckSource` anywhere in `src/` was `live-plays.ts:675`
(`livePlaysFromOpenPositions`, status OPEN/HOLD/TRIM only). The feature's own regression test
(`play-brief-intel.test.ts`) and `adapters.test.ts`'s WATCH fixture both proved the render logic
correct only by injecting `trackPct`/`liveSpot` directly on a hand-built fixture — a shape that
never occurs via real production wiring — so neither test exercised the real `enrichPlay`/
`buildLegacySwingArtifacts` path that was actually broken.

Added two new tests exercising the REAL production wiring (not hand-built fixtures):
- `serving-lane.test.ts` — `getSwingServingLane` end-to-end with a real `readsByTicker` map, asserting
  the rendered WATCH play carries a non-null `liveSpot` equal to the live scan spot.
- `legacy-confirm-promote.test.ts` — `buildLegacySwingArtifacts`, asserting `liveSpot` equals the
  `groundedSpot` the play's plan levels were built from.

RED→GREEN: 22/23 pass (serving-lane.test.ts) and 27/28 pass (legacy-confirm-promote.test.ts) before
the fix (the new assertions failing on `liveSpot: undefined`); 51/51 combined, plus 621/621 on the
broader `adapters.test.ts`/`play-brief-intel.test.ts`/`play-brief.test.ts` regression sweep, after.

### Blast radius

Confirmed `liveSpot` has exactly one OTHER consumer in `adapters.ts` (`liveSetupState`/
`liveEntryStatus`, the committed-row persistence/entry-geometry pillar derivation) — both gated on
`working` (`status === "OPEN" || "HOLD" || "TRIM"`), mutually exclusive with the WATCH/SKIP status
this fix populates `liveSpot` for. So setting `liveSpot` for the WATCH/SKIP population cannot affect
those derivations; the only reachable consumer for the newly-populated rows is `trackPct` itself.

### Fix

- `serving-lane.ts`'s `enrichPlay()`: add `liveSpot: reads?.setup?.price ?? play.liveSpot ?? null` —
  `reads.setup.price` is already the live-or-last-known spot this same function uses to derive
  `setupState`/`entryStatus` for the identical row, so this is purely forwarding data already in
  hand, no new fetch.
- `legacy-confirm-promote.ts`'s `enrichedPlay`: add `liveSpot: groundedSpot` — `groundedSpot` is
  already computed a few lines above to build this play's plan levels.

### Why not a bigger fix

Deliberately left `flagUnderlyingPx` (the pinned flag ANCHOR) untouched — its own comment
("WATCH track anchor: pinned first-flag price only — never the live scan spot") is a different,
correct invariant for a different field; `liveSpot` is the separate, current-price field "Since
flag" measures movement FROM that anchor, and the two must not be conflated.
