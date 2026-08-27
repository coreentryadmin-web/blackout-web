> **kind:** `FINDING`

## Vector pick "% vs pick" used WS last-trade mark while entry anchor was chain mid — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `contract-picks/live/route.ts`, `vector-pick-live-status.ts`, `use-vector-pick-live-monitor.ts` |
| **Severity** | P2 — misleading premium drift on contract picks, not a ledger/accounting bug |

### Root cause

Rank-time `entryMid` comes from the option chain's bid/ask mid (`contractPremium` in
`vector-play-candidates.ts`). The live poll path preferred `getLiveOptionMarkSync().mark`
directly as `mid`, but the options WS stores `mark` as `midOf(bid, ask)` on quote frames and
can fall back to **last trade** on trade-only frames while bid/ask are still live. That made
"% vs pick" disagree with the visible bid–ask range and could swing tens of points on thin 0DTE
names.

A second UX bug: contract picks refresh every 45s in RTH; each refresh rewrote `entryMid` from
the latest chain pass, resetting "% vs pick" even when the same OCC was still on screen.

### Fix

1. `resolveVectorPickLiveMid()` — prefer `resolveZeroDteMark(bid, ask, last|mark)` (same lane as
   Night Hawk live marks).
2. `premiumDriftPct()` — delegate to `pinnedLivePnlPct()` for one rounding formula.
3. `pinVectorPickEntryMid()` — pin first-seen entry mid per OCC for the ticker session so 45s
   refreshes do not reset drift.
4. `scripts/audit/vector-pick-pnl-audit.mjs` — multi-ticker live cross-check harness.

### Blast radius

Vector contract picks card + live status chip only. Suggested Play (`buildVectorPlay`) unchanged.
