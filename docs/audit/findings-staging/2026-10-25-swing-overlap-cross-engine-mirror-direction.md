## 2026-10-25 — [FINDING, P2 Night Hawk Swings / Ask Largo] `formatOverlapPosition()` never disclosed a genuinely cross-engine book-overlap position when the REVIEWED play is Banger-origin and the sibling is swing-native — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD, this branch) |
| **Found by** | Adversarially-verified live audit (Ask Largo standing mandate, CLAUDE.md "ASK LARGO × NIGHT HAWK SWINGS" section), live repro SWING:SNDQ:2120 |
| **Scope** | `src/lib/swing/play-brief-intel.ts` (`formatOverlapPosition`) |

### Root cause

`bookContextSection`'s `formatOverlapPosition()` (src/lib/swing/play-brief-intel.ts) annotates an
overlapping book position with whether it is a genuine CROSS-ENGINE sibling (independently committed
by the OTHER engine — Banger vs native swing) or a same-engine duplicate, because the former is a
stronger, independently-corroborated signal than the latter (two independent systems both like this
ticker, vs one system committing to it twice).

For the `isReviewedTicker` branch (a sibling position on the SAME ticker as the play being reviewed),
the function had an unconditional early return for any native sibling, reached BEFORE the
`isCrossEngine` check further down was ever computed:

```ts
const isReviewedTicker = p.ticker.toUpperCase() === reviewedTicker.toUpperCase();
const isDuplicateOtherTicker = !isReviewedTicker && dupTickers.has(p.ticker.toUpperCase());
if (!isReviewedTicker && !isDuplicateOtherTicker) return base;
if (p.positionId != null) return `${base} (separate position #${p.positionId})`;   // <-- fires for ANY native sibling, unconditionally
...
const isCrossEngine = isReviewedTicker
  ? !reviewedIsBangerOrigin
  : crossEngineDupTickers.has(p.ticker.toUpperCase());
```

`isCrossEngine`'s formula for the `isReviewedTicker` case (`!reviewedIsBangerOrigin`) is only correct
when it is reached with the sibling's engine already known to be Banger-origin (`p.positionId ==
null`, having fallen through the early return above it) — at that point, "cross-engine" reduces to
"is the REVIEWED play NOT also Banger-origin." That is exactly the shape the 2026-10-20 fix (the
LABD/RNG repro, locked in by the "a same-ticker sibling is NOT labeled cross-engine when the REVIEWED
play is itself Banger-origin" test) and its sibling regression test ("cross-engine label still fires
for a swing-native reviewed play with a Banger sibling") both exercise. But because the native-sibling
early return sits BEFORE this check, the formula never got a chance to apply in the MIRROR direction:
reviewed play is Banger-origin, sibling is native (`p.positionId != null`). That pairing is just as
genuinely cross-engine (Banger engine independently committed the reviewed play; the native swing
engine independently committed the sibling) — but the function silently rendered it as a same-engine-
looking `"(separate position #N)"`, with no "cross-engine" wording at all.

Only ONE of the two possible directions had a locked-in regression test before this fix (reviewed=
native, sibling=Banger-origin); the reverse direction (reviewed=Banger-origin, sibling=native) had
none, and was broken.

### Evidence

Live repro: `SWING:SNDQ:2120` — confirmed Banger-origin via its "Banger breakout +5.4% · 21C
2026-10-30" management-section wording (the unique template only `horizonPlayFromBangerPosition` in
`banger-lane-merge.ts` produces) — under-disclosed its swing-native sibling `SNDQ:2077` (a real
`swing_positions` row with its own `positionId`) as plain `"(separate position #2077)"`, with no
"cross-engine" wording, even though the Banger engine (2120) and the native swing engine (2077)
independently committed LONG SNDQ.

Direct fixture reproduction (matches the finding's own repro shape exactly):
```ts
bookContextSection(
  fixturePlay({ id: "SWING:SNDQ:2120", ticker: "SNDQ", direction: "LONG", status: "OPEN", bangerOrigin: true }),
  [{ ticker: "SNDQ", direction: "LONG", positionId: 2077 }],
)
```
Pre-fix: body contained `"...already holding SNDQ LONG (separate position #2077) on SNDQ itself..."`
— no "cross-engine" wording. New regression test
(`src/lib/swing/play-brief-intel.test.ts`, "a native sibling on the reviewed play's OWN ticker is
labeled cross-engine when the REVIEWED play is itself Banger-origin (2026-10-25 fix, live repro
SNDQ:2120/2077)") asserts `/SNDQ LONG \(separate, cross-engine position #2077\)/`. Confirmed RED
pre-fix (ran against the test-only change, source reverted to `origin/main`): `AssertionError`, actual
body carried `"(separate position #2077)"` with no "cross-engine" text. Confirmed GREEN post-fix: full
`src/lib/swing/play-brief-intel.test.ts` (331/331), plus `portfolio.test.ts` + `play-brief.test.ts` +
`play-brief-adapter.test.ts` (205/205) all pass. `npx tsc --noEmit -p .` clean (no new errors).

### Blast radius

Single function, `formatOverlapPosition` — its only caller is `bookContextSection`, and every one of
that function's four call sites (same-ticker same-direction, other-ticker same-direction, same-ticker
opposed, other-ticker opposed) routes through the same `formatOverlapPosition` and is covered by the
same fix, since the bug lived in the shared helper, not in any one call site. No other file in the
repo independently reimplements this cross-engine-disclosure logic (checked via grep for
`reviewedIsBangerOrigin`/`crossEngineDupTickers` usage — both are private to this file and consumed
only here).

### Fix rationale

Added a dedicated branch, checked BEFORE the general `p.positionId != null` early return, that
special-cases exactly `isReviewedTicker && p.positionId != null` (the previously-unreached
combination): it returns the cross-engine-labeled string when `reviewedIsBangerOrigin` is true, and
the existing plain label otherwise (preserving the already-correct "two native positions, same
ticker, same engine" and "reviewed is native, sibling is native" cases, both still exercised by
existing tests). The alternative considered — moving `isCrossEngine`'s computation above the general
early return and reusing its existing formula unconditionally — was rejected: that formula
(`!reviewedIsBangerOrigin`) is only valid once the sibling's engine is known to be Banger-origin (i.e.
in the already-fallen-through `p.positionId == null` case); naively reusing it for a native sibling
would have required deriving a different, more general formula and risked touching the
`isDuplicateOtherTicker` branch's native-sibling shape too, which is explicitly out of scope for this
finding (that branch's existing behavior — and its own locked-in test, "a genuinely mixed-origin
duplicate OTHER ticker is still labeled cross-engine... even when the reviewed play is itself
Banger-origin", which deliberately does NOT require the native-side row of that pair to also carry the
label — is left completely untouched here). The targeted, minimal branch fixes exactly the missing
direction without touching anything else.

### Deliberately left unchanged

- The already-tested mirror direction (reviewed=native, sibling=Banger-origin) — same code path,
  same formula, unaffected.
- The `isDuplicateOtherTicker` branch's native-sibling shape (a native row that is part of a
  duplicate-OTHER-ticker pair still falls through to the general, unconditional
  `p.positionId != null` early return exactly as before) — out of scope for this finding, which is
  specifically about the reviewed play's OWN ticker.
- `tickersWithMixedOriginDuplicates`/`crossEngineDupTickers` and everything else in
  `bookContextSection` — untouched.
