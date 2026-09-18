## Ask Largo swing play-brief's per-contract `$` formatter disagreed with itself — same number, two different cents, same API response

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (data correctness — the exact Position/mark/entry premium numbers a member reads for a real, real-money committed swing position) |
| **Area** | Ask Largo / Night Hawk Swings — `src/lib/fmt-money.ts`, `src/lib/swing/play-brief.ts`, `play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`, `play-brief-intel.ts` |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — live `GET /api/market/swing/play-brief` deep-dive, 2026-09-12 |

### Symptom

Live `GET /api/market/swing/play-brief?playId=SWING:AAPL:37&ticker=AAPL&status=COMMIT&positionId=37`
(a real, open, committed AAPL swing position, 2026-09-12) rendered **`Mark: **$6.17**`** in both its
"Position" section and its "Trade manager read" coaching bullet ("mark **$6.17**") — but the SAME
response's own `briefContentKey` diagnostic field (an internal SSE-dedupe key, never rendered to a
member, but a plain JSON number field in the response) carried **`"mark":6.18`** for the identical
underlying value. One API response, one fact, two different cents.

The same position's `entryPremium` showed the identical one-cent gap against a second endpoint:
`GET /api/market/nighthawk/horizons?view=swings` reported `"entryPremium": 6.73` for position #37,
while the play-brief's "Position" section printed `Entry: **$6.72**` for the same position, same
moment, same underlying DB row.

### Root cause

Four files each carry a byte-identical local copy of the same "absolute per-contract premium price"
formatter (`play-brief.ts`'s `fmtUsd`, `play-brief-narrative.ts`'s `fmtOptionUsd`,
`play-brief-narrative-coaching.ts`'s `fmtUsd`, `play-brief-intel.ts`'s `fmtUsd`), all reading:

```ts
function fmtUsd(n) { return `$${n.toFixed(2)}`; }
```

Every route in this lane wraps its final JSON response in `roundFloats()`
(`src/lib/round-floats.ts`), which rounds every bare numeric field via `Math.round(n * 100) / 100`.
That is **not the same rounding** as `n.toFixed(2)` for a raw IEEE-754 double sitting near an exact
half-cent boundary:

```
(6.175).toFixed(2)        === "6.17"   // 6.175 is actually stored as 6.1749999999999998...
Math.round(6.175 * 100)/100 === 6.18   // the floating-point *multiplication* rounds up first
```

`roundFloats()` cannot repair the `toFixed()` copies, because by the time it runs over the response
object, those numbers are already baked into markdown **text** inside `body`/`markdown` strings
(built at compose time, before the route ever sees the payload) — `roundFloats` treats a string as
an opaque leaf and only rounds bare `number` fields. So the play-brief composer's own internal
diagnostic field (`briefContentKey`, which stores the raw float and lets the *route's* `roundFloats`
round it) and its member-facing markdown text (which pre-rounds itself via `toFixed(2)` before the
route ever runs) can silently disagree by a cent for the exact same underlying value, whenever that
value happens to land near an `x.xx5` boundary — precisely CLAUDE.md's own "systemic: several
endpoints serve unrounded floats" note and the Largo product contract's C9 ("round exactly once, at
the boundary"), one layer deeper than a raw unrounded float: a *consistently wrong* rounding.

### Evidence (live production, 2026-09-12, off-hours/weekend — market closed, values are Friday's
carried-forward close, but the DISCREPANCY itself is a pure formatting bug, unrelated to staleness)

```
GET /api/market/swing/play-brief?playId=SWING:AAPL:37&ticker=AAPL&status=COMMIT&positionId=37
  → markdown "## Position\nEntry: **$6.72**\nMark: **$6.17** (2026-09-11 16:00 ET)\n..."
  → same response's briefContentKey: {"...,"mark":6.18,...}   <- SAME raw value, rounded correctly

GET /api/market/nighthawk/horizons?view=swings
  → lanes.SWING.committed[positionId=37].entryPremium: 6.73    <- SAME row's entry, rounded correctly
```

