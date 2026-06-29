# Phase 1 — Numbers Verification Matrix (live prod, 2026-06-29 ~06:46Z / 02:46 ET, market closed)

Method: screen/reader-API value ⇄ Redis/Postgres source ⇄ independent recompute. Verdicts:
**CONFIRMED** (matches independent source) · **CONSISTENT** (fresh+internally consistent, source not
recomputable here) · **STALE** (past freshness budget) · **MISMATCH** (screen≠source — P0/P1) ·
**FABRICATED** (hardcoded/no live source — P0). All reader values pulled live with the cron bearer
(redacted); all source values from prod Postgres via `DATABASE_PUBLIC_URL` (SELECT-only).

## Matrix

| Area | Element | Reader value (live) | Source (query) | Verdict | Notes |
|---|---|---|---|---|---|
| SPX desk | `price` | `7354.02` | `gex-positioning.spot` = `7354.02` | **CONFIRMED** | cross-tool spot identical |
| SPX desk | `net GEX` (`gex_net`) | **`-2.247B`** | GEX endpoint `net_gex` = **`-21.82B`** | **MISMATCH (P1)** | same metric, same ticker, ~10× apart — dual-path GEX (see F-1) |
| SPX desk | `max_pain` | **`7400`** | GEX endpoint `max_pain` = **`7425`** | **MISMATCH (P1)** | F-1 |
| SPX desk | `gex_king` | **`7400`** | GEX endpoint `call_wall` = **`7450`** | **MISMATCH (P1)** | F-1 |
| SPX desk | `gamma_flip` | **`null`** / `gamma_regime="unknown"` | GEX endpoint `flip` = **`7364.88`** | **MISMATCH (P1)** | desk fails to compute a flip the canonical source has — F-1 |
| Heat Maps | SPX `spot/walls/flip/net_gex/max_pain` | `7354.02 / 7450 / 7300 / 7364.88 / -21.8B / 7425` | recomputed from cached chain; `asof` fresh (06:46Z) | **CONSISTENT** | internally consistent + fresh; magnitude not oracle-recomputable off-hours |
| Track Record | `spxSlayer.winRatePct` | `null` (total 0) | `signal_outcomes`/`spx_play_outcomes` = **0 rows** | **CONFIRMED (honest)** | no fabrication — empty source → null, `liveData:true` ✅ |
| Track Record | `nightHawk.winRatePct` | `null` (total 0) | `signal_outcomes` (NIGHT_HAWK) = 0 | **CONFIRMED (honest)** | honest empty ✅ |
| HELIX flows | newest print time | (off-hours; tape from last RTH) | `flow_alerts.max(inserted_at)` = **Fri 2026-06-26 20:17Z** | **STALE (expected)** | weekend; UI freshness-honesty to verify at RTH (Phase 9) |
| Night Hawk | latest edition | 1 edition | `nighthawk_editions.max(published_at)` = **Fri 2026-06-26 08:05Z** | **STALE (expected)** | only 1 edition all-time; freshness-honesty + fail-closed-on-stale to verify (Phase 2) |

## DB integrity / reconciliation (prod, SELECT-only)
| Table | total | open | closed | Note |
|---|---|---|---|---|
| `spx_play_outcomes` | **0** | 0 | 0 | **F-2: SPX ledger empty all-time** |
| `spx_open_play` | **0** | 0 | 0 | F-2 — flagship has never opened a recorded play |
| `signal_events` | **0** | — | — | **F-3: signal pipeline empty** (feeds track-record + platform/intel) |
| `signal_outcomes` | **0** | — | — | F-3 |
| `flow_alerts` | 12,828 | — | — | newest Fri 20:17Z (weekend) |
| `nighthawk_editions` | 1 | — | — | only one, Fri |
| `user_positions` | 2 | 2 | — | 2 real open positions — NOT touched |
| `users` | 14 | — | — | incl. audit test accounts |

Outcome-partition reconciliation (`wins+losses+scratch == closed`) is **trivially satisfied (0==0)**
but **untested with real data** because the ledgers are empty.

