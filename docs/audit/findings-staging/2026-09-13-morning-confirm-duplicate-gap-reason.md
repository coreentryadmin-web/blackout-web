> **kind:** FINDING

## Morning-confirm DEGRADED reason quoted the same SPX gap twice — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Legacy — morning-confirm verdict engine (`morning-confirm-verdict.ts`) |
| **Severity** | P3 (narrative/UX quality — redundant text, not a wrong verdict) |
| **Found by** | Night Hawk Legacy standing audit mandate, 21:21 UTC cycle, 2026-09-13 |

### Root cause

`computePlayVerdict` runs two separate gap checks that both key off the exact same
`Math.abs(gapPts) > GAP_PTS_THRESHOLD` condition:

- **Check 1** ("Gap against the play's direction") — fires only when the gap is *against* the
  play's direction. When the play is a single name whose own premarket is still within its plan
  (stop not breached), it soft-DEGRADEs with a specific reason: `"SPX gapped -25.0 pts against
  LONG direction — TEST pre-market still within plan, treat as caution"`.
- **Check 4** ("Gap in same direction — may run stops / change R:R") — a generic catch-all that
  runs whenever `status !== "INVALIDATED"`, re-testing the identical `Math.abs(gapPts) >
  GAP_PTS_THRESHOLD` condition with no check of whether check 1 already handled this exact event.

When check 1 takes its softer "stockConfirms" branch (status becomes `DEGRADED`, not
`INVALIDATED`), check 4's guard (`status !== "INVALIDATED"`) still passes, so it ALSO fires for
the same gap and appends a second, redundant sentence: `"SPX gapped -25.0 pts — verify entry
levels, stop may be unsafe"`.

### Evidence

Reproduced directly:

```
reason: "SPX gapped -25.0 pts against LONG direction — TEST pre-market still within plan,
         treat as caution; SPX gapped -25.0 pts — verify entry levels, stop may be unsafe"
```

The same gap magnitude is quoted twice, back to back, in the member-facing DEGRADED tooltip/
reason text served by `GET /api/nighthawk/play-status`. New regression test in
`morning-confirm-verdict.test.ts` asserts exactly one `"SPX gapped"` mention in the reason string
for this scenario (RED before the fix — 2 mentions; GREEN after — 1).

### Blast radius

Single function, single caller (`src/app/api/cron/nighthawk-morning-confirm/route.ts`), which
passes `reason` straight through with no other parsing — no other consumer depends on the old
duplicated shape.

### Fix rationale

Added a `gapReasonAdded` flag, set when check 1's softer branch already describes the gap event;
check 4 now skips when that flag is set. Check 4 still fires normally for the cases it exists to
cover (a large gap that's favorable/neutral to the direction, or an against-direction gap on an
index/ETF play that check 1 already hard-INVALIDATED before check 4 is even reached via the
`status !== "INVALIDATED"` guard) — only the exact double-counted scenario is suppressed.

Considered instead: removing check 4 entirely and folding its warning into check 1. Rejected —
check 4 is the ONLY check that flags a large *favorable* gap (no direction test at all), which is
real and independently useful ("stop may now be unsafe" applies even when the gap helps the
thesis); collapsing the two would either lose that case or conflate two different reasons for the
same status change.

### Verification

- New test RED before fix (2 "SPX gapped" mentions) / GREEN after (1).
- Full `morning-confirm-verdict.test.ts` (26 tests): all pass, no existing behavior changed.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): 14120 pass / 0 fail.
