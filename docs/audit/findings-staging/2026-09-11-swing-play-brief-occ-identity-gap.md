> **kind:** FINDING

## Ask Largo swing play-brief — committed position's ledger OCC symbol discarded before reaching TerminalPlay — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo / Night Hawk Swings — `src/lib/swing/play-brief-resolve.ts` |
| **Contract point** | C4 IDENTITY (`docs/audit/LARGO-PRODUCT-CONTRACT.md`) |
| **Severity** | P3 — correctness/identity hardening, no user-visible symptom found this cycle (see below) |

### Context

Standing mandate: `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points, audited this cycle with a
focus on IDENTITY and TIME for live swing plays. Pulled three real committed positions off
production (`NRG#34`, `NN#32`, `CG#25`) via `GET /api/market/swing/play-brief` and traced the
envelope back to its source.

### Root cause

`horizonRowToDeckSource()` (`play-brief-resolve.ts`) — the function that turns a lane play into
the `HorizonDeckSource` consumed by `terminalPlayFromHorizon` — hardcoded:

```ts
occ: null,
```

unconditionally, for every caller. Its one comment claimed this was correct for a WATCH/lane-only
candidate ("no ledger row yet"), which is true for that caller (`resolveSwingPlayForBrief`'s WATCH
path, line ~292) — but the SAME function is also called from `loadOpenTerminalPlay` (line ~219-229)
for a live **COMMITTED** ledger row, where `row.contract_occ` (stamped at commit by
`src/lib/swing/commit.ts` via `occFromChainContract`, and re-stamped on a roll by
`src/lib/swing/roll-plan.ts`) was already in scope and simply discarded.

Downstream, `terminalPlayFromHorizon` (`adapters.ts`) falls back to reconstructing an OCC from
`contract.strike`/`expiry`/`right` when `src.occ` is empty — so this did not read as a hard
failure (a symbol was always shown), and in the common case reconstruction agrees with the stored
value, since strike/expiry/right on a live row normally match the held contract. But the ledger's
`contract_occ` is the position's own authoritative record — the exact value `commit.ts` pinned and
`roll-plan.ts` re-pins on a roll — and is what `use-live-marks.ts`'s `overlayLiveMarks` keys its SSE
live-mark lookup on (`p.occ`) elsewhere in the deck. Preferring a same-tick reconstruction over the
ledger's own stamped identity is backwards, and the two are not guaranteed to agree in every case
(the reconstruction path has no cross-check against the ledger at all).

### Evidence

Live `GET /api/market/swing/play-brief` responses for NRG#34, NN#32, CG#25 (2026-09-11, prod)
never carried a machine-identifiable OCC/contract symbol field anywhere in the JSON — only a
human string baked into the headline ("NRG 110C 7DTE"). Traced server-side: `row.contract_occ` is
populated at commit (confirmed via `git grep contract_occ` — write sites in `commit.ts`,
`roll-plan.ts`; read sites in `live-marks-active.ts`, `closed-plays.ts`, `swing-active-refresh`)
but `horizonRowToDeckSource()`'s hardcoded `occ: null` discarded it before it ever reached the
brief for a live position.

Regression test added to `src/lib/swing/play-brief-resolve.test.ts` (RED confirmed via
`git stash` on the source fix, GREEN after — a deliberately MISMATCHED `contract_occ` vs.
strike/expiry/right proves the ledger value wins over reconstruction, not merely that the two
happen to agree):

```
- 'O:NRG261016C00115000'
+ 'O:NRG260918C00110000'   (RED: reconstruction won, ledger value discarded)
```

### Fix

`horizonRowToDeckSource()` takes an optional 4th `occ` parameter (default `null`, preserving the
WATCH-lane caller's existing honest-absence behavior unchanged). `loadOpenTerminalPlay()` now
passes `occSymbolFromSwingRow(row)` — the existing, already-used, fail-closed helper
(`src/lib/swing/occ-from-row.ts`, never reconstructs, only returns the ledger's own stored
`contract_occ`, `O:`-normalized) — for the one call site that has a live ledger row in scope.

### Blast radius

- `loadOpenTerminalPlay` → `resolveSwingPlayForBrief` → `GET /api/market/swing/play-brief`: a
  committed position's brief now carries its ledger-authoritative OCC.
- `TerminalPlay.occ` for this play is now the ledger value, which is what
  `use-live-marks.ts`'s `overlayLiveMarks` keys its SSE live-mark lookup on — no behavior change
  when the two already agreed (the common case), but now correct if a live row's contract fields
  and its `contract_occ` were ever to diverge.
- WATCH-lane candidates (no ledger row) and the CLOSED-play path (separate function,
  `terminalPlayFromClosedSwing`, already threads `src.occ` from `closedDeckSourceFromRow`)
  unaffected.

### What was deliberately left unchanged

`terminalPlayFromHorizon`'s own strike/expiry/right reconstruction fallback (`adapters.ts`) is
untouched — it is the correct, harmless fallback for callers that genuinely have no stored OCC
(WATCH lane, and any other pre-ledger context), and remains in place for this play too as a safety
net if `occSymbolFromSwingRow` ever returns null.

### Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — check a live committed swing position's
play-brief again once the deploy is live and confirm the underlying OCC (via the ledger/DB, not
visible in the current envelope response body) matches the position actually held, especially for
any position that has rolled recently.
