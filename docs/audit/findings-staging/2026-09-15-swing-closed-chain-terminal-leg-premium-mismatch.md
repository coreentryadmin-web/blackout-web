> **kind:** FINDING

## A rolled CLOSED swing chain's entry/peak/trough premium described the TERMINAL leg while the reported exit P&L described a different, worse EARLIER leg — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `closedDeckSourcesFromChains` (`src/lib/swing/closed-plays.ts`) intentionally overrides
`exitPnlPct` with the chain-composite worst-leg P&L (`record.composite.worstLegPnlPct`) — the
preserved-loss invariant `record.ts`'s own file header documents (a winning later leg must never net
away a losing earlier one). But `entryPremium`/`peakPremium`/`troughPremium` were left untouched from
`src`, which is `closedDeckSourceFromRow(terminal)` — the TERMINAL leg only. Whenever the worst leg is
an earlier (non-terminal) leg — a rolled chain where the parent lost more than the child — the served
row pairs one leg's realized-loss P&L with a completely different leg's own price bounds.

**Evidence (live reproduction, 2026-09-15, forensic batch 31):** INTC SHORT chain, rootPositionId 30
(`GET /api/market/swing/record?days=180`):
- Leg 0 (id=30, rollSeq 0): entry 3.60 → exit 2.13, realized **-40.83%**
- Leg 1 (id=35, rollSeq 1, terminal): entry 2.26 → peak 2.84 → exit 1.51, realized **-33.19%**
- Composite `worstLegPnlPct` = -40.83 (leg 0)
- The served row showed `entryPremium: 2.26, peakPremium: 2.84` (leg 1's own bounds) alongside
  `exitPnlPct: -40.83` (leg 0's loss) — peak-vs-entry computed **+25.7%**, a POSITIVE number next to a
  reported **-40.83%** loss, for a peak that chronologically postdates the loss it was paired with
  (leg 1 didn't exist until leg 0's roll).

**Downstream impact:** `terminalPlayFromClosedSwing` converts this straight into a `TerminalPlay` for
the Command Deck Closed tab. `primaryReturnPct`/`primaryReturnLabel` (`play-card-display.ts`) prefer
`peak` as the CLOSED-tab headline number ("Peak Return"), so this fabricated a green "+25.7%" headline
for a chain whose real worst outcome was a loss.

**What was already correctly guarded:** the per-position Ask Largo play-brief (`play-brief-resolve.ts`)
already avoids this by construction — it never applies the chain-composite override, and uses the
single leg's own numbers throughout. The bug was confined to the list-view/Closed-tab path
(`closedDeckSourcesFromChains`'s served `closedDeck` array).

**Fix:** when the worst leg is NOT the terminal leg, omit (null) `entryPremium`/`peakPremium`/
`troughPremium` in the served row rather than pair the terminal leg's real bounds with a different
leg's outcome — honest omission over a fabricated pairing, per this codebase's own absence principle.
`primaryReturnPct` already has a clean fallback to the actual exit P&L when peak is null
(`play-card-display.ts`), so this is a safe, already-supported no-crash path.

**Fix rationale:** minimal, single-file change. Considered sourcing entry/peak/trough from the worst
leg's own row instead of nulling them — rejected because the worst leg's premium bounds are tied to a
DIFFERENT contract (different strike/expiry after a roll) than the one shown in `contract`/`occ`
(still sourced from the terminal leg for identity), which would create a second, arguably worse
mismatch (a dollar premium paired with the wrong contract). Omission avoids fabricating either pairing.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed the new "omits entry/peak/trough
when worst leg is not terminal" regression test — built directly off the live INTC repro shape — fails
against pre-fix code with the exact production symptom, restored and confirmed it passes, alongside a
second new test proving the same-leg case is unchanged). Full `src/lib/swing/*.test.ts` (1150 tests,
+2) and `src/features/nighthawk/command-deck/*.test.ts` (405 tests) green, `tsc --noEmit` clean.
