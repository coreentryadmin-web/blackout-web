> **kind:** FINDING

## A swing position that closed at EXACTLY its entry price (0% P&L) was labeled "stopped" — implying a stop-loss fired when nothing actually did — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

Live repro, `GET /api/market/swing/record` (2026-09-13): 5 of the 21 closed swing positions
served (NFLX#12, WULF#13, IGV#16, WULF#17, PYPL#24 — all from the engine's earliest days,
2026-08-17…21) carry `entryPremium === peakPremium === troughPremium` **byte-identical** — the
premium never moved a single cent across the whole holding period — yet render
`closedReason: "stopped"`, `exitPnlPct: 0`. "Stopped" means a stop-loss actively fired; a position
that closed unchanged from its own entry price never triggered one.

Traced to `closedDeckSourcesFromChains` (`closed-plays.ts`):

```js
// BEFORE
const compositeReason =
  record.composite.outcome === "win"
    ? "target"
    : record.composite.outcome === "loss"
      ? "stopped"
      : src.closedReason;
```

`record.composite.outcome` (`record.ts`) is **deliberately conservative** by design —
`isSwingWin(pnl)` requires `pnl > 0`, so a leg that closes at EXACTLY 0% makes `allLegsWon` false,
and the composite reports that unconditionally as `"loss"` (the file's own documented
"preserved-loss invariant" — a leg that didn't WIN is treated as not-won, on purpose, for
win-rate purposes). **This fix does not change that scoring semantics.** The bug is one level
down: this function then mapped composite `"loss"` straight to the closedReason **label**
`"stopped"` — collapsing a real, distinct third case (flat/breakeven) into the same word used for
an actual stop-loss trigger.

The codebase already has the correct three-way vocabulary everywhere else and just never reached
it here:
- The sibling **single-leg** mapper, `closedReasonFromRow` a few lines above in the SAME file,
  already gets this right: `pnl > 0 → "target"`, `pnl < 0 → "stopped"`, else `"flat"`.
- `record.ts`'s own aggregate summary carries a dedicated `breakevens` field specifically so
  "how many of the reported losses are exact breakevens rather than a real drawdown" is
  disclosed, not silently absorbed.
- The Command Deck UI (`play-card-lifecycle.ts`) already has a dedicated **"SCRATCH"** badge for
  `closedReason === "flat"`, distinct from the **"STOPPED"** badge — so these 5 live rows have
  been showing the wrong badge on the Swings CLOSED tab this whole time, not just wrong text in
  the Ask Largo play-brief's Lessons section.

### Fix

`compositeReason` now checks whether the composite's own `worstLegPnlPct` (the exact value that
gets served/displayed) is precisely `0` before falling back to `"stopped"`:

```js
const compositeReason =
  record.composite.outcome === "win"
    ? "target"
    : record.composite.outcome === "loss"
      ? compositePnl === 0
        ? "flat"
        : "stopped"
      : src.closedReason;
```

Win/loss scoring (`record.composite.outcome`, win-rate math, the `breakevens` summary field) is
**untouched** — only the human-readable label for the exact-0 case changes, bringing this path in
line with the single-leg mapper it sits three lines above.

### Blast radius

Single function (`closedDeckSourcesFromChains`). Checked every downstream consumer of
`closedReason` for a "flat"-handling gap before shipping:
- `play-brief-intel.ts`'s Lessons section and `play-brief-narrative-coaching.ts`'s post-mortem
  bullet both already fall through gracefully to a neutral `"Exit: flat"` / `"Exit reason: flat"`
  line for any reason that isn't `"target"`/`"stopped"`/`"thesis"` — no change needed, immediate
  correct behavior once the source label is right.
- `play-card-lifecycle.ts`'s `swingActionDisplay` already has the `"flat" → "SCRATCH"` branch
  (line 297) — immediate correct badge once this label is right.
- `closedRealizedPct` (same file) is unaffected: it returns `play.exitPnlPct` immediately when
  finite (0 is finite), never reaching the `closedReason === "stopped"` branches at all.
- 0DTE's own `zeroDteActionDisplay`/`zerodte-service.ts`/`play-timeline.ts` are a **separate**
  system (their own `closedReason`/`closed_reason` computation, unrelated to swing's
  `record.ts`/`closed-plays.ts`) — confirmed out of scope, not touched.

### Fix rationale

Matched the label to the vocabulary the codebase had already standardized on everywhere else
(`closedReasonFromRow`, the `breakevens` summary field, the `SCRATCH` UI badge) rather than
inventing new terminology, and deliberately left the win/loss **scoring** semantics alone — the
"a non-win counts against win-rate" choice is explicit, documented, intentional design in
`record.ts`, and this fix is about truthful labeling, not about relitigating that call.

### Evidence of testing

- Live data evidence: `GET /api/market/swing/record`, all 21 closed rows pulled and inspected —
  5 rows (well past the 3-instance noise threshold) show the `entry === peak === trough`,
  `closedReason: "stopped"`, `exitPnlPct: 0` signature, all clustered in the engine's earliest
  days (2026-08-17…21) with zero recurrence in 3+ weeks of subsequent closes since — a latent bug
  in a still-live code path, not a currently-firing one, but one that will recur the next time a
  real position happens to close at exactly its entry price.
- New tests in `closed-plays.test.ts`: an exactly-0%-P&L single-leg chain now labels `"flat"`
  (reproducing the live NFLX/WULF/IGV/PYPL/WULF shape); a real non-zero loss (`-0.01%`) still
  labels `"stopped"`, confirming the fix doesn't weaken genuine loss detection.
- RED confirmed: stashing only the source change reproduced exactly 1 failing test (the new
  flat-labeling one); the non-zero-loss test and all 6 pre-existing tests stayed green.
- GREEN: fix restored, 8/8 pass in `closed-plays.test.ts` (6 pre-existing + 2 new).
- Full `src/lib/swing/*.test.ts`: 1078/1078 pass.
- `npx tsc --noEmit`: clean.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate — a WATCH/
OPEN/CLOSED forensics pass over the live `/api/market/swing/record` payload flagged 4-of-8 recent
closes sharing an implausible "stopped, exactly 0%" shape, which crossed the standing 3-instance
noise threshold and warranted a root-cause dig rather than being dismissed as coincidence.
