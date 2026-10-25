> **kind:** `FINDING`

## Meridian — `bestPlayHint` still says "Wait for the print" after the print has landed — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `src/lib/meridian/meridian-earnings-report-core.ts` (`bestPlayHint`, `buildMeridianEarningsReport`) |
| **Severity** | P2 (member-facing: directly contradicts the report's own headline on the same panel) |

### Root cause

This exact file already fixed the identical defect class for `headline` and `confidence` (measured
live 2026-08-21: three names that reported that morning were still headlined "Imminent print —
stand aside for reaction" six hours after the numbers were out) by gating both on a `printed`
flag — `input.post_print != null && input.post_print.lean !== "unknown"`. The surrounding comment
is explicit about the scope of that fix: `printed` is "applied only where the forward-looking CLAIM
is made: the headline and the confidence hedge" — but `best_play` makes exactly that same
forward-looking claim ("Wait for the print — gap risk dominates") and was never included.

`bestPlayHint` checked `input.days_until != null && input.days_until <= 1` directly, with no
`printed` gate at all, so on the day a name reports, `best_play` kept recommending "Wait for the
print" and "Size down or skip directional bets into the release" for the rest of the session —
even after `headline` correctly switched to "printed — beat; the reaction is the read now".

### Evidence

Live repro (`node --import tsx`, BEKE, `days_until: 0`, `post_print: { lean: "beat", ... }`):

```
headline:  "BEKE printed — beat; the reaction is the read now"
best_play: {
  "headline": "Wait for the print — gap risk dominates",
  "structure": "Reaction trade only after guidance and initial move settle",
  "risk": "Size down or skip directional bets into the release"
}
```
A member reading this report's "Best Play" box is told to wait for and size down into a print the
headline two lines above already says has happened.

### Blast radius

Single call site (`buildMeridianEarningsReport`'s own `best_play` field) — every consumer of
`MeridianEarningsReport.best_play` for a ticker that printed earnings earlier the same session
(Meridian's Report tab) showed this contradiction for the rest of the trading day, until the
`days_until` rollover at midnight.

### Fix rationale

Threaded the already-computed `printed` boolean into `bestPlayHint` and added a dedicated
printed-branch mirroring `headline`'s own beat/miss/mixed framing (reaction-trade phrasing instead
of "wait for"/"into earnings"), checked *before* the day-distance branch. `risk` text is reused
verbatim from the matching pre-print branch where the framing still applies; only `headline`/
`structure` change to drop the forward-looking claim. The `verdict`-branch test
("the verdict branch is untouched — an inline print does not get re-routed") is unaffected — this
fix touches only `best_play`, never `verdict`.

### Tests

Added two cases to `meridian-earnings-report-core.test.ts`, reusing the same `PRINTED_TODAY`
fixture the existing headline/confidence tests use: one asserting `best_play.headline`/`.structure`
never reads as pre-print once printed, one asserting the wait-for-print hint is preserved for an
actually-upcoming print. RED→GREEN confirmed: reverting only the source fix (keeping the new tests)
fails 1/12 exactly as expected; reapplying passes 12/12.

- `npx tsx --experimental-test-module-mocks --test src/lib/meridian/meridian-earnings-report-core.test.ts` — 12/12 pass
- `npx tsc --noEmit` — clean
