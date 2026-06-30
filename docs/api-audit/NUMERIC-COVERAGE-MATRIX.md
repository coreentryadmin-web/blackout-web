# Numeric Coverage Matrix — full UI + data plane

> **Purpose.** The audit backlog for "confirm every number on every page is correct, with proper
> validation." One row per surface: what numbers it shows, which endpoint serves them, which
> verifier (if any) checks them, whether a **true independent oracle** confirms them (L4), and
> whether the **rendered UI value** is verified end-to-end.
>
> Built statically from the code on 2026-06-30. Granularity is surface→endpoint→metric (the
> actionable unit). This is the map; Steps 2–3 (UI harness, new oracles) hang off it.

## How to read it

Confidence tiers, strongest → weakest (from `src/lib/correctness/types.ts`):

- **CONFIRMED** — a second *independent source* agreed within tolerance (L4 cross-provider). The only
  tier that proves a number is *objectively* right.
- **CONSISTENCY-ONLY** — every internal/invariant/sanity/recompute check held, but **no independent
  oracle exists** for this metric. Proves the served number matches its own inputs — not that the
  inputs are right. A *coverage gap*, never a false green.
- **NONE** — no verifier touches this metric at all. A *blind spot*.
- **UI-render** — does anything assert the number *painted on the page* equals the API value it came
  from? Today: **NO for every surface** (see Gap #1).

Independent oracles that exist today:
| Oracle | Confirms |
|---|---|
| Polygon `I:SPX` index | desk SPX spot |
| UW native GEX ladder | desk + heatmap GEX King, net-GEX sign |
| Massive `/v3/trades` tick reconstruction | flows net premium |

---

## The matrix

| Page / surface | Serving endpoint(s) | Verifier | Numbers shown | Best data-plane tier | UI-render verified | Priority |
|---|---|---|---|---|---|---|
| **Dashboard — SPX desk** | `market/spx/desk`, `spx/merged`, `spx/pulse` | `desk` | spot, VIX, GEX King, net-GEX, call/put walls, gamma flip, MAs | **CONFIRMED** (spot, king, net-sign); consistency-only (walls, flip, MAs) | ❌ | P1 |
| **Heatmap** | `market/gex-heatmap`, `gex-positioning`, `heatmap` | `heatmap` | net_gex, King, gamma_flip, per-strike GEX/VEX/DEX/CHARM, spot | **CONFIRMED** (net_gex, king); consistency-only (gamma_flip, spot, matrix cells) | ❌ | P1 |
| **Flows** | `market/flows`, `flow-brief` | `flows` | net premium, per-alert premium, call/put $, counts | **CONFIRMED** (net_premium); consistency-only (per-row) | ❌ | P1 |
| **Flows — dark pool / anomalies** | `market/dark-pool`, `market/anomalies` | — | dark-pool levels, $ premium, anomaly scores | **NONE** | ❌ | P2 |
| **Nights-Watch (positions)** | position stream + chain valuation | `nights-watch` | mark, current value, unrealized/realized P&L, %, breakeven, DTE | consistency-only (mark — formula re-derived, **no external price oracle**) | ❌ | **P1 (money)** |
| **Track-record** | `market/spx/outcomes`, `useSpxTrackRecord` | `track-record` | hit-rate, W/L, P&L points, streaks | consistency-only (hit_rate recomputed) | ❌ | P1 (money) |
| **Grid — 8 panels** | `grid/analysts`, `congress`, `dark-pool`, `sectors`, `movers`, `catalysts`, `earnings`, `economy` | — | price targets, congress $, sector %, mover %, EPS/surprise, macro values | **NONE** | ❌ | **P2 (broad blind spot)** |
| **Market context ribbon** | `market/indices`, `market/regime` | `market-context` | SPX, VIX, breadth, sector tide | consistency-only (no oracle) | ❌ | P2 |
| **Night Hawk** | `market/nighthawk/edition`, `hunt`, `play-explain` | `nighthawk` | entry/target/stop, conviction, expected move | consistency-only (grounding/text, **numbers not oracle-checked**) | ❌ | P2 |
| **Terminal (Largo)** | `market/largo/query`, `session` | `largo` | quoted figures inside generated answers | consistency-only (feed grounding only) | ❌ | P2 |
| **Data layer (cross-cutting)** | Redis snapshots + Postgres | `data-integrity` | freshness, pg↔redis hop reconciliations | consistency-only (no oracle by design) | n/a | P3 |
| **Misc numeric endpoints** | `market/news`, `quote`, `ticker-search`, `oi-change`, `market-tide`, `vix-term-structure`, `total-options-volume`, `top-net-impact`, `sector-etfs`, `correlations` | — | various | **NONE** | ❌ | P3 |

---

## The three gaps this matrix exposes

### Gap #1 — UI render layer is universally unverified (every row ❌)
All 9 verifiers check **API output**, never the number rendered on the page. So formatting bugs, unit/×100
errors, wrong field bindings, and stale client SWR cache are invisible. `OPEN-ISSUES.md` already notes
the browser sweep is **blocked** (prod Clerk rejects test creds). → **Step 2: Playwright harness** (Chromium
preinstalled) that loads each page with a real premium session and asserts `rendered === source API value`
within formatting tolerance. This is the single highest-leverage addition.

### Gap #2 — CONSISTENCY-ONLY metrics (no independent oracle)
These are internally consistent but unconfirmed. Prioritized for new oracles:
- **Nights-Watch mark / P&L** (money, P1): no second options-pricing source. Candidate oracle: a second
  chain provider, or a synthetic mark from underlying + Black-Scholes with served IV as a bound.
- **Heatmap gamma_flip + per-strike matrix** (P1): only net_gex/king are oracle-backed. Candidate: UW
  per-strike GEX ladder already in use — extend the cross-check past King to the whole ladder.
- **Track-record hit_rate** (money, P1): recomputed from stored outcomes; no independent settlement source.
  Candidate: re-derive each closed outcome's W/L from Polygon EOD bars vs the stored entry/target/stop.
- **Desk walls / MAs**, **market-context breadth/VIX** (P2).

### Gap #3 — NONE (no verifier at all)
- **All 8 Grid panels** (P2, broad): analyst PTs, congress $, sector %, movers %, earnings EPS/surprise,
  macro values — zero coverage. Each has an obvious upstream to diff against (Benzinga/UW/Polygon).
- **Dark-pool / anomalies**, plus the misc endpoint list above.

---

## Recommended execution order

1. **Now (done):** this matrix — the backlog.
2. **Step 2 — UI harness** (Gap #1): the one layer no verifier covers; unblocks "full UI" scope. Needs a
   real premium browser session.
3. **Step 3a — oracles for P1 money numbers** (Gap #2): Nights-Watch P&L, track-record settlement.
4. **Step 3b — Grid panel verifiers** (Gap #3): largest blind-spot surface by count.
5. **Step 3c — extend existing oracles** (heatmap full ladder) + P2/P3 mop-up.
