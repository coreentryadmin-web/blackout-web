## 2026-09-12 — [FINDING, P3 product-quality] Vector's wall-proximity "callout" is double-stated — TWO independent call sites each prepend a strike/side/"wall" prefix ahead of a callout that already says it

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (product-quality/trust — not a wrong number, but a rendered sentence that visibly contradicts itself grammatically, in lines every Vector-derived surface and the Ask Largo swing brief show members) |
| **Area** | `src/features/vector/lib/vector-play-engine.ts` (`buildVectorPlay`'s `starred` array) — consumed by Ask Largo's swing play-brief (`vectorPlayCoaching`, `src/lib/swing/play-brief-narrative-coaching.ts`), Vector's own UI (`VectorPlayAnalyticsDrawer.tsx`), `GET /api/market/vector/contract-picks`, and BIE's `vector-desk-brief.ts`/`play-suggest-read.ts`; AND, independently, `src/lib/swing/play-brief-intel.ts` (`chartLevelsSection`'s "Nearest wall" line, the swing brief's own "Levels on chart" section) |
| **Found by** | Standing 5-engine live monitor + Ask Largo × Night Hawk Swings deep-dive — 2026-09-12 cycle (covering the 09:10/09:20 UTC firings) |

### What was found

Live `GET /api/market/swing/play-brief?playId=SWING:AAPL&ticker=AAPL&positionId=37&status=OPEN`
(2026-09-12, real committed AAPL swing position), "Trade manager read" section, one bullet:

```
Vector desk: POSITION · momentum short on continuation → target put wall 332.5 · starred level
332.5 put wall at — Testing 332.5 put wall (0.02% below) — dealers buy weakness; support unless
it breaks on volume.
```

The clause after "starred level" states the strike, side, and the word "wall" TWICE in the same
sentence, with an ungrammatical "at —" seam in between: `"332.5 put wall at — Testing 332.5 put
wall (0.02% below) — ..."`.

The identical duplication shape showed up a second time, independently, in the SAME AAPL
position's CLOSED-bucket brief (`...&positionId=36&status=CLOSED`), "Levels on chart" section:

```
Nearest wall: 332.50 (put, -0.0% away) — Testing 332.5 put wall (0.02% below) — dealers buy
weakness; support unless it breaks on volume.
```

Same root data (`WallProximity.callout`), same duplication pattern, a completely different call
site — see the second root-cause entry below.

### Root cause

`buildVectorPlay` (`vector-play-engine.ts`) composes the "watch this NOW" `starred` array. For a
call/put wall proximity, the old code was:

```ts
starred.push(`${prox.strike ? fmt(prox.strike) : ""} ${prox.side} wall ${prox.nearness} — ${prox.callout}`.trim());
```

i.e. it PREPENDS a synthesized `"{strike} {side} wall {nearness} —"` prefix ahead of
`prox.callout`. But `deriveWallProximity` (`vector-wall-proximity.ts`) already builds `callout` as
a complete, well-formed sentence that independently states the same strike/side/"wall" itself —
e.g. for a put wall: `` `Testing ${fmt(best.strike)} put wall (${best.dist.toFixed(2)}% below) — dealers
buy weakness; support unless it breaks on volume.` ``. The prefix and the callout were never meant
to both restate the wall — the prefix duplicates information the callout already carries in full,
producing the doubled, ungrammatical line above.

Ask Largo's swing narrative (`vectorPlayCoaching`) renders this exact `starred` entry verbatim (it
deliberately skips `starred[0]`, the headline, per its own comment, but not this one) — so the bug
surfaces in every swing play brief for a play whose Vector desk read is currently testing/at a
call or put wall, not just AAPL.

**Second, independent call site — `chartLevelsSection` (`play-brief-intel.ts`).** This function
reads `vec.proximity` directly (not through `starred` at all) and had its OWN copy of the same
anti-pattern:

```ts
lines.push(
  `Nearest wall: **${vec.proximity.strike.toFixed(2)}** (${vec.proximity.side}, ${vec.proximity.distancePct.toFixed(1)}% away) — ${vec.proximity.callout}`,
);
```

