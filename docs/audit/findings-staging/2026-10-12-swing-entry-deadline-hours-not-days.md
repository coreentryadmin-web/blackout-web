## 2026-10-12 — [Night Hawk Swings / Ask Largo] WATCH play's "Entry window closes" line said "1 day left" with only hours remaining — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Night Hawk Swings / Ask Largo play-brief | P3 — misleading precision on a timing line a member would act on, not a wrong direction/value | FIXED |

**What's wrong.** `watchEntrySection` (`src/lib/swing/play-brief.ts`) rendered a WATCH play's
forward-looking entry-window line as:
```
const daysLeft = Math.max(0, Math.ceil((deadlineMs - readMs) / 86_400_000));
`Entry window closes **${etStampFromIso(play.entryDeadline)}** (**${daysLeft} day${daysLeft === 1 ? "" : "s"}** left) — stale after that, wait for a fresh setup.`
```
`Math.ceil()` rounds ANY positive sub-24h remainder up to "1 day" — a deadline 4 hours away and one
23 hours away both read identically to a deadline genuinely ~1.0 days out. **Live repro:** MRVL
WATCH brief (`GET /api/market/swing/play-brief?playId=SWING:MRVL&ticker=MRVL&status=WATCH`),
fetched 2026-10-12 05:03 ET — `entryDeadline` 2026-10-12 09:15 ET, same calendar day, ~4h12m away —
rendered `Entry window closes **2026-10-12 09:15 ET** (**1 day** left)`. A member reading "1 day
left" at 5am would reasonably plan to act later that day or the next morning; the real window
closes before most members are even awake.

**Fix.** New `entryWindowTimeLeftLabel(msLeft)` helper: below 24h remaining, renders hours
(`Math.max(1, Math.ceil(msLeft / 3_600_000))`, so a genuine few-minutes-left case still floors to
"1 hour" rather than "0 hours"); at/above 24h, keeps the original day-granularity phrasing
unchanged (verified byte-identical for the pre-existing 5-day-out test case).

**Second bug found while adding a determinism-pinned regression test.** The pre-existing 2026-09-18
test for this same line never set `ctx.readMs`, so `composeSwingPlayBrief` silently fell through to
the real `Date.now()` instead of the fixture's intended "now" (`asOf`) — it only stayed green
because its assertion regex (`\d+ days?`) is loose enough to match "0 days" too, which is what the
real clock (now long past that fixture's 2026-09-15 deadline) actually produced. Tracing *why*
pinning `ctx.readMs` had no effect surfaced the real root cause: `watchEntrySection`'s call site
(`composeSwingPlayBrief`, ~line 1379) passed the outer `readMs` local (always `Date.now()`) instead
of `ctx.readMs`, which an earlier fix (play-brief-types.ts's `readMs` field doc comment) already
stamps to an injected override when one is present — and that same doc comment already named "the
other ~18 `Date.now()` call sites" as a known, deferred class of this exact gap. This is one
concrete instance of that already-documented class, fixed because it was directly blocking this
PR's own regression test from being meaningful; the other ~17 sites remain the documented follow-up,
unchanged.

**Fix (call site).** `watchEntrySection(play, readMs)` → `watchEntrySection(play, ctx.readMs ?? readMs)`.

**Fix (test hygiene).** The 2026-09-18 test now explicitly sets `readMs: Date.parse(ctx.asOf)` so it
asserts what its name claims (a 5-day-out deadline reads in days) instead of coasting on a loose
regex and the accident of today's real date.

**Regression guard.** New test in `src/lib/swing/play-brief.test.ts`: a sub-24h `entryDeadline`
(4h12m out) asserts the line reads "5 hours" (ceil'd), not "1 day". RED→GREEN confirmed: reverting
just `entryWindowTimeLeftLabel` to the old `Math.ceil(... / 86_400_000)` fails this new test with
"1 hour" (clamped-to-zero artifact once combined with the readMs fix) or "1 day" (pre-readMs-fix);
restoring it passes.

**Verification.** `src/lib/swing/play-brief.test.ts` → 129/129 pass. Full `src/lib/swing/*.test.ts`
→ 1685/1685 pass. `tsc --noEmit` clean.

**Blast radius.** `watchEntrySection`'s one "Entry window closes" line, and the one test it exposed
as non-deterministic. No other caller of `entryWindowTimeLeftLabel` (new, private to this file) or
of the fixed call site exists.

Found live during the standing Ask Largo deep-dive (5-engine monitor cycle), re-verified against
the actual production response (not just the code) before fixing, and the root cause traced fully
(not just patched at the symptom) once the fix's own regression test refused to pass for a reason
unrelated to the fix itself.
