> **kind:** FINDING

## Swing play-brief: Verdict line showed raw "SKIP" under a headline that said "HOLD" — FIXED

| | |
|---|---|
| **Status** | FIXED, PR pending |
| **Lane** | Night Hawk Swings / Ask Largo play-brief |
| **Severity** | P2 — member-visible contradiction inside a single answer, no data loss |
| **Found by** | Live forensic sweep, `GET /api/market/swing/play-brief?playId=SWING:SLV&ticker=SLV&status=WATCH`, 2026-09-10 09:47 ET |

### Root cause

`composeSwingPlayBrief` (`src/lib/swing/play-brief.ts`) builds two independent strings from the
same underlying "what does the desk say" concept, with two DIFFERENT fallback chains:

- The envelope headline (line ~543, pre-existing, correct):
  `` `${action?.label ?? play.recommendation ?? play.status} — ${headline}` `` — three rungs,
  action label first, then the member-facing `recommendation`, then the raw internal `status`.
- The Verdict section's own inline line (line ~502, the bug):
  `` `**${headline}** · ${play.direction} · ${action?.label ?? play.status}` `` — only TWO
  rungs. It skips `play.recommendation` entirely and falls straight from `action.label` to the
  raw `play.status`.

For a RESEARCH-section WATCH row, `swingEntryVerdict` (`src/lib/swing/entry-verdict.ts:207-215`)
deliberately splits these two concepts: `deckStatus: "SKIP"` (an internal classification — it
drives `play.status`, and `swingActionDisplay`'s own comment says this is intentional: "SKIP
deliberately returns null so the honest PASSED lifecycle pill shows") vs
`recommendation: "HOLD"` (the member-facing word, paired with the explanatory `recNote`, "Desk
is passing this setup — no entry recommended."). `swingActionDisplay` correctly returns `null`
for `status === "SKIP"` (play-card-lifecycle.ts:285), so both fallback chains reach their second
rung — and disagree, because only one of them has that rung.

### Evidence (live, SLV, 2026-09-10 09:47 ET)

Real production response, same brief, same request:

```
"headline": "HOLD — SLV 59C 6DTE"
...
"body": "**SLV 59C 6DTE** · LONG · SKIP\n\nGrade **A** · score 60\n\n... \n\nDesk is passing this setup — no entry recommended."
```

A member reading the top-level headline sees "HOLD" (a neutral, wait-and-see word); three lines
into the very same answer, the Verdict section flatly states "SKIP" — the internal deck
classification never meant to be member-facing — directly followed by "no entry recommended."
Two contradictory verdict words for the identical concept, in the identical response.

### Fix

`play-brief.ts`'s Verdict line now uses the same three-rung fallback as the headline:
`action?.label ?? play.recommendation ?? play.status`. This makes the two strings agree by
construction — same source data, same precedence — rather than by coincidence.

### Blast radius

Single call site (`play-brief.ts`'s Verdict line construction). The headline's fallback chain
was already correct and untouched. `swingActionDisplay`'s `status === "SKIP" -> null` behavior
and `entry-verdict.ts`'s deliberate `deckStatus`/`recommendation` split are correct by design and
were not touched — this fix only makes the Verdict section read the same field precedence the
headline already used, it does not change what either underlying field means.

### Regression test

`src/lib/swing/play-brief.test.ts` — "composeSwingPlayBrief: SKIP-status Verdict line agrees
with the envelope headline, not raw status (2026-09-10 gap fix)". RED before the fix (asserted
`· SKIP` was absent, got `· SKIP`); GREEN after.

### Why not caught earlier

No existing test locked the Verdict line's literal fallback chain (only the Entry section's
separate "Entry stance" line had a "verdict parity" test, from a different earlier fix, for a
different section). The two fallback chains were written at different times and never compared
side by side until this live forensic pass fetched the full envelope (headline + all sections)
for a genuinely RESEARCH/SKIP-classified WATCH row and read both together.