Reproduced the exact disagreement directly from the two rounding algorithms (Node 20.20.2):

```
(6.175).toFixed(2)          -> "6.17"    Math.round(6.175*100)/100 -> 6.18
(6.725).toFixed(2)          -> "6.72"    Math.round(6.725*100)/100 -> 6.73
```

— the exact pair of one-cent gaps observed live (mark 6.17 vs 6.18; entry 6.72 vs 6.73).

All four `fmtUsd`/`fmtOptionUsd` copies had already been independently patched for an identical
**sign** defect on 2026-09-09/11 (a "+" prefix wrongly applied to an absolute price) — each fix
comment explicitly calls out the previous file as "the same root cause, Nth file", confirming these
are one function pasted into four places rather than four independent designs. This is the same
disease's second symptom, previously undiscovered.

### Fix

Added `fmtOptionUsd(n: number | null | undefined): string` to `src/lib/fmt-money.ts` (alongside the
existing `fmtPremium` compact-magnitude formatter, the established "single source of truth" pattern
this repo already uses for money formatting) that rounds via the *exact* same algorithm as
`roundFloats` — `Math.round(n * 100) / 100` — **before** calling `.toFixed(2)`, guaranteeing
byte-for-byte agreement with any `roundFloats()`-processed JSON number carrying the same raw value
elsewhere in the same payload. Removed all four local duplicate definitions in the swing files in
favor of importing this one function (aliased to the local name `fmtUsd` in the three files that
used that name, so no call site needed to change) — this both fixes the rounding-consistency bug and
removes a four-way duplication of the same function, consistent with this repo's own precedent
(`fmtPremium`'s header comment: "~15 copies it replaces ... several of which rendered a DIFFERENT
string for the same dollar figure — a real production data-correctness bug").

Deliberately did **not** change: the sign-free contract itself (still never a "+"/"-" prefix — these
are prices, not deltas, per the 2026-09-09/11 fix); any percent formatter (`fmtPct`) in the same
files; or the unrelated `.toFixed(2)` calls in these files for GEX-wall/spot/VWAP/structural PRICE
LEVELS (a different quantity class not implicated in this specific live repro) — narrowing the PR to
the confirmed, reproduced bug rather than speculatively touching every `.toFixed(2)` call in the
module.

### Tests

`src/lib/fmt-money.test.ts` gained a new `fmtOptionUsd` describe block:
- null/undefined/NaN/Infinity → em-dash.
- never signs a price (matches the existing sign-free contract).
- a direct reproduction of the live boundary values (6.175 → "$6.18", 6.725 → "$6.73", plus the
  neighboring non-boundary values 6.165/6.715 to prove this isn't "always round up").
- a property-style assertion that `fmtOptionUsd` agrees byte-for-byte with `roundFloats`'s own
  rounding formula across representative boundary values, including CLAUDE.md's own documented
  `7499.360000000001` example.

RED before the fix: `fmtOptionUsd` did not exist in `fmt-money.ts` at all (confirmed via
`git stash` / `stash pop` around the whole change). GREEN after: `fmt-money.test.ts` 10/10, the full
swing play-brief test suite (7 files, 443 tests) 443/443, full repo suite (Node 20.20.2)
**14005 pass / 0 fail / 3 skipped**. `npx tsc --noEmit` clean; `next lint` clean on every touched
file.

### Blast radius

Five files: one new shared function (`fmt-money.ts`), four call sites converted from a local
duplicate definition to an import (`play-brief.ts`, `play-brief-narrative.ts`,
`play-brief-narrative-coaching.ts`, `play-brief-intel.ts`) — no other file defines this formatter.
Every markdown line that prints an entry/mark/stop/target premium in the swing play-brief (Position,
Management's Rails line, Trade manager read's mark/break-watch bullets, What to watch's Premium stop
rail, sibling-position notes) now renders the same cents `roundFloats()` would produce for the
identical raw value anywhere else in the response or across a sibling endpoint reading the same DB
row.