— prepending `"{strike} ({side}, {pct}% away) —"` ahead of the same self-describing `callout`.
This is not downstream of the `starred`-array fix above; it independently reads the same
`WallProximity` object and needed its own fix.

### Why the existing unit tests never caught this

`vector-play-engine.test.ts`'s own `proximity()` test fixture fabricates a short SYNTHETIC callout
(`` `${side} wall ${strike} ${nearness}` `` → e.g. `"call wall 7600 at"`) that never restates the
wall the way the REAL `deriveWallProximity` callout does. Every existing test exercising this
branch (`"starred: headline always first; wall-at and confluence added"` and others) therefore
asserted against the fixture's own simplified string, never against a callout shaped like the real
one — so the duplication was invisible to the suite even though it has presumably been live in
production narrative surfaces for as long as this line has existed.

### Blast radius

`starred` is not swing-only. Confirmed non-test importers of `VectorPlay.starred` beyond the swing
narrative: `src/features/vector/lib/vector-play-candidates.ts`,
`src/features/vector/components/VectorPlayAnalyticsDrawer.tsx` (Vector's own desk UI),
`src/app/api/market/vector/contract-picks/route.ts`, and `src/lib/bie/vector-desk-brief.ts` /
`src/lib/bie/play-suggest-read.ts` (the general-purpose Largo BIE reader, not just swing) — every
one of these renders/reasons over the same doubled sentence whenever a play's proximity is
`"testing"` or `"at"` a call/put wall (the `"flip"` branch immediately above this one is unaffected
— its callout does not restate "Flip cross imminent", so no duplication there). The second call
site (`chartLevelsSection`) is scoped to the swing play-brief's own "Levels on chart" section —
confirmed by grep that no other file reads `vec.proximity.callout` directly.

### Fix

Both call sites: push `prox.callout` (or `vec.proximity.callout`) as-is instead of prepending the
redundant `"{strike} {side} wall {nearness} —"` / `"{strike} ({side}, {pct}% away) —"` prefix.
Nothing is lost in either case: the callout already states the strike, side, "wall", and a precise
distance percentage (e.g. "0.02% below") — strictly more information than the coarse `nearness`
label or the rounded `distancePct` the old prefixes contributed, both subsumed by the callout's own
more precise number.

### Tests

`src/features/vector/lib/vector-play-engine.test.ts`:
- Updated `"starred: headline always first; wall-at and confluence added"` — its assertion
  (`/call wall at/`) matched only because the OLD code duplicated the fixture's own synthetic
  callout text ahead of itself; with the fix, the starred line is the fixture's callout alone
  (`"call wall 7600 at"`), so the assertion is tightened to `/call wall 7600 at/` — still exact,
  no longer coincidentally satisfied by a doubled string.
- Added `"starred: wall-proximity line is the real callout verbatim, not double-prefixed with the
  wall it already names"` — uses a callout shaped exactly like the real `deriveWallProximity`
  output (not the test fixture's simplified string) and asserts the starred line equals the
  callout exactly, plus a guard that the strike text appears exactly once (never twice).

`src/lib/swing/play-brief-intel.test.ts`:
- Added `"chartLevelsSection: Nearest wall line is the real callout verbatim, not double-prefixed
  with the wall it already names"` — same discipline: a realistic callout, asserts the rendered
  line equals `"Nearest wall: " + callout` and that the strike substring appears exactly once.

Verified RED before each fix (`git stash` on the respective source file only, keeping the new/
updated tests): `vector-play-engine.test.ts` 1/46 failing → 46/46 after; `play-brief-intel.test.ts`
1/97 failing → 97/97 after (143/143 when run together with `vector-play-engine.test.ts`). Also ran
`vector-desk-brief.test.ts`, `play-brief-narrative-coaching.test.ts`, and
`vector-play-candidates.test.ts` (the other `starred` consumers) — all green, none pinned the old
format. Full `npm test` (Node 20, 13849+ tests) and `npx tsc --noEmit` both clean on the fix
branch.
