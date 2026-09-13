> **kind:** FINDING

## Legacy board winner/runner classification ignores the stockMovePct fallback when pnlPct is unavailable — HELD, reported for a design decision

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy ("ambiguous/live-picks-logic → report, hold"), no code changed |
| **Area** | Night Hawk Legacy — board table row classification (`legacy-board-table-utils.ts`) |
| **Severity** | P3 (scorecard/badge undercounting — never over-counts, so it's an omission not a fabrication) |
| **Found by** | Night Hawk Legacy standing audit mandate, 21:36 UTC cycle, 2026-09-13 |

### The gap

`legacyRowKind()` and `legacyVectorStatus()`'s winner/runner threshold check
(`legacy-board-table-utils.ts:66-73` and `:58-62`) both read `play.pnlPct` directly:

```ts
function legacyRowKind(play: TerminalPlay): VectorBoardRowKind {
  ...
  const pct = play.pnlPct;
  if (pct != null && pct >= 50) return "winner";
  if (pct != null && pct >= 15) return "runner";
  return "live";
}
```

But `legacy-primary-pnl.ts`'s `legacyPrimaryPnlPct(play)` — the function every OTHER Legacy P&L
display already goes through (`CommandDeck.tsx`, `TerminalPremiumPanels.tsx`,
`LegacyPlayDetailPanel.tsx`, `LegacyPlayManageRail.tsx`, `PlayTerminal.tsx`) — is
`play.pnlPct ?? play.stockMovePct ?? null`, because `play.pnlPct` is explicitly nulled by
`overlayLegacyQuotes` (`use-legacy-quotes.ts`) whenever a live option mark isn't currently
available (a documented, deliberate "FAIL CLOSED" — see that file's own header comment), which per
this session's earlier trace (20:21 UTC cycle) is the common case: `overlayLegacyOptionMarks` only
re-populates `pnlPct` when a live mark AND a known entry premium both resolve. The healthcheck this
whole session has consistently found both currently-open Legacy positions' marks flagged stale,
i.e. `pnlPct` is very plausibly `null` for them right now, with `stockMovePct` as the only signal
of how the trade is actually going.

**Consequence:** a Legacy play whose underlying has moved hard enough to imply a real winning/
runner outcome, but which has no live option mark this tick, is classified as plain `"live"`/
`"open"` by the board table (never `"runner"`/`"winner"`) — silently under-representing it in
every consumer keyed off `kind`/`status`: `buildLegacyBoardRows`, `vectorBoardScorecard`'s runners/
winners/`runnerPipelinePct`/`winnersFloorPct` tallies, and any UI badge driven by row `kind`. This
is the same *shape* of bug as the 2026-09-10 FICO incident already fixed in this exact file (a real
move not correctly counted toward the shared scorecard) — but via the stock-fallback path rather
than the "structural branch never reached" path that incident's fix addressed, and that fix did not
also cover this path.

### Why this is HELD, not fixed outright

This file's `premiumPct` field (and the CSV export's `premium_pct` column) deliberately does
**not** fall back to `stockMovePct` — it stays `play.pnlPct ?? null`, i.e. displays nothing rather
than a stock-derived number under a "premium" label. That is consistent with `use-legacy-quotes.ts`'s
explicit design principle: a stock's % move and an option's % return are not the same magnitude
(a 5% stock move can be a 200% option return or a total loss), so silently substituting one for the
other under a number labeled "premium" is exactly the failure mode that file's FAIL CLOSED comment
exists to prevent.

`legacyPrimaryPnlPct` avoids that trap differently: it computes a "headline" number for DISPLAY
call sites that also carry (or can compute) a co-located "which basis is this" label —
`CommandDeck.tsx` explicitly renders `{p.pnlPct != null ? "Premium" : "Stock"}` right next to the
number. `LegacyBoardTableRow` has no equivalent basis-label field; `kind`/`status` are bare enums
consumed generically by `vectorBoardScorecard` alongside 0DTE/Vector/Swing rows that have no
stock-fallback concept at all.

So the real question is a genuine design decision, not a one-line bug: should the winner/runner
**classification** (a boolean "is this going well enough to badge," distinct from the **displayed
number**) use the stock-move proxy when the option mark is unavailable, accepting the imprecision
in exchange for not silently under-counting real winners? Or is leaving it option-pnl-only correct
specifically because a stock-move threshold is a poor, potentially unreliable proxy for whether the
*option* position — the thing actually held — is a winner (IV crush, wide spreads, and strike
selection can all break the correlation)?

Per the standing escalation policy ("ambiguous/live-picks-logic → report, hold"), raising this for
a decision rather than picking a side unilaterally — unlike the two other fixes shipped this
session (PRs #4944, #4945), which had one clearly-correct behavior once traced. Note the asymmetry
if left as-is: this omission can only ever UNDER-count real runners/winners, never fabricate one
that isn't real — a materially safer failure direction than the FICO incident's original "always
zero" bug, which is presumably why it has gone unnoticed since the FICO fix shipped.
