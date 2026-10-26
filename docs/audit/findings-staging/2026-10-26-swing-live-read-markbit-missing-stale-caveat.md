> **kind:** FINDING

## Swing "Live read" degraded-fallback bullet shows a stale option mark with no staleness caveat — FIXED

| **Status** | Fixed |
|---|---|

**Where:** `src/lib/swing/play-brief-narrative.ts`, `degradedReadLine()` (~line 1387-1495) —
the `markBit` that feeds the "Trade manager read" section's reserved "Live read" bullet. This
bullet is the one fallback `tradeManagerNarrativeSection` renders whenever Vector/GEX spot isn't
wired this tick (bucket OPEN/WATCH with `spot == null`).

**Root cause:** `markBit` was built as
`play.mark != null && !optionMarkGenuinelyUnknown(play) ? ' · mark **${fmtOptionUsd(play.mark)}**' : ''`.
This correctly guards the TRUE entry-fallback case ("mark literally never synced," fixed
2026-09-14 for the identical RKLX/PGY repro — see the comment immediately above it in the same
function) via `optionMarkGenuinelyUnknown`, but it never called the shared
`optionMarkStaleCaveat(play, readMs)` helper (`play-brief-absence.ts`) for the far more common
"real mark, but its `markAsOf` timestamp is old" case (`optionMarkIsStale`). `readMs` was already
computed and in scope at the one call site (`tradeManagerNarrativeSection`, `const readMs =
ctx.readMs ?? Date.now()`), but `degradedReadLine`'s own signature only took `(play, bucket)` —
`readMs` was simply never threaded through, so the function had no way to know how old the quote
was even though the information was one parameter away.

This is the exact same bug class PRs #6726/#6731/#6736/#6756 already swept through every other
quote-derived line in this same file/section (a sibling value already carries the staleness
caveat but a co-located value's render path never threads it through) — #6756 fixed the "Break
watch — stop already breached" bullet in this identical function/section for this identical root
cause just hours before this finding; `degradedReadLine`'s own `markBit`, a sibling render path a
few dozen lines away in the SAME function, was the one site that sweep missed.

**Live repro (PANW, `GET /api/market/swing/play-brief?playId=SWING:PANW:67&ticker=PANW&positionId=67&status=HOLD&expandIntel=1`,
2026-10-26 ~08:24 ET):** Position section correctly read `Mark: **$19.45** (2026-10-23 16:00 ET)
_(stale)_`, and the SAME response's "Trade manager read" section correctly carried
`_(stale — same quote Mark flagged above)_` on both the "Manage plan" and "Executable P&L"
bullets for the identical $19.45 figure — but the "Live read" bullet three lines away rendered:

```
• **Live read** — Vector spot not wired on this tick; desk still says **HOLD** · thesis **80%**
  · mark **$19.45**. Levels refresh on next poll.
```

with no caveat at all, even though the quote (`markAsOf` 2026-10-23 16:00 ET) was over 64 hours
stale by the time of the read (2026-10-26 08:24 ET; top-level Largo-contract `age_seconds:231857`
on the same response).

**Blast radius:** exactly one call site — `degradedReadLine` has one caller
(`tradeManagerNarrativeSection`), confirmed by grepping the repo for `degradedReadLine`. No other
function reimplements this markBit logic.

**Fix:** threaded `readMs` into `degradedReadLine`'s signature (`readMs: number = Date.now()`,
same default-valued convention every other `readMs`-taking helper in this file uses), passed
`ctx.readMs ?? Date.now()` from the one call site (it was already in scope as the local `readMs`
there), and appended `optionMarkStaleCaveat(play, readMs)` to the markBit's dollar figure — the
same pattern `degradedReadLine`'s own `giveStaleCaveat` sibling and the Break-watch bullet
(#6756) already use. `optionMarkStaleCaveat` returns `""` when the mark isn't actually stale, so
this is a no-op for a fresh mark and only changes output when the mark is genuinely aged — no
other field, gating logic, or precedence changed.

**Test:** `play-brief-narrative.test.ts` — two new regression tests: one reproducing the exact
PANW shape (real mark, `markAsOf` 64+ hours stale, `pnlPct` non-null so `optionMarkGenuinelyUnknown`
is false) asserting the "Live read" bullet's mark now carries the caveat, and one proving a FRESH
mark (`markAsOf` 4 minutes old) still renders with no caveat at all, confirming the fix is a true
no-op in the non-stale case. Verified RED→GREEN by stashing the source fix alone (fails with the
exact PANW-shaped assertion message without it, passes with it restored). Full `npm test` on Node
20: 17054/17054 pass, 0 fail, 3 skipped (pre-existing, unrelated). `tsc --noEmit`: clean.
