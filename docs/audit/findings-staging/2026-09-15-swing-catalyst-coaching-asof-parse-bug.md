> **kind:** FINDING

## PR #5000's own "earnings already printed" fix shipped as dead code — `ctx.asOf`'s real production format silently failed to parse — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** the same-day-earnings "already printed" detection shipped in PR #5000
(`catalystCoaching`, `src/lib/swing/play-brief-narrative-coaching.ts`) computed
`const nowMs = Date.parse(ctx.asOf)`. In REAL production, `ctx.asOf` is built by
`loadSwingPlayBriefContext` as `etStamp(nowMs) ?? new Date(nowMs).toISOString()`
(`play-brief-context.ts:181`) — `etStamp` returns `"YYYY-MM-DD HH:mm ET"` and essentially never
throws for a valid `Date.now()`, so the ISO fallback never fires in practice. `Date.parse` on that
format returns `NaN` (confirmed directly: `Date.parse("2026-09-14 20:36 ET")` === `NaN`), so
`Number.isFinite(nowMs)` silently gated `alreadyPrinted` to `false` unconditionally — the entire
branch PR #5000 shipped was dead code in production, regardless of how long ago a print had landed.

**Why PR #5000's own regression tests didn't catch this:** every test added with that PR built
`ctx.asOf` as an ISO-8601 literal (`"2026-09-14T23:07:00.000Z"`), which `Date.parse` handles fine —
a fixture shape that never matched what the real context loader emits. The tests correctly proved
the *branching logic* was right; they never exercised the *parse call* against real data shape, so
green tests shipped a feature that could never fire outside the test suite.

**Evidence (live reproduction, 2026-09-15, PLAY):** re-verified PLAY's real brief (the exact ticker
PR #5000's original finding used) ~4h05m after its print landed, well past the fix's own 16:00 ET
threshold — still showed the old, pre-fix text: `**Earnings in 0d** (2026-09-14 (afterhours)) —
size down or exit before report unless thesis is earnings-driven.` Independently confirmed by
running the real, unmodified `catalystCoaching` standalone with a production-shaped `ctx.asOf` and
the same earnings fixture — reproduced the identical stale bullet.

**Blast radius:** identical to PR #5000's own — every same-day earnings position read after the
print's own implied bell-relative time. The difference is this blast radius was NEVER actually
closed by that PR; this fix is what actually closes it.

**Fix:** `nowMs` now uses `parseEtStamp(ctx.asOf) ?? Date.parse(ctx.asOf)` — `parseEtStamp` (already
imported in this file, already used to build `printThresholdMs`) correctly parses the real
`"YYYY-MM-DD HH:mm ET"` shape; the `Date.parse` fallback still covers the rare case `ctx.asOf` is
genuinely an ISO string (the `etStamp` failure fallback).

**Fix rationale:** reused `parseEtStamp` rather than writing a new parser, since it was already
imported for the identical purpose two lines below (`printThresholdMs`) — the file already trusted
this exact function to parse ET-stamped strings correctly; the bug was only that `nowMs` used the
wrong parser for the same kind of string. Updated the existing 5 regression tests to build `asOf`
in the real ET-stamp shape (`"2026-09-14 19:07 ET"`) instead of ISO literals, so a future regression
in the parse call — not just the branching logic — fails a test again, per the exact lesson this bug
teaches.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed the 2 "already landed" tests —
now using real-shaped `asOf` fixtures — fail against the pre-fix `Date.parse`-only code exactly as
production did; restored and confirmed all 96 tests in the file pass green). Full
`src/lib/swing/*.test.ts` (1139 tests) green, `tsc --noEmit` and `eslint` clean on both changed
files.
