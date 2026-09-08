> **kind:** `FINDING`

## Option-mark "not synced to live tape" caveat was narrated in prose but never reached the structured unavailableSources channel — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (HIGH per source audit — Largo contract C3 violation) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief-absence.ts` |
| **PR** | (pending) |

### Symptom

Audit finding #22 (`docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md`): `dataHonestyCoaching()`
(`play-brief-narrative-coaching.ts`) already computes an exact boolean for degraded data —
`play.markIsSync === true` means the option mark is a sync quote without a freshness timestamp —
and turns it into a "Data caveat — mark not synced to live tape" bullet inside the "Trade manager
read" narrative section. But `collectBriefUnavailableSources()` (`play-brief-absence.ts`), the
function that populates the envelope's structured `unavailableSources` array (Largo contract C3),
never read `markIsSync` at all. A consumer that reads the structured contract fields rather than
scraping prose — the entire reason the contract mandates a structured absence channel — would
conclude the mark is fully live when the system's own code already knows it isn't.

Half of this finding was already fixed independently: `flow_feed_fresh === false` (HELIX quiet)
already reaches `unavailableSources` via the same function. `markIsSync` was the missed half.

### Fix

Added a `markIsSync === true` check to `collectBriefUnavailableSources()`, pushing
`{ source: "option mark", reason: "sync quote without freshness timestamp" }` — same shape and
same file as the existing HELIX/open-book/Meridian absence entries. Guarded with `ctx.play?.` since
existing test fixtures construct `ctx` without a `play` field.

### Evidence (RED → GREEN)

Added 2 tests to `play-brief-absence.test.ts`: one confirming `markIsSync: true` surfaces the new
entry, one confirming `false`/`undefined` does not. Proof via `git stash` on the source file (Node
20): RED — 1/7 fails (`expected true, actual false`). GREEN (post-fix): 7/7 pass.

Full `src/lib/swing/*.test.ts`: 651/651 pass. `npx tsc --noEmit`: clean.

### Blast radius

Single function, single new conditional. No other consumer of `unavailableSources` needed changes —
the field already existed on `BieUnavailableSource`.
