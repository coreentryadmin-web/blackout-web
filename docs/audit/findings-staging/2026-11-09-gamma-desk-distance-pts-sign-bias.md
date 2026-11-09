# `topGexWalls`'s `distance_pts` had the same sign-bias rounding tie as fmtPct/shift-math/signPct — 9th confirmed instance

> **kind:** `FINDING`

### Summary
`gamma-desk.ts`'s `topGexWalls` builds each `GexWall`'s `distance_pts` (how far a GEX wall's
strike sits from spot, in points) with:

```ts
distance_pts: Math.round((lv.strike - spot) * 100) / 100,
```

`Math.round()` ties toward `+Infinity`: `Math.round(-262.5) === -262` but `Math.round(262.5) ===
263`. So a strike sitting exactly on a half-cent tie BELOW spot rounds to a *smaller* magnitude
(`-2.62`) than the mirror-image strike the same distance ABOVE spot (`+2.63`) — the identical
sign-biased asymmetry already found and fixed eight times in this codebase: `fmt-money.ts`'s
`fmtPct`, `round-floats.ts`, `shift-math.ts`'s `fmtShiftPercentForStrike`, `PlayTerminal.tsx`'s
`signPct`, `ZeroDteCommandPanel.tsx`'s own separate `signPct` (#7676), and `format.ts`'s Net VEX
line (#7678).

`distance_pts` is not merely an internal float — it is served straight into Largo's Night Hawk
positioning text with an explicit sign ternary (`src/features/nighthawk/lib/positioning.ts`:
`` `${role} $${w.strike} (${w.distance_pts >= 0 ? "+" : ""}${w.distance_pts}pts)` ``) and into
`largo-live-feed.ts`'s wall narration — both human-read "pts from spot" numbers a trader or Ask
Largo reads literally.

### Evidence
RED (before the fix), added to `src/lib/providers/gamma-desk.test.ts`:
```
spot = 7542.375
above = 7545     // 7545 - 7542.375 = 2.625 -> *100 = 262.5 (a tie)
below = 7539.75  // 7539.75 - 7542.375 = -2.625 -> *100 = -262.5 (the mirror tie)
```
Pre-fix: `distance_pts` for `above` = `2.63` (rounds away from zero, correct), for `below` =
`-2.62` (rounds TOWARD zero — wrong; should be `-2.63` to match the mirrored positive case).
Test run pre-fix: `16 tests, 1 fail` (`mirror-image ties must round to the same magnitude
regardless of sign` — `2.62 !== 2.63`). Post-fix: `16 tests, 0 fail`.

### Fix
Round by magnitude, then reapply sign — the exact pattern already established by the eight prior
fixes (`Math.sign(x) * Math.round(Math.abs(x) * factor) / factor`):
```ts
distance_pts: (Math.sign(lv.strike - spot) * Math.round(Math.abs(lv.strike - spot) * 100)) / 100,
```
Verified `strike === spot` still returns plain `0` (not `-0`): `Math.sign(0) === 0`, so the
product is `0`, never `-0` — no new display artifact introduced.

### Fix rationale
Matching the already-established, reviewed fix shape for this exact bug class (rather than
inventing a new one) keeps every "round a signed delta/points/percent value for display" call
site in this codebase consistent, and makes the next pattern-sweep's grep for
`Math.sign(.*) \* Math.round(Math.abs` find this one too.

### Blast radius
`topGexWalls` (`src/lib/providers/gamma-desk.ts`) is the SHARED, canonical wall-ladder builder
consumed by:
- `src/features/nighthawk/lib/positioning.ts` — Largo's Night Hawk positioning text (the
  motivating consumer: displays `distance_pts` with an explicit `+`/`-` sign).
- `src/lib/largo/largo-live-feed.ts` — wall narration ("Nearest wall: ... pts away").
- `src/app/api/market/gex-positioning/route.ts` — serves `distance_pts` over the API.
- `src/lib/meridian/meridian-cross-product-for-earnings-core.ts`.

**Not fixed here (correctly, per this round's hard exclusion list):**
`src/features/spx/lib/spx-desk-merge.ts`'s `recalcGexWallDistances` carries an independently
copy-pasted instance of the IDENTICAL buggy line (`distance_pts: Math.round((w.strike - spot) *
100) / 100`) — same bug, separate file, SPX trading-domain decision logic, out of scope for this
PR under the standing exclusion list. Flagging it here as a lead for the SPX lane rather than
touching it.

### Evidence detail
- RED: 1/16 fail pre-fix in `gamma-desk.test.ts`. GREEN: 16/16 post-fix.
- Consumer tests re-run clean post-fix: `gamma-desk.test.ts`, `positioning.test.ts`,
  `gex-positioning.test.ts`, `meridian-cross-product-for-earnings-core.test.ts` — 37/37 pass.
- `npx tsc --noEmit` clean.

| **Status** | FIXED — this PR. |
