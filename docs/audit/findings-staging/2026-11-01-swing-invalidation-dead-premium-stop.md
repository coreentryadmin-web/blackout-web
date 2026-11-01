> **kind:** FINDING

## Swing play-brief `envelope.invalidation` renders a dead pre-scale premium stop as live for already-scaled TRIM positions — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** standing Ask Largo x Night Hawk Swings mandate, production-correctness audit
(2026-11-01). Scanned all 57 currently-committed SWING positions via
`GET /api/market/swing/play-brief`; of the 11 positions whose Management section shows "(no
longer applies — already scaled...)" (i.e. `hasScaledOut` true), 7 had `envelope.invalidation`
land on the buggy fallback at the moment of the request: GDDY positionId 2293, TDOC positionId
2270, VFC positionId 2257, FTAI positionId 2254, TXRH positionId 2252, ACN positionId 2242, PPG
positionId 2194.

**Root cause:** `composeSwingPlayBrief`'s `invalidation` fallback chain
(`src/lib/swing/play-brief.ts`) ends with:

```ts
: resolveBreakInvalidation(ctx) ??
  (sourceFetchFailed || gateFramingMoot ? null : play.gateBlocks?.[0]?.reason) ??
  (bucket === "open" && play.exitPolicy?.stop_premium != null
    ? `Premium stop at ${fmtUsd(play.exitPolicy.stop_premium)}`
    : null);
```

This is the LAST fallback, reached whenever `resolveBreakInvalidation(ctx)` returns `null` (it
requires a resolvable Vector/GEX spot — `resolveBreakInvalidation`, `play-brief-narrative.ts` —
and returns `null` whenever both Vector and GEX context are stale/unresolvable for that ticker at
read time) and the position has no `gateBlocks` reason (always true once a position is already
committed/OPEN, since gates only populate pre-entry). It cited `play.exitPolicy.stop_premium` raw,
with **no check for `hasScaledOut(play.exitPolicy)`** (`terminal-ladder.ts`) — the exact guard
four sibling sites in this same file family already apply:
- `managementSection`'s "Rails: ..." line (`play-brief.ts`)
- the `evidence_numbers` fact builder (`play-brief.ts`)
- `watchForSection`'s "Premium stop rail" bullet (`play-brief-intel.ts`)
- the "Break watch — stop already breached" bullet (`play-brief-narrative.ts`, fixed by PR #6924
  on 2026-10-26 — explicitly described there as "the ONE remaining call site" at the time, which
  this top-level `invalidation` fallback was not, and still wasn't until this fix).

Once a trim tranche has fired, `deriveScaleOutAction`/`computeScaleOutTriggerInfo`
(`scale-out.ts`) permanently disable the pre-scale hard stop — the real governing floor becomes
the runner's trailing stop off its peak (`peak × 0.5`). Citing the dead stop here is not a stale
number, it is a structurally wrong one for any already-scaled position reaching this fallback.

**Live evidence (2026-11-01):** GDDY positionId 2293
(`GET /api/market/swing/play-brief?playId=SWING:GDDY:2293&ticker=GDDY&status=OPEN&positionId=2293`):
`envelope.invalidation = "Premium stop at $1.48"` while the SAME response's Management section
body read `"Rails: stop $1.48 (no longer applies — already scaled; runner trail now $4.18) ·
target $7.40 ✓ (reached)"` — the brief flatly contradicting its own Management section about
whether $1.48 is live. Identical pairing confirmed for TDOC positionId 2270
(`"Premium stop at $0.17"` vs `"Rails: stop $0.17 (no longer applies — already scaled; runner
trail now $0.97) · target $0.84 ✓ (reached)"`) and the other 5 tickers listed above. Re-fetching
GDDY moments later (as `resolveBreakInvalidation`'s Vector/GEX staleness window shifted) returned
a different, correct invalidation string instead — proving the buggy branch is genuinely,
intermittently live-reached, not merely theoretical, and that the same position's invalidation
text flips between correct and wrong depending on this unrelated freshness race.

**Fix:** mirror the exact substitution the #6924 "Break watch" bullet already applies — once
`hasScaledOut(play.exitPolicy)` is true, cite the runner's trailing stop
(`runnerTrailingStopPremium`, priced off `entry × (1 + peak/100)`) instead of the dead
`stop_premium`, relabeled "Runner trailing stop" (vs "Premium stop"). If the trail itself can't be
priced for lack of a usable peak, the fallback correctly falls through to `null` (omission, never
reverting to the confirmed-dead `stop_premium`) — consistent with this same fallback chain's
existing "omit, don't fabricate" discipline for `sourceFetchFailed`/`gateFramingMoot`.

A **second, narrower defect surfaced while adding the fix**: this top-level `invalidation`
computation sits directly in `composeSwingPlayBrief`'s body, outside any `safeCompose` try/catch
(unlike the three sibling call sites inside `managementSection`/`evidence_numbers`, which are
individually protected). An unguarded `hasScaledOut(play.exitPolicy)` call crashes on a malformed
`exitPolicy.trim_levels` (`.some` on `undefined`), which would 503 the ENTIRE brief rather than
degrading one section — caught by this file's own pre-existing error-boundary regression test
("a throwing top-level section (Management/Position) does not take down the whole brief"), which
feeds exactly that malformed shape. Fixed by gating the `hasScaledOut` call on
`Array.isArray(play.exitPolicy.trim_levels)` first, falling back to "not yet scaled" (the
pre-fix, still-honest behavior) when the field is malformed rather than throwing.

**Evidence (RED → GREEN):** added a regression test to `src/lib/swing/play-brief.test.ts`
("top-level Invalidation line cites the live runner trailing stop, not the dead pre-scale premium
stop, once a trim tranche has fired") using the same fixture shape as the existing MRNA-style
scaled-out test, asserting both `envelope.invalidation` and the Management section's "Rails: ..."
line agree on the same runner-trail figure. RED (pre-fix, file reverted via `git show HEAD`):
`actual: 'Premium stop at $0.06'` vs `expected: 'Runner trailing stop at $0.19'` — reproduces the
bug exactly. GREEN (post-fix): `npx tsx --experimental-test-module-mocks --test
src/lib/swing/play-brief.test.ts` → 194/194 pass (including the pre-existing error-boundary test,
confirming the `Array.isArray` guard fix). Blast-radius sweep:
`npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts
src/lib/swing/play-brief-narrative.test.ts src/lib/swing/play-brief-intel.test.ts
src/lib/zerodte/terminal-ladder.test.ts` → 731/731 pass. `npx tsc --noEmit`: clean.

**Blast radius:** single call site in `src/lib/swing/play-brief.ts` (`composeSwingPlayBrief`'s
`invalidation` fallback chain). No other file reads this exact fallback branch. The three sibling
call sites that already apply this guard (`managementSection`, `evidence_numbers`,
`watchForSection`) and the `play-brief-narrative.ts` "Break watch" bullet are untouched — they
were already correct. Scope at time of fix: 7 of 57 live committed SWING positions (12.3%) were
observed hitting the buggy branch in a single scan; the true affected population is every
already-scaled OPEN/HOLD/TRIM position whose per-ticker Vector/GEX spot is stale or unresolvable
at read time and has no live gate-block reason — a cross-engine freshness race, not a fixed
subset of tickers, so the 7 observed are a point-in-time sample, not an exhaustive list.
