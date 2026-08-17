# Meridian data audit

Live upstream probe for every data lane Meridian reads. Run:

```bash
node scripts/audit/meridian-data-audit.mjs
```

Requires `POLYGON_API_KEY` and `UW_API_KEY` in env. Output: `audit-output/MERIDIAN-DATA-AUDIT.md` + JSON.

## Endpoint → upstream map

| Meridian surface | App route / lib | Upstream | Cache |
|------------------|-----------------|----------|-------|
| Timeline | `/api/market/meridian/timeline` | UW calendar, earnings, FDA + local OpEx math | 120s serverCache |
| Event brief | `/api/market/meridian/event` | Per-kind loaders below | 120s serverCache |
| Macro prints | `meridian-macro-history.ts` | UW `/api/economy/{id}` + Polygon SPX daily + minute | cron warm |
| Intraday 60m | `meridian-intraday-reaction.ts` | Polygon SPX minute bars | in-process |
| Earnings history | `meridian-earnings-history.ts` | UW `/api/earnings/{t}` + Polygon stock daily | serverCache |
| Analyst cluster | `meridian-catalyst-enrich.ts` | Benzinga analyst channels | Polygon cache |
| Insider/congress | `meridian-catalyst-enrich.ts` | UW insider + congress + Benzinga insider | UW Redis cache |
| OpEx max pain | `meridian-gex-reads.ts` | Polygon GEX heatmap | shared heatmap cache |
| Net flow by expiry | `meridian-desk-lane.ts` | SPX desk snapshot | desk-warm |
| GEX positioning | `getGexPositioning()` | Polygon + WS override | shared |
| Board tickers | `meridian-board-tickers.ts` | Redis `zerodte:board:snapshot:v1` | member board TTL |

## Roadmap item status

1. **Intraday reaction window** — shipped (`spx_intraday_60_pct` on macro history)
2. **Expected vs realized** — shipped on earnings enrichment
3. **Event correlation rail** — shipped on macro brief
4. **Watchlist timeline** — shipped (client filter + board filter)
5. **Congress / insider** — shipped on earnings + FDA briefs
6. **Analyst revision cluster** — shipped on earnings brief
7. **Meridian alerts** — deferred (documented; reuse vector-alerts infra)
8. **Cross-tool deep links** — shipped (Vector, Thermal, HELIX, SPX desk, Night Hawk when on board)
9. **OpEx pin accuracy** — shipped (`pin_accuracy` on OpEx brief)
10. **Macro surprise scoring** — shipped on macro brief when estimate/actual present
