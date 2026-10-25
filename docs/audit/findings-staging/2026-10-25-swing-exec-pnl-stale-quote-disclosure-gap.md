## 2026-10-25 — [FINDING, P2 Night Hawk Swings / Ask Largo] Exec P&L reads the identical aged bid/ask quote the Greeks/Spread lines already flag stale, but carried no caveat of its own — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Swing play-brief "Position" section (`pnlSection`, `src/lib/swing/play-brief.ts`) and "Trade manager read"'s `execSlippageCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — parallel correctness sweep, 2026-10-25 |

### Symptom

Live repro, a real MRNA swing play-brief: the "Position" section read `Mark: $20.70 (2026-10-23
16:01 ET) _(stale)_`, `Greeks: Δ +0.40 _(stale — same quote Mark flagged above)_`, `Spread: 18.4%
($18.80/$22.60) _(stale — same quote Mark flagged above)_`, then `Exec P&L: **+6.7%**` with **no**
caveat. The "Trade manager read" section's `execSlippageCoaching` bullet — "**Executable P&L** —
mid +17.4% vs fill +6.7% (-11% slippage). Size exits on the bid, not the mark." — carried none
either. A reader sees three consecutive lines honestly flagged stale, then a confidently-stated
execution figure computed from that exact same aged quote.

### Root cause

`execPnlPct` (`executableFill(bid, ask, entry)`, `adapters.ts`) is priced off the identical
`contract.bid`/`contract.ask` snapshot — timestamped by the same `markAsOf` — that feeds the Greeks
and Spread lines directly above it. `pnlSection` computes a `staleCaveat` once (covering three
mutually-exclusive cases: genuinely-unknown, unsynced, or aged/stale) and applies it to the Greeks
and Spread/Quote lines, per the 2026-10-18 fix that introduced it — but the Exec P&L line, added one
sprint later (2026-10-17, CAVA repro) for an unrelated reason (the open-runner-only qualifier), never
referenced it. The identical gap exists in `execSlippageCoaching`, which performs no staleness check
anywhere in its call chain.

### Fix

Extracted the inline three-way ternary into a new shared export, `optionMarkStaleCaveat(play,
readMs)` (`play-brief-absence.ts`, alongside the existing `optionMarkIsStale`/
`optionMarkGenuinelyUnknown` it composes). `pnlSection` now calls it once (replacing its own inline
copy, byte-identical output) and appends the result to the Exec P&L line too. `execSlippageCoaching`
gained an optional `readMs` parameter (same `ctx.readMs ?? Date.now()`-defaulted shape every other
staleness-aware coaching function in that file already uses) and now appends the same caveat to its
bullet. Fixing this at one shared definition means a future second caller inherits the honest
behavior for free, rather than becoming a third independent re-derivation that can drift from the
other two.

### Blast radius

Checked every other reader of `staleCaveat`/`optionMarkIsStale` in both files — the Greeks and
Spread/Quote lines in `pnlSection` are unaffected (still call the same logic, now via the shared
function). No other consumer of `execPnlPct` exists repo-wide besides these two sites.

### Tests

- `play-brief-absence.test.ts` — 3 new tests directly exercising `optionMarkStaleCaveat`'s three
  branches (stale, genuinely-unknown, fresh).
- `play-brief.test.ts` — new test asserting the Exec P&L line carries the identical caveat text as
  the Greeks/Spread lines above it. Confirmed RED on pre-fix code (`Exec P&L: **+6.7%**` with no
  caveat, byte-for-byte matching the live repro), GREEN after.
- `play-brief-narrative-coaching.test.ts` — new test asserting `execSlippageCoaching` appends the
  caveat for a stale quote and omits it for a fresh one.

Full `src/lib/swing/*.test.ts` (2047 tests) and `npx tsc --noEmit` both pass clean.
