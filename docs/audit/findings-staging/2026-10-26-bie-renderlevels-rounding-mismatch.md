## Ask Largo (shared `BieAnswerEnvelope` renderer): `renderLevels()`'s "Key levels" markdown bullet rounded a raw float with `toLocaleString` instead of the codebase's round-first algorithm, disagreeing with the SAME field's JSON value at a half-cent boundary

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit agent, Ask Largo standing ownership mandate, 2026-10-26 |
| **Scope** | `src/lib/bie/answer-envelope.ts` (`renderLevels()`) — shared by every Largo-answering product that populates `envelope.levels[]` (Helix, Thermal, Vector, Meridian, SPX, Swing), not swing-specific |

### Root cause

`renderLevels()` (`src/lib/bie/answer-envelope.ts`, ~lines 305-310) rendered each "Key levels"
bullet as `l.price.toLocaleString("en-US", { maximumFractionDigits: 2 })` directly on the raw,
pre-rounded float passed into the envelope at construction time. `makeEnvelope()` (same file) calls
`renderEnvelopeMarkdown()` — which calls `renderLevels()` — synchronously when the envelope is
built, **before** the API route's later `roundFloats(response, ...)` boundary pass runs on the full
JSON response (confirmed live: `NextResponse.json(roundFloats(result), ...)` in
`src/app/api/market/largo/query/route.ts` and `src/app/api/market/nighthawk/hunt/route.ts`, both
downstream of envelope construction). `roundFloats` walks the object tree and correctly rounds the
numeric `envelope.levels[].price` field (and every other numeric field) to 2dp using
`Math.round(n*100)/100`, but it only touches numbers — it cannot retroactively fix text already
baked into the `envelope.markdown` STRING.

Every other renderer in this codebase that stringifies a bare price level (`play-brief.ts`,
`play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`, `play-brief-intel.ts`, and the
Largo adapter's `extractEvidence`) was already fixed — per `fmt-money.ts`'s own documented history,
at least 3 prior occurrences of this exact bug class at bare price levels (plus a 4th at
percentages) — to use `fmtPriceLevel()` (`src/lib/fmt-money.ts`), which rounds FIRST
(`Math.round(n*100)/100`) and THEN calls `.toFixed(2)`, matching `roundFloats`'s own algorithm
exactly. `renderLevels()` is the one shared call site that was missed when those were fixed one at
a time, and it was untested: the only existing test on this function
(`answer-envelope.test.ts`, pre-fix) asserted the markdown merely CONTAINS the string "Key levels",
never that the rendered number matches the envelope's own JSON value.

### Evidence

Confirmed on current `main` by direct code read (no live HTTP call made — the math is
deterministic and independent of any specific server response):

```
node -e "
const n = 143.075;
console.log(n*100);                                              // 14307.499999999998
console.log(Math.round(n*100)/100);                               // 143.07  (roundFloats/fmtPriceLevel)
console.log(n.toLocaleString('en-US',{maximumFractionDigits:2}));  // 143.08  (pre-fix renderLevels)
"
```

`143.075*100` underflows to `14307.499999999998` in IEEE-754 double precision, so
`Math.round(n*100)/100` (the algorithm `roundFloats` and `fmtPriceLevel` both use) rounds DOWN to
`143.07`, while `toLocaleString`'s native decimal-aware rounding independently rounds UP to
`143.08` — the two disagree by a full cent at this exact boundary shape. A matching live repro
(SKHY flag-anchor at 143.075) was reported in the task brief for `GET /api/market/swing/play-brief
?playId=SWING:SKHY&ticker=SKHY&status=WATCH`: `envelope.levels[0].price` (post-`roundFloats`),
`evidence_numbers` (via `fmtPriceLevel`), and the "Watch levels" prose (via `fmtPriceLevel`) all
read `143.07`, while the SAME response's "Key levels" bullet — the one path through
`renderLevels()` — read `143.08`, one cent off from every other rendering of the identical
underlying number in the identical payload.

Confirmed via `git stash` (implementation fix stashed, new regression test kept in place):
RED — both new tests in `answer-envelope.test.ts` fail against pre-fix `renderLevels()` (the
143.075 case renders "143.08", not "143.07"). GREEN — all 10 tests in the file pass after
restoring the fix.

### Fix

`renderLevels()` now calls `fmtPriceLevel(l.price)` (from `src/lib/fmt-money.ts`) instead of
`l.price.toLocaleString("en-US", { maximumFractionDigits: 2 })`, matching the round-first-then-
stringify algorithm every other call site in this bug-class lineage already uses, and matching
`roundFloats`'s own algorithm byte-for-byte. `fmt-money.ts` is dependency-free (no imports), so
importing it into `answer-envelope.ts` introduces no circular-import risk.

Deliberately left unchanged / out of scope: a grep found three UI (React) components with the
visually identical pattern — `BieKeyLevelsTable.tsx`, `LargoDeskRead.tsx`, `LargoBlocks.tsx` — but
these render `envelope.levels[].price`/`structureLadder` rungs AFTER the API route's
`roundFloats()` pass has already run on the wire JSON; by the time these components receive the
value, it is already the correctly-rounded number (e.g. `143.07`), so `toLocaleString` is just
re-displaying an already-2dp value, not independently re-rounding a raw float — not the same bug
(no behavior change needed), left as-is per the task's scoping instruction. Noted for awareness,
not fixed in this PR.

### Regression test

`src/lib/bie/answer-envelope.test.ts`, new `describe` block *"renderEnvelopeMarkdown — renderLevels
rounding (2026-10-26 Ask Largo audit)"*:
- *"Key levels bullet rounds a half-cent-boundary float the SAME way roundFloats does, not
  toLocaleString's way"* — a level at the live-repro-shaped `143.075`, asserts the markdown bullet
  reads `143.07` (round-first) and never `143.08` (toLocaleString).
- *"still formats an ordinary (non-boundary) level correctly"* — a sanity check at `7520.5` that
  the fix didn't break the non-boundary case (`7520.50`).

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/bie/answer-envelope.test.ts` — RED
  pre-fix (`git stash` of `answer-envelope.ts` alone, test kept in place: 8 pass / 2 fail), GREEN
  post-fix (10 pass / 0 fail).
- Broader sweep (`src/lib/bie/*.test.ts`, `src/lib/swing/play-brief*.test.ts`,
  `src/features/largo/answer/*.test.ts`, `src/features/largo/blocks/*.test.ts`, Node 20) — 1428
  pass / 0 fail, confirming no downstream consumer depended on the old (incorrect) formatting.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
- Full suite (`npm test`, Node 20) — pass, 0 fail.
