# 2026-11-09: Largo's live SPX Slayer mini-panel colored every play "bull" regardless of direction

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`fetchMiniPanelPayload()` (`src/lib/largo/mini-panel.ts`), the data builder behind Largo's live
desk mini-panel (`GET /api/market/largo/mini-panel`, rendered by `LargoDeskMiniPanel.tsx`), colored
the SPX Slayer "Action" row (`/spx-slayer /play` and `/spx-slayer /gates` submodules) and the
default "Play" row with:

```ts
tone: (p?.action ?? "").toLowerCase().includes("short") ? "bear" : "bull",
```

`action` is `SpxPlayAction` (`src/features/spx/lib/spx-signals.ts`):
`"SCANNING" | "WATCHING" | "BUY" | "HOLD" | "TRIM" | "SELL"`. None of those six literals contains
the substring `"short"` (or `"long"`) — the check was dead code that ALWAYS fell through to the
`"bull"` branch, regardless of the live play's actual direction. A short/bearish SPX Slayer play
rendered a green "bull" tone pill on both its Action and Play rows; a long/bullish play happened to
render correctly only by coincidence (every outcome of the dead check is "bull").

The value text itself (`p?.action`, e.g. `"SELL"`/`"HOLD"`) was always correct — only the color was
wrong, and wrong in exactly one direction (every bearish play, never a bullish one).

## Root cause

The real direction lives on a completely separate field, `SpxPlayPayload.direction`
(`SpxPlayDirection | null`, `src/features/spx/lib/spx-play-payload.ts`), set by the play engine
independently of `action` (a BUY/HOLD/TRIM/SELL/WATCHING/SCANNING *state*, not a directional claim).
The narrowed local cast used to build these rows,

```ts
const p = play as { phase?: string; action?: string; grade?: string; spot?: number } | null;
```

didn't even carry `direction` — so whoever wrote the tone expression reached for the only
action-shaped string in scope and pattern-matched it for a word ("short") it structurally never
contains, instead of reading the field that actually answers the question. This is the same bug
shape as the "presentation field sourced from the wrong parallel field" lens this audit round
targeted (see `legacyBoardMeter`'s premium-value/stock-tone mismatch, PR #7820, same session) — two
facts about one play (what it's doing vs. which way it's pointed) rendered as if they were one.

## Evidence (RED → GREEN)

New test file `src/lib/largo/mini-panel-direction-tone.test.ts`, exercising the newly-exported pure
helper `spxDirectionTone`.

RED (pre-fix, via `git stash` isolating only the `mini-panel.ts` source change, test left in place):

```
not ok 1 - spxDirectionTone colors bear for a short play (the live bug: this used to read bull)
  error: '(0 , import_mini_panel.spxDirectionTone) is not a function'
not ok 2..4 — same (function didn't exist pre-fix)
# pass 0  # fail 4
```

(The stronger form of RED — the fix is a precondition for the test to even run, confirming the
exported symbol itself is new, not just its return value.)

GREEN (post-fix, stash restored):

```
ok 1 - spxDirectionTone colors bear for a short play (the live bug: this used to read bull)
ok 2 - spxDirectionTone colors bull for a long play
ok 3 - spxDirectionTone renders untoned (no fabricated bull) when direction is unknown/null
ok 4 - spxDirectionTone never matches on the action string's own vocabulary
# pass 4  # fail 0
```

`npx tsc --noEmit`: clean. Also re-ran `mini-panel-orphaned.test.ts`,
`desk-scope-ticker.test.ts`, `vector-horizon-consistency.test.ts` alongside the new test
(17/17 pass) — no regression in the surrounding mini-panel/desk-scope suite.

## Fix

- Added `direction?: string | null` to the narrowed `p` cast in the `spx-slayer` branch of
  `fetchMiniPanelPayload`.
- Added an exported pure helper, `spxDirectionTone(direction)`, returning `"bear"` for `"short"`,
  `"bull"` for `"long"`, and `undefined` (no fabricated tone) for anything else — matching the
  existing refusal discipline this file already uses elsewhere (`biasTone` returns `"neutral"`
  rather than guessing when it can't read a bias).
- Replaced both `(p?.action ?? "").toLowerCase().includes("short") ? "bear" : "bull"` call sites
  (the "Action" row under `/play`/`/gates`, and the default "Play" row) with
  `spxDirectionTone(p?.direction)`.
- `null`/unknown direction (e.g. `SCANNING` with no play yet) now renders untoned instead of a
  fabricated bullish lean — `LargoDeskMiniPanel.tsx` already handles an absent `tone` correctly
  (`row.tone && TONE_CLASS[row.tone]`), so this needed no UI change.

Did not touch `biasTone` or any of the other `tone:` assignments in this file (e.g. the `net_gex`/
`net_premium`-based ones) — those already derive their tone from the exact same field they display,
and were independently verified correct while tracing this bug.

## Blast radius

Grepped the whole repo for the same dead-substring-on-action-text shape
(`action.*includes("short")`, `action.*includes("long")`,
`\.action.*toLowerCase().includes`) after the fix: zero remaining matches outside this file's own
explanatory comment — this was the only call site.

**Scope note:** `src/lib/largo/mini-panel-orphaned.test.ts` documents that `LargoDeskMiniPanel` is
currently unmounted (`#2387` removed its only mount) — so this bug has no live rendered surface
today. It remains a real, live-reachable defect: the `GET /api/market/largo/mini-panel` route itself
is still served and returns this wrong tone on every SPX Slayer short play, and the component is
documented as staged for a possible re-mount, so the fix is worth landing now rather than waiting
for a re-mount to rediscover it.
