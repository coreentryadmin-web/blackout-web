> **kind:** FINDING

## Largo `buildLargoTechnicals` dropped `change_pct` on live WS price — FIXED

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0100 |
| **Priority** | P2 |
| **Area** | Largo / `get_technicals` |
| **Status** | FIXED |

### Symptom

When Polygon WS had a fresher price than the REST snapshot, `buildLargoTechnicals()` set `price` from the candle but left `change_pct: null`. Members saw a live quote with no day change beside it — unlike `/api/market/quote` and `toolQuote` paths that either rebase or carry authoritative WS `changePct`.

### Root cause

`src/lib/largo/technicals.ts` branched on WS price without calling `rebaseChangePct()` against the index snapshot (already in flight) or the equity REST snapshot.

### Fix

- Index WS: `rebaseChangePct(ws, quoteRaw[sym]) ?? row.change_pct`
- Equity WS: `wsCandle.changePct ?? rebaseChangePct(ws, equitySnap) ?? equitySnap.change_pct`
- Prefetch equity snapshot in the initial `Promise.all` (no extra serial fetch on REST fallback)

### Evidence

- `src/lib/largo/technicals-change-pct.test.ts` — source-scan regression
- `npx tsx --test src/lib/largo/technicals-change-pct.test.ts` GREEN

### RTH validation

Ask Largo for `get_technicals` on a name with live WS price during RTH — response must include a non-null `change_pct` when REST baseline exists.
