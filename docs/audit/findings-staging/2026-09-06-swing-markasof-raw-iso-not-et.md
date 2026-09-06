> **kind:** `FINDING`

## Option-mark timestamps reached the swing play-brief as raw ISO-8601 UTC, never converted to the Largo C1 "YYYY-MM-DD HH:mm ET" format — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (HIGH per source audit — Largo contract violation, member/model-facing) |
| **Area** | Night Hawk Swings — Ask Largo play-brief (`play-brief.ts`, `play-brief-intel.ts`) |
| **PR** | (pending) |

### Symptom

`docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` finding #21: `LARGO-PRODUCT-CONTRACT.md`'s C1
requires every dated value reaching Largo to go through the shared `etStamp()`/`etSessionDate()`
convention ("YYYY-MM-DD HH:mm ET") — specifically because a raw epoch/ISO instant forces the model
to guess a session convention (the contract's own worked example: a dated close came out a full
session wrong). `play.markAsOf` is a raw ISO string sourced straight from the DB and was inserted
unconverted into three places: the "Position" section body (`Mark: **$X** (2026-09-04T21:45:18.663Z)`),
the top-level evidence array (`text`/`provenance.asOf`), and the "Data freshness" section. The
swing brief's own top-level `asOf` was already fixed to use `etStamp()` in PR #4142 (merged hours
before the audit snapshot, with an explicit "Largo C1" comment) — but that fix didn't touch
`markAsOf`, so the identical defect class remained live in the same code path. Live evidence: all 4
open-position envelopes sampled (CG, NN, NRG, CRWD) showed the raw-ISO pattern verbatim.

### Fix

Added `etStampFromIso()` to `src/lib/largo/temporal/bar-session-date.ts` — the same module that
already owns `etStamp`/`etSessionDate`/`parseEtStamp` for this contract. It accepts a raw ISO-8601
instant (rather than `etStamp`'s epoch-ms), `Date.parse`s it, and falls back to the original string
if unparseable (never silently drops the value — same defensive pattern `play-brief-context.ts`
already uses for the brief's own top-level `asOf`). Wired into all three `markAsOf` render sites in
`play-brief.ts` (Position section body, evidence `text`, evidence `provenance.asOf`) and
`play-brief-intel.ts` (Data freshness section). The freshness-age math in `evidenceFromContext`
(`Date.parse(ctx.play.markAsOf)` against the raw ISO) is untouched — only the DISPLAYED string
changes; the internal epoch computation still uses the original raw value directly.

### Evidence (RED → GREEN)

Added 3 unit tests for `etStampFromIso` in `bar-session-date.test.ts` and 2 integration tests
(one in `play-brief.test.ts`, one in `play-brief-intel.test.ts`) reproducing the exact live shape
(`"2026-09-04T21:45:18.663Z"` → `"2026-09-04 17:45 ET"`). Proof via `git stash` on the three source
files (Node 20): **RED** — 5/5 new tests fail (raw ISO printed instead of the ET stamp). **GREEN**
(post-fix): 41/41 pass across `bar-session-date.test.ts` + `play-brief.test.ts` +
`play-brief-intel.test.ts`.

Full `src/lib/swing/*.test.ts` + `src/lib/largo/temporal/*.test.ts`: 688/688 pass. The Largo C1
contract ratchet (`src/lib/largo/contract/session-anchor.test.ts`): 6/6 pass, unaffected (this fix
adds no new allowlist entry). `npx tsc --noEmit`: clean.

### Blast radius

Three render sites, one new shared helper, no other consumer. `parseEtStamp`/`etStamp`/`etSessionDate`
are untouched — `etStampFromIso` is additive.
