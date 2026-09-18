## 2026-09-10 — Ask Largo swing play-brief never narrated how long a WATCH thesis has been building — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings — Ask Largo play-brief (`src/lib/swing/play-brief.ts`) |
| **Severity** | P3 (dead-wired data / narrative completeness gap, not a live-trading bug) |
| **Found by** | Night Hawk Swings audit lane, standing v3 mandate ("aggressive improvement-hunting... a signal that exists but isn't surfaced in the play-brief") |

## Root cause

`TerminalPlay.detectedAt` — the "WATCH Published clock", already threaded from `HorizonDeckSource.firstSeenAt` through `terminalPlayFromHorizon` (`adapters.ts`) and rendered on the live Command Deck panel — was never read by `play-brief.ts`'s `watchEntrySection`, the function that composes the Ask Largo narrative for a WATCH-status play. A member asking Largo directly about a WATCH candidate had no way to learn whether it was flagged an hour ago or over a month ago; the brief read identically either way.

## Evidence

Live check of the WATCH lane (`GET /api/market/nighthawk/horizons?view=swings`, 2026-09-10) found real rows sitting well below the 60-point commit score floor for extended periods with no narrative distinction from freshly-flagged candidates:

```
AMD:  score 20.6 (floor 60), firstSeenAt 2026-07-27 — 45 days
FSLR: score 59.1 (floor 60), firstSeenAt 2026-08-31 — 10 days
PLTR: score 34.3 (floor 60), firstSeenAt 2026-09-01 — 10 days
```

This clears this lane's own 3-instance noise threshold. Confirmed `fadeStaleSwingCandidates` (`accumulation-store.ts`) already fades a candidate that stops re-qualifying in fresh discovery scans — so a persistent row like AMD is a genuinely re-qualifying signal, not an orphaned one nobody prunes. But "still qualifying" and "still fresh" are different facts, and the play-brief only ever surfaced the first.

## Fix

Added a `daysOnWatch(sinceIso, nowMs)` helper and a new line in `watchEntrySection` (only emitted when `play.detectedAt` is present, never fabricated): `"First flagged **N days ago** (ET date) — still on WATCH, not yet graduated to a real position."` Threaded `readMs` (already computed once at the top of `composeSwingPlayBrief`) into `watchEntrySection` rather than calling `Date.now()` inside the narrative builder, matching the file's existing convention (`gexFreshness(gex, readMs)`).

## Fix rationale

No new data plumbing was needed — `detectedAt` already reaches every WATCH-status `TerminalPlay`, it just wasn't read anywhere in `src/lib/swing/*.ts`. This is purely additive: one new conditional line in an existing section, no other section, gate, or calibration touched. Deliberately scoped to the fact alone ("N days ago") rather than also citing the score-floor gap (e.g. "45 pts below the commit floor") — the commit score floor is not currently threaded onto `TerminalPlay` at all, and adding that plumbing is a separate, larger change better left for its own PR if wanted.

## Blast radius

`watchEntrySection` is called from exactly one place (`composeSwingPlayBrief`'s `bucket === "watch"` branch) — grepped, confirmed no other caller. `TerminalPlay.detectedAt` was already read elsewhere (Command Deck UI); this fix only adds a NEW reader, changes nothing about how `detectedAt` is populated.

## Tests

`src/lib/swing/play-brief.test.ts`: two new tests — a WATCH play with a real (backdated) `detectedAt` narrates the age line with the correct day count; a WATCH play with `detectedAt: null` omits the line entirely rather than fabricating one.

`npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts`: 42/42 pass.
Full suite (Node 20): 13584 pass / 0 fail / 3 skipped. `npx tsc --noEmit`: clean.
