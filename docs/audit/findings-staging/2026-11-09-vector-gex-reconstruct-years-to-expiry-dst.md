## Vector's historical GEX reconstruction (`yearsToExpiry`) used DST-naive hardcoded ET anchors — the same bug shape already fixed twice elsewhere in this codebase, reimplemented a third time and never inheriting either fix

> **kind:** `FINDING`

### Summary
`src/features/vector/lib/vector-gex-reconstruct.ts`'s `yearsToExpiry(expiry, sessionYmd)` — the
time-to-expiry input every reconstructed Black-Scholes gamma in this module is computed from
(`gexLadderAtSpot` → `reconstructGexRail`/`reconstructGexHeatmapGrid`, the historical dense
wall-rail/heatmap reconstruction for a past session) — anchored the 16:00 ET close and 09:30 ET
open with hardcoded, fixed-offset UTC literals:

```ts
const exp = Date.parse(`${expiry}T20:00:00Z`); // ~16:00 ET close
const now = Date.parse(`${sessionYmd}T13:30:00Z`); // ~09:30 ET open
```

`T20:00:00Z` is 16:00 ET only under EDT (UTC-4); under EST (UTC-5) the real 16:00 ET close is
`21:00Z`, so the literal reads as 15:00 ET — an hour early. Symmetrically `T13:30:00Z` is 09:30 ET
only under EDT; under EST the real open is `14:30Z`, so the literal reads as 08:30 ET — also an
hour early.

**This is the identical bug shape already found and fixed twice in this exact codebase, for the
identical two anchors**, and this module reimplemented both independently rather than reusing
either fix:
- `marketCloseMs` (`vector-expected-move-atm.ts`): *"was a hardcoded 'T20:00:00Z', which is only
  4:00 PM ET under EDT; under EST, 4:00 PM ET is 21:00 UTC, so the old constant read as 3:00 PM ET
  and marked today's still-live 0DTE expiry 'settled' an hour before the real close."*
- `sessionOpenMs` (`discord-eod-recap.ts`): *"was a hardcoded 'T13:30:00.000Z', which is only 9:30
  AM ET under EDT; under EST, 9:30 AM ET is 14:30 UTC, so the old constant read as 8:30 AM ET and
  let an hour of pre-market flow leak into the EOD session-recap filter."*

### Why it stayed invisible
`expiry` and `sessionYmd` are almost always on the SAME side of a DST transition (same calendar
month, or close to it), and when they are, the 1-hour bias at each anchor **cancels exactly** in
the `(exp − now)` subtraction — both ends are wrong by the same amount in the same direction, so
the duration between them comes out right even though neither endpoint's absolute UTC instant
does. That is why this has never shown up on an ordinary, non-straddling reconstruction and why no
existing test caught it.

It stops cancelling the moment `expiry` and `sessionYmd` fall on *different* sides of a DST flip —
concretely, reconstructing a session from late October/early November (EDT) against a
weekly/monthly expiry dated after the Nov 1 transition (EST), or the mirror case around the March
transition. This module's own stated purpose is reconstructing **past** sessions on demand
(`"the honest way to get DENSE wall rails for a PAST session without a live recorder"`), so unlike
a live-clock bug this one is reachable for any historical reconstruction request whose session and
expiry straddle either of the year's two DST boundaries — a recurring, not one-off, window.

### Evidence
Computed directly (not inferred) for a concrete straddling pair, `sessionYmd="2026-10-26"` (EDT),
`expiry="2026-11-06"` (EST):

```
real 09:30 ET open on 2026-10-26 (EDT) = 2026-10-26T13:30:00Z
real 16:00 ET close on 2026-11-06 (EST) = 2026-11-06T21:00:00Z
real duration  = 11.3125 days

pre-fix hardcoded anchors:
  exp = 2026-11-06T20:00:00Z   (1 hour early — real close is 21:00Z under EST)
  now = 2026-10-26T13:30:00Z   (correct — real open under EDT IS 13:30Z)
  buggy duration = 11.270833... days   (0.37% short — a real, non-rounding hour lost)
```

Added two regression tests in `vector-gex-reconstruct.test.ts`:
- `"yearsToExpiry: DST-correct across the Nov 1 2026 EDT->EST transition"` — asserts the function
  matches the independently-computed real DST-aware duration above, and explicitly asserts it does
  **not** reproduce the stale pre-fix (1-hour-short) value.
- `"yearsToExpiry: same-DST-regime durations are unchanged by the DST-correct anchors"` — pins the
  ordinary non-straddling case (both dates EDT) to the exact same value the old hardcoded literals
  already gave, so the fix is proven not to perturb the common path.

RED → GREEN, proven by reverting only the fix (`git stash` on `vector-gex-reconstruct.ts` while
keeping the new tests): the DST-straddle test fails (`not ok 3`, 20 pass / 1 fail) against the
pre-fix code, and all 21 tests pass once the fix is restored. `npx tsc --noEmit` clean.

### Blast radius
`yearsToExpiry` is called only from `gexLadderAtSpot` inside this same file, which feeds
`reconstructGexRail` and `reconstructGexHeatmapGrid` — the historical dense wall-rail and
strike×time GEX-heatmap reconstruction. No other module imports or reimplements this particular
function (checked: `vector-expected-move-atm.ts` imports only the `ReconstructContract` *type*
from this file, not `yearsToExpiry`, and already carries its own independently-fixed
`marketCloseMs`). `src/lib/providers/polygon-options-gex.ts` and `src/lib/gex-depth.ts` each carry
a same-named `yearsToExpiry` with a *different* shape (both ends use a fixed `-04:00` literal
offset, not `Z`, applied consistently to both anchors) — that pair is self-consistent by
construction (a uniformly-wrong fixed offset cancels in the difference regardless of real DST, by
design, per `gex-depth.ts`'s own comment that it mirrors `polygon-options-gex.ts` "EXACTLY — same
anchors, same divisor") and is unaffected by, and out of scope for, this fix.

### Fix
Added a local `etUtcOffsetHours(dateYmd)` helper (duplicated from, not imported from,
`vector-expected-move-atm.ts`/`discord-eod-recap.ts` — this module's own header states it is
deliberately "Pure + dependency-light (no network, no Date.now)" so the reconstruction stays
unit-testable without a provider import; importing a sibling for a five-line pure function would
be exactly the coupling that header exists to avoid, the same reasoning `gex-depth.ts` gives for
duplicating `normCdf` rather than importing it). `yearsToExpiry` now derives each anchor's UTC hour
from the real ET offset for that specific calendar date (`16 - offsetHours` for the close,
`9 - offsetHours` for the open, mirroring `marketCloseMs`/`sessionOpenMs` exactly), so each
endpoint is DST-correct independently rather than relying on both being wrong by the same amount.

Deliberately left unchanged: the ACT/365 divisor, the `≥ ~1 minute` floor, and the sibling
`yearsToExpiry` copies in `polygon-options-gex.ts`/`gex-depth.ts` (different, already
self-consistent shape — see Blast radius above).
