> **kind:** FINDING

## Swing play-brief `briefContentKey` leaked full-precision unrounded floats past the route's own `roundFloats()` pass — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Owner** | Claude (Ask Largo / Night Hawk Swings ownership mandate) |
| **Files** | `src/lib/swing/play-brief-diff.ts`, `src/lib/swing/play-brief-diff.test.ts` |

### Context

Standing Ask Largo deep-dive (2026-09-11 cycle): pulled live `GET /api/market/swing/play-brief`
envelopes for three real positions (NRG #34, CG #25, GOOG watch, AAPL #36 closed) and read them
against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points, specifically checking for raw/
unrounded floats (a class this repo's own CLAUDE.md already names as systemic: "several endpoints
serve unrounded floats ... round at the data layer").

### Root cause

`GET /api/market/swing/play-brief`'s route handler wraps its whole response in
`roundFloats({ available: true, ...brief })` specifically so no unrounded float reaches a client.
But `composeSwingPlayBrief()` already builds one field, `briefContentKey`, as a pre-serialized
JSON **string** (via `briefContentKey(snap)` in `play-brief-diff.ts`), built from the raw
`BriefSnapshot` numbers (`pnlPct`, `mark`, `spot`, `gammaFlip`, `callWall`, `putWall`,
`trimsFired`) with no rounding applied. `roundFloats` walks objects/arrays/numbers recursively but
treats a string as an opaque leaf — so the numbers baked inside that already-stringified JSON
sailed straight through the route's rounding pass untouched.

**Live repro (AAPL #36, closed STOPPED play, 2026-09-11 pull):**

```json
"briefContentKey": "{\"headline\":\"STOPPED — AAPL 327.5C 5DTE\", ... ,\"pnlPct\":-56.18644067796611, ...}"
```

`-56.18644067796611` is the raw `mark/entry - 1` float; every other number in the same envelope
(the rendered "Exit P&L: **-56.2%**" text, the `levels[]` array, etc.) is correctly rounded to 2dp
because those are plain numeric fields `roundFloats` can see.

### Blast radius

Contained: `briefContentKey` is an internal SSE-dedupe / diff-baseline key
(`src/hooks/useSwingPlayBrief.ts`) — never rendered to a member, never read by Largo chat (this
route is explicitly the deterministic, no-Anthropic panel). No user-facing display was wrong. Two
reasons it was still worth fixing rather than leaving as a cosmetic non-issue:
1. It is still raw, unrounded data leaving a production API response — the exact class this
   repo's CLAUDE.md flags as systemic, and the route's own `roundFloats()` call demonstrates the
   intent was "nothing unrounded leaves this endpoint," an intent this one field silently defeated.
2. A "stable" dedupe key built from full-precision floats is fragile: two refreshes computing the
   same logical P&L through a slightly different floating-point path (e.g. the existing
   `blendedPnlPct` branch vs the plain `play.pnlPct` branch) could disagree in the 10th decimal
   place with no real change to report, producing a spurious "content changed" SSE push. Rounding
   removes that noise floor.

### Fix

`briefContentKey()` now calls the shared `roundFloats()` helper (same one the route already uses,
same 2dp default) on the plain snapshot object *before* `JSON.stringify`, instead of stringifying
raw fields directly. Purely additive/internal — the dedupe key's shape and field set are
unchanged, only the numeric precision inside it.

### Evidence

- `src/lib/swing/play-brief-diff.test.ts`: new test constructs a snapshot with the real repro
  value (`pnlPct: -56.18644067796611`) and asserts (a) the raw string never appears in the
  resulting key, (b) the parsed `pnlPct` rounds to `-56.19`.
- RED→GREEN proven via `git stash` isolating the source fix from the test: reverting only
  `play-brief-diff.ts` while keeping the new test reproduces the failure (1 fail / 15 pass);
  restoring the fix returns to 16/16 pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): run in progress at time of PR open — see PR CI (`verify`) for final
  count; no regressions expected (change is additive, existing assertions on `briefContentKey`'s
  gated-null fields in `play-brief.test.ts` are integers already unaffected by rounding).