## Findings

### F-1 — [P1] SPX desk dealer-positioning diverges from the canonical Heat Maps GEX (cross-tool MISMATCH)
- **Evidence:** live, same instant — `GET /api/market/spx/desk` `{gex_net:-2.247e9, gex_king:7400, max_pain:7400, gamma_flip:null, gamma_regime:"unknown"}` vs `GET /api/market/gex-positioning?ticker=SPX` `{net_gex:-2.182e10, call_wall:7450, max_pain:7425, flip:7364.88}`.
- **Why:** the desk computes its own GEX (`gex_net/gex_king/greek_exposure/strike_stacks`) over a different band/scale instead of reading `getGexPositioning()`. `HEATMAP_DATA_CONTRACT.md` mandates a single source and flags Night Hawk + Largo dual-paths; the **SPX desk is a third dual-path** and additionally fails to produce a `gamma_flip` (null) the canonical source has (7364.88).
- **Impact / blast radius:** a paid user comparing the SPX Slayer desk to the Heat Maps tool sees **different net GEX (~10×), different king/wall, different max-pain, and "unknown" gamma regime vs a clear flip** for SPX at the same moment. Violates North-Star #1 ("same figure identical everywhere"); this is the documented `#80` class. The desk is the flagship money surface, so the wrong/empty positioning could mislead a trade.
- **Recommended fix:** converge the desk's GEX (`gex_net`/`gex_king`/`max_pain`/`gamma_flip`/regime) onto `getGexPositioning("SPX")` via a thin adapter (same convergence the contract prescribes for Night Hawk/Largo). **No fix applied (audit-only).**
- **Confidence:** High (live, both endpoints, same instant).
- **Caveat:** the ~10× net-GEX gap is partly band/scale (the heatmap pulls the full chain — and PR #11 just widened its page guard), but for the **same named metric on the same ticker** any visible divergence is a user-facing inconsistency regardless of cause.

### F-2 — [P1] SPX Slayer ledger empty all-time (flagship produces no recorded plays)
- **Evidence:** `spx_open_play=0`, `spx_play_outcomes=0` (prod, all-time).
- **Impact:** the flagship desk has **never opened a tracked play**, so its track record is empty and the "track record" surface for SPX shows nulls. Matches OPEN-ISSUES **P2-C**; live-confirmed here. Whether this is correct (gates genuinely never approved) vs a broken open-path needs the RTH evaluation trace (Phase 2).
- **Confidence:** High (live counts).

### F-3 — [P1] Signal pipeline empty (`signal_events`/`signal_outcomes` = 0)
- **Evidence:** both tables 0 rows in prod.
- **Impact:** `track-record` live stats, `platform/intel` `signalAccuracy`/`regimeAccuracy`, and any "win rate by regime" surface have **no data** → render null/empty. The track-record route handles this **honestly** (returns nulls, `liveData:true`), so no fabrication — but the feature is effectively dark. Tie to F-2 (no plays → no signal outcomes).
- **Confidence:** High.

## VERIFIED CLEAN (this slice)
- **Cross-tool SPX spot** identical across desk + GEX endpoint (`7354.02`). ✅
- **Track-record does NOT fabricate** — empty source yields `null`/0, not invented win-rates; `liveData` flag present. ✅ (North-Star #2/#12 honored at the API layer; UI rendering to be confirmed Phase 9.)
- **No SQL errors / no enum drift** observed in sampled tables; outcome enum set empty (no rows) — no drift.

## Still to do in Phase 1 (next turns)
- Per-screen matrix for HELIX rows (pick 5, match to `flow_alerts`), Heat Maps cell↔headline reconcile, Night Hawk edition on-screen vs DB row, Grid panels.
- Timezone/RTH-boundary + financial-precision (×100 multiplier, rounding, Greeks) code review.
- Redis snapshot freshness (`spx:pulse:snapshot`, `gex-heatmap:*`) once Redis read access is sorted.
- **RTH pass:** live-update verification + real (non-empty) numbers for SPX desk/flows/plays.
