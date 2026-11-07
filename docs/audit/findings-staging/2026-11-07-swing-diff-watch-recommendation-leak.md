> **kind:** FINDING

## 2026-11-07 — Ask Largo: swing play-brief diff leaked the raw "HOLD" sentinel for WATCH candidates instead of the member-facing "WAIT" label — FIXED

| **Status** | FIXED on `fix/swing-diff-watch-recommendation-leak` |
| --- | --- |

**Symptom (live-confirmed, TSLA:365P WATCH):** the swing play-brief's rendered text (headline,
Entry section, Trade manager read) says "WAIT" everywhere for this candidate — "HOLD" never
appears anywhere in the brief. But `src/lib/swing/play-brief-diff.ts`'s "what changed" diff engine
(`snapshotFromBrief`/`diffBriefSnapshots`, wired into the live `SwingLargoInsightsPanel` via
`useSwingPlayBrief.ts`) read the raw internal `TerminalPlay.recommendation` sentinel directly for
display text. `entry-verdict.ts`'s `swingEntryVerdict` stamps that raw field `"HOLD"` for every
not-yet-buyable WATCH reason (its `wait`/`dont_buy` branches — a live-management-only two-value
BUY/HOLD sentinel with no "not yet buyable" value of its own), while the member-facing label for
that exact state is `"WAIT"` via `swingActionDisplay`'s WATCH branch (play-card-lifecycle.ts).
When a WATCH play's gates clear (recommendation flips HOLD -> BUY), the diff panel rendered
`**Desk action shifted** — **HOLD** → **BUY**` — a label the member had never once seen for that
ticker, which previously said "WAIT" everywhere.

**Root cause:** `snapshotFromBrief` stored only the raw `recommendation` field; the two render
sites (`synthesizePnlAndUpgrade`, the plain "Desk action shifted" fallback) interpolated it
directly instead of resolving it through the same `swingActionDisplay`/`swingVerdictVerb` chain
every other render site in this codebase already uses to get the correct member-facing verb.

**Same bug class, already fixed 3 times elsewhere in this exact codebase** — the WATCH case in
this one file was the remaining gap:
- 2026-09-07 (`BO-P2-LARGO-0907`): `watchEntrySection`/`actionNarrative`/`degradedReadLine`
  (play-brief.ts / play-brief-narrative.ts).
- 2026-11-01: the Legacy-product sibling `overlayLegacyQuotes`.
- 2026-11-02: this SAME file's CLOSED-transition case (`nextIsGenuinelyClosed`, scoped
  deliberately to CLOSED only — its own doc comment leaves WATCH as a separate, unaddressed gap).

**Fix:** Added `BriefSnapshot.recommendationLabel` — the resolved member-facing verb, computed by
a new `recommendationDisplayLabel(play)` helper scoped to `play.status === "WATCH"` only (every
other status falls through to the raw `recommendation` value unchanged, a deliberate no-op since
`swingActionDisplay` already agrees with `recommendation` for OPEN/HOLD/TRIM, and CLOSED/SKIP's own
display leaks are the already-noted, deliberately-separate gaps, left untouched). `recommendation`
itself is unchanged and still what `recommendationShiftKind`/`RECOMMENDATION_RANK` read for
upgrade/downgrade classification — only the two display sites were repointed at
`recommendationLabel`. `loadPersistedBriefSnapshot`'s schema guard extended with the same
type-schema-honesty check already applied to every prior field added to `BriefSnapshot`.

**Blast radius:** `src/lib/swing/play-brief-diff.ts` only (2 render sites, 1 new field, 1 new
helper, 1 schema-guard line). No other call site's signature changed.

**Evidence:** Live repro (TSLA:365P WATCH, prod, 2026-11-07) + in-process repro of
`diffBriefSnapshots` with a HOLD->BUY WATCH transition, both showing the raw-sentinel leak before
the fix. Two new regression tests added to `play-brief-diff.test.ts`: the WATCH HOLD->BUY case now
asserts `recommendationLabel === "WAIT"`/`"BUY"` and that the rendered line reads
`**WAIT** → **BUY**` with no `"HOLD"` anywhere in the output; a second test asserts
`recommendationLabel` is an exact no-op for OPEN/HOLD/TRIM/SKIP. Full existing 47-test file still
passes unchanged (49/49 total). `npx tsc --noEmit` clean. Full `npm test` run before merge.

Found via the standing "5-ENGINE LIVE MONITOR + Ask Largo" deep-dive mandate (CLAUDE.md).
