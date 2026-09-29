## Ask Largo swing brief's "Lessons" section re-asked a question "Trade manager read" had already answered with the computed cushion — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `buildIntelSections`'s CLOSED-bucket call site (`src/lib/swing/play-brief-intel.ts`) |
| **Severity** | P3 (member-facing narrative quality — same restatement class as four prior fixes in this file, 2026-09-06/10/13/18/20/21) |
| **Status** | FIXED — `fix/swing-lessons-stop-cushion-dedup` |

### Root cause

`closedCoaching`'s 2026-09-28 fix (`play-brief-narrative-coaching.ts`) replaced its generic
"check if entry was extended past invalidation" ask with a computed cushion answer — "entry X
vs invalidation Y, a Z% cushion at commit..." — whenever `entryTriggerUnderlyingPx`/
`invalidationUnderlyingPx` are both pinned on the closed play (the common case, not the absence
edge case that fix's own fallback still covers). But `buildIntelSections`'s CLOSED-bucket
`stopAdviceAlreadyNoted` dedup flag — which exists precisely to suppress "Lessons"'s sibling
generic ask once "Trade manager read" already covers the same ground — only ever string-matched
the OLD generic phrasing. The new cushion-answer sentence doesn't contain that substring, so the
flag silently evaluated `false` on every stopped CLOSED play with both levels present, and
"Lessons" kept independently re-asking a question the section immediately above it had just
answered with real numbers.

### Evidence

Live repro, HUT position #43, real production play-brief (CLOSED, STOPPED, peak +8.5%, exit
−50.9%):
- "Trade manager read" (`closedCoaching`): "**Stop fired** (stopped) — entry **100.97** vs
  invalidation **94.01**, a **+6.9%** cushion at commit; a thin cushion here means the entry was
  already extended, not that the stop was wrong."
- "Lessons" (`lessonsSection`, same response, immediately below): "Stop loss — check if
  invalidation level was respected or entry was extended."

Confirmed via `git log`/source read: `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` are
both non-null and finite on this row (pinned at commit, static, survive close per
`closed-plays.ts`'s own doc comment) — exactly the condition that makes `closedCoaching` emit the
cushion phrasing instead of its own fallback ask.

### Blast radius

Single call site (`buildIntelSections`'s `bucket === "closed"` branch). Every stopped CLOSED
swing play-brief whose `entryTriggerUnderlyingPx`/`invalidationUnderlyingPx` are both pinned
(the common case since the 2026-09-28 fix) was affected — the absence case (either level missing)
was unaffected, since `closedCoaching`'s own fallback there still uses the old phrasing the
existing string match already catches.

### Fix rationale

Rather than widening the string match to also recognize the new phrasing (which would need
re-widening for any future third phrasing, the exact trap a prior fix in this same file's history
explicitly called out and avoided), gate on the same structural condition `closedCoaching` itself
uses to choose its phrasing: `play.closedReason === "stopped"` plus both underlying-price levels
finite and non-zero. This is provably correct — whenever that condition holds, `closedCoaching`
renders the cushion answer, so `stopAdviceAlreadyNoted` must be `true`; when it doesn't hold,
`closedCoaching` falls back to the old generic ask, which the existing substring match already
detects. Every other independent lesson (MFE capture number, verdict lines, archetype tag,
exec-vs-mid slippage) is untouched.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts` (Node
  20) — RED→GREEN independently confirmed via `git stash` isolation of only the source fix: 1/202
  failed (the new test) with the fix stashed, 202/202 pass with it restored.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief.test.ts src/lib/swing/play-brief-narrative-coaching.test.ts src/lib/swing/play-brief-narrative.test.ts src/lib/swing/play-brief-context.test.ts`
  — 569/569 pass.
- `npx tsc --noEmit` — clean.
