> **kind:** FINDING

## Swing closed-deck card identity (`positionId`) pointed at the wrong leg while content described the worst leg

| **Status** | FIXED |
|------------|-------|

**Symptom:** For a multi-leg closed swing chain, `closedDeckSourcesFromChains` (closed-plays.ts)
re-points every content field (contract/occ/mid/delta, entry/peak/trough premium) at the WORST leg
when it differs from the terminal leg — but left `positionId` pointing at the terminal leg's own
`row.id`. Live repro: AMZN chain with terminal leg id 48 (+72.41%) and worst leg id 44 (-27.67%) —
the served card's content/P&L correctly described leg 44, but its `positionId` was 48. Clicking
through resolves `play-brief-resolve.ts`'s `loadClosedPlay` by `r.id === positionId`, which builds a
brief from leg 48's own terminal row — directly contradicting the card the member just clicked.

**Root cause:** every other identity/content field already borrows from `worstLegRow` when it's set
(non-null only when the worst leg differs from the terminal leg); `positionId` was the one field
nobody had re-pointed.

**Fix:** `positionId: worstLegRow?.id ?? src.positionId` — same fallback shape every sibling field
already uses, so identity and content can never disagree again for the same card.

**Verify:** `src/lib/swing/closed-plays.test.ts` — every existing `closedDeckSourcesFromChains`
case (both live AMZN/AAPL repros, the real-absence case, and the worst-leg-is-terminal case) now
also asserts `positionId`: it must match the worst leg's own id whenever one differs from the
terminal leg, and still match the terminal leg's own id when the worst leg IS the terminal leg (no
behavior change for the common case).
