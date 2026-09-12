> **kind:** FINDING

## Swing play-brief "Invalidation" callout showed live "exit or cut size" guidance for CLOSED plays — FIXED

**Status:** FIXED (PR opened off `fix/swing-brief-closed-invalidation`)

### Root cause

`composeSwingPlayBrief` (`src/lib/swing/play-brief.ts`) computes `envelope.invalidation` — the
BieAnswerEnvelope field the UI (`BieAnswer.tsx`, line ~125) renders unconditionally as a labeled
"Invalidation" callout whenever it is non-null — via an unconditional fallback chain:

```ts
const invalidation =
  play.thesisBreak?.level === "break"
    ? play.thesisBreak.note ?? "Thesis break — structural invalidation fired."
    : resolveBreakInvalidation(ctx) ??
      play.gateBlocks?.[0]?.reason ??
      (bucket === "open" && play.exitPolicy?.stop_premium != null
        ? `Premium stop at ${fmtUsd(play.exitPolicy.stop_premium)}`
        : null);
```

Only the LAST fallback (`Premium stop at ...`) checked `bucket === "open"`. The first three —
`thesisBreak.note`, `resolveBreakInvalidation(ctx)` (a real per-ticker technical level computed
from **today's live** Vector spot / GEX walls / gamma flip — see its own doc comment, built for
2026-09-09's WATCH-bucket gate-reason fix), and the raw `gateBlocks?.[0]?.reason` — all ran
unconditionally regardless of `statusBucket(play)`.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:NVDA:20&ticker=NVDA&status=CLOSED`
(2026-09-12, position STOPPED 2026-08-21 — three weeks earlier):

```
"invalidation": "**Break watch** — lose **217.50** on a closing basis → structural support
failed; exit or cut size."
```

Same shape confirmed on `SWING:TSM:11` (STOPPED 2026-08-19). Both briefs' own "Chart technicals"/
"Since it closed" sections correctly label the spot/levels as current-since-close context — but
the "Invalidation" callout is a DIFFERENT, unlabeled UI element (`BieAnswer.tsx`'s
`bie-answer-invalidation` block) that carries no such disclosure and reads as live, actionable
risk management ("exit or cut size") on a position that has no more risk to manage.

### Blast radius

Single call site — `composeSwingPlayBrief`'s `invalidation` assignment is the only place this
envelope field is built for the swing play-brief. `resolveBreakInvalidation` itself is unchanged
(it is also called by `tradeManagerNarrativeSection`'s own "Break watch" bullet inside the
"Trade manager read" section, which IS bucket-gated already — that section only renders for
`open`/`watch` per `composeSwingPlayBrief`'s `if (bucket === "watch") ... else if (bucket ===
"open") ... else { sections.push(closedSection(play)) }` branch — so only the standalone
`envelope.invalidation` field, not the narrative prose, had the gap).

### Fix

Added a `bucket === "closed"` short-circuit to `null` before the existing fallback chain in
`src/lib/swing/play-brief.ts`. A CLOSED play now renders no "Invalidation" callout at all — the
existing "Outcome"/"Since it closed"/"Lessons" sections already carry the historical read, and
that is where a closed play's information belongs.

### Regression test

`src/lib/swing/play-brief.test.ts` — `"composeSwingPlayBrief: CLOSED play omits the live 'exit or
cut size' invalidation callout"`. RED pre-fix (asserted `null`, got the live "Break watch ... exit
or cut size" string via `git stash`), GREEN post-fix.
