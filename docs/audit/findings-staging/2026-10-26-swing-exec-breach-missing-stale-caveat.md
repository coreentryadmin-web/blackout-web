> **kind:** FINDING

## Swing "stop already breached on the executable side" bullet claims a live "right now" read off a 2+ day stale quote — FIXED

| **Status** | Fixed |
|---|---|

**Where:** `src/lib/swing/play-brief-narrative.ts`, `tradeManagerNarrativeSection`'s `execBreached`
branch (~line 1683) — the "Break watch — stop already breached on the executable side" bullet.

**Root cause:** this bullet is priced from the exact same bid/ask/`markAsOf` snapshot every
sibling line in the same function/section discloses as stale when it's old (the giveback bullet
via `giveStaleCaveat` a few dozen lines above; `pnlSection`'s P&L/Exec P&L/Greeks/Spread lines;
the "Manage plan" distance clause in `play-brief-narrative-coaching.ts`) — but it never called
`optionMarkStaleCaveat(play, readMs)`, and instead says the breach is happening "right now," an
explicit freshness claim. `readMs` was already in scope in the same function (computed at line
1510), so this was a plain omission, not a structural limitation.

**Live repro (PHM):** the brief's own `as_of` was 2026-10-25/26, while the mark snapshot was
`2026-10-23 16:00 ET` (2+ days stale). The brief rendered:

```
• **Break watch — stop already breached on the executable side** — bid **$0.00** is at/through
  your premium stop **$0.40** right now → exit or cut size.
```

with no caveat, immediately alongside 20 other occurrences of `_(stale — same quote Mark flagged
above)_` in the identical response for every other quote-derived line sourced from the same
snapshot. This is the single most action-driving line in the entire brief ("exit or cut size"),
directly below a HOLD recommendation — a trader would reasonably read "right now" as a live
observation demanding an immediate exit, when it's actually a 2-day-old illiquid print that may
no longer reflect the real current book.

**Blast radius:** exactly one call site — confirmed by grepping the repo for
`stop already breached on the executable side` / `execBreached`, which only ever appears in this
one file. PRs #6726/#6731/#6736 already swept this exact bug class (a sibling value already
carries the staleness caveat but a co-located value's render path never threads it through)
through every other call site in `play-brief.ts`/`play-brief-narrative.ts`/
`play-brief-narrative-coaching.ts` in that section — this was the one site they missed.

**Fix:** append `optionMarkStaleCaveat(play, readMs)` to the bullet's template string, matching
the exact pattern used at the sibling giveback bullet four lines earlier in the same function.
No other field, gating logic, or precedence changed — the bullet still fires under the exact same
`execBreached` condition as before; only the trailing disclosure text changes, and only when the
underlying quote is actually stale (the helper returns `""` when it isn't).

**How this was found:** a background Workflow audit (5 ticker-pairs, 10 fresh swing tickers not
previously checked this session) surfaced 2 candidates. The other candidate (TTD, a claimed false
"Vector desk state: fetch failed" self-contradiction) was unanimously refuted by 3 independent
adversarial verifiers — the underlying bug class was real but already fixed by PR #6643 two days
prior, and the claimed text no longer reproduces live. This PHM finding was unanimously confirmed
(3/3, no refutations) by independent source-code reads and fresh live re-fetches.

**Test:** `play-brief-narrative.test.ts` — new regression test reproducing the exact PHM shape
(confirmed zero bid, `markAsOf` 2+ days stale, `HOLD` status) asserting the bullet now carries the
caveat. Verified RED→GREEN by stashing the source fix (fails without it, passes with it restored).
Full `src/lib/swing/*.test.ts` suite: 2093/2093 pass. `tsc --noEmit`: clean.
