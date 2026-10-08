## 2026-10-08 — [FINDING, data-correctness] `reliableMarkFromSnapshot`'s 10x backstop-quote divergence guard missed a thin one-lot ask, fabricating a +409.1% Swing P&L and triggering a real TAKE_PARTIAL/SCALING_OUT trade-management flip live during RTH — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P1 (not cosmetic — ratcheted `peak_premium` permanently and flipped a live committed position's trade-management state based on a fabricated price; a Discord trade-alert notification may have fired off this same fabricated signal) |
| **Component** | `src/lib/providers/options-snapshot.ts` (`reliableMarkFromQuote`/`reliableMarkFromSnapshot`), `src/lib/banger/quote-tick-log.ts` |
| **PR** | fix/banger-quote-thin-ask-divergence |

### Root cause

`reliableMarkFromQuote`'s existing bid=0 backstop-quote divergence guard (added 2026-09-15 after
the CRSR incident) only falls through to the honest reference price when the bid=0 mid exceeds
`ZERO_BID_MID_DIVERGENCE_MULTIPLE` (10x) the last trade/day-close. That bar was calibrated against
a 107x divergence (CRSR) and is well-reasoned for that shape, but it has no notion of QUOTE SIZE —
a bid=0 quote backed by a real multi-lot ask and a bid=0 quote backed by a single unfillable
contract are treated identically, even though the latter is a categorically weaker signal of a
real, transactable price.

### Evidence

Live repro caught by the standing Ask Largo deep-dive, 2026-10-08, CRI (Carter's Inc.)
`O:CRI261016C00035000` — a committed Swing/Banger-origin position (`SWING:CRI:1510`):

- Polygon unified snapshot (fetched directly, independent of the app): `last_quote: {bid: 0,
  bid_size: 0, ask: 5.60, ask_size: 1, midpoint: 2.8}`; `last_trade: {price: 0.55, size: 20}`
  dated **2026-10-06** (two days earlier — the contract had not traded since); `day: {open: 0.3,
  high: 0.55, low: 0.3}` — i.e. nothing had traded above $0.55 all session.
- Divergence: $2.80 / $0.55 = **5.09x** — comfortably under the existing 10x bar, so
  `reliableMarkFromSnapshot` passed $2.80 through as "reliable."
- Independent sanity check: Black-Scholes priced the SAME contract from the snapshot's own
  inputs (spot $32.27, strike $35, 8 DTE, IV 53.08%, r=0) at **~$0.21** — consistent with the real
  $0.55 last trade, nowhere near $2.80. The contract's own stated delta (0.166) is also far too low
  for a genuine $2.80 price at this moneyness/DTE. $2.80 was never a real valuation.
- Live consequence (not cosmetic): between two horizons-board reads 23 minutes apart, the position
  flipped from `manageAction: "HOLD"` / `peakPremium: 0.475` / `livePnlPct: -59.1%` to
  `manageAction: "TAKE_PARTIAL"` / `liveStatus: "TRIM"` / `serving: "SCALING_OUT"` /
  `peakPremium: 2.8` / `livePnlPct: +409.1%` — `banger-live-sync`'s scale-out logic acted on the
  fabricated mark, **permanently** ratcheted `peak_premium` to $2.80 (peak tracking only ever
  increases, so this can never self-correct), and the Swing play-brief rendered "Recommended:
  TRIM... Trim ladder: +100% ✓... Banked: 50% @ +100%" — none of it real. `banger-live-sync`'s own
  scale-out notify path (`discord-trade-notify`) fires a Discord trade-alert on exactly this
  transition, so a real member-facing alert may have gone out off this fabricated signal.

### Blast radius

`reliableMarkFromSnapshot`/`reliableMarkFromQuote` is the SHARED guard behind Legacy
(`legacy-option-mark-row.ts`), Swing/Banger (`banger-live-sync`, `quote-tick-log.ts`), and the WS
mark stream — every consumer of a bid=0 backstop quote within the 10x-but-thin-size gap was
equally exposed. `quote-tick-log.ts`'s `buildBangerQuoteTickRow` re-derives the SAME guard
independently (its own doc comment promises byte-identical output to `reliableMarkFromSnapshot`
for the same snapshot) — updated too, so that guarantee stays true rather than silently drifting
once the snapshot-side guard tightened.

### Fix rationale

Did NOT lower the general 10x bar — it is well-reasoned for a quote with real size behind it, and
loosening it risks rejecting genuine large moves on a thinly-traded-but-real contract. Instead
added an ADDITIONAL, narrower guard: when the ask's own quoted SIZE is `<= THIN_ASK_SIZE_MAX` (1),
a much tighter `THIN_ASK_DIVERGENCE_MULTIPLE` (3x — the file's own original comment already named
"2-3x" as the realistic ceiling for honest illiquid noise) applies instead. `askSize` is OPTIONAL
on the new `reliableMarkFromQuote` signature — a caller with no size info (the WS mark stream,
which carries no quote size at all) gets exactly the unchanged prior behavior, so this is
additive and backward-compatible, not a recalibration of the existing, already-proven 10x case.

### Evidence (testing)

RED→GREEN verified via `git stash` (stashing only the two fix files, keeping the new tests):
pre-fix the CRI-shaped repro test failed (`actual: 2.8`, `expected: 0.55`); post-fix
`options-snapshot.test.ts` 43/43 (incl. a same-ratio/normal-size control proving the general 10x
bar is untouched, and an askSize-absent control proving the WS stream's unchanged behavior).
Broader related suite (`options-snapshot` + `quote-tick-log` + `legacy-option-mark-row` +
`play-brief` + `play-brief-intel`) 393/393. `tsc --noEmit` clean. Full `npm test` run separately
(see PR for the result).

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — once deployed, check that CRI's (or any other
similarly thin-quoted Banger-origin) position's `peak_premium`/`manageAction` do NOT ratchet
further off a bid=0/one-lot-ask quote; the permanently-corrupted $2.80 peak already written for
CRI is NOT retroactively fixed by this PR (peak tracking is a ratchet with no correction path —
flagged here for awareness, a separate manual/DB-level correction is a judgment call for the
operator, not something this sandbox can do with raw Postgres blocked).
