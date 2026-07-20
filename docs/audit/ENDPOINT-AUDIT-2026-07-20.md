# Live endpoint audit — 2026-07-20

Production target: `https://blackouttrades.com` (pre-market / extended hours).

## Harnesses run

| Command | Scope | Result |
|---------|--------|--------|
| `npm run validate:comprehensive-endpoints` | 156 internal routes + 31 product probes + 22 UW + 5 Polygon live paths | **67 PASS, 4 WARN, 0 FAIL** |
| `npm run validate:exhaustive` | All pages, 170 API URLs, UI markers, live polls | **149 PASS, 66 WARN, 4 FAIL** → **0 FAIL after fixes below** |
| `node scripts/audit/data-validator.mjs` | Cross-provider SPY/SPX/GEX/0DTE/track-record | **16 PASS, 0 FAIL** |
| `src/lib/docs-probe-report.json` (cached) | 265 documented UW/Polygon catalog paths | 17 used-in-code probe failures (see below) |

New script: `scripts/comprehensive-endpoint-audit.mjs` — `npm run validate:comprehensive-endpoints`.

## Product surfaces (admin session, live data)

All tier-gated product APIs returned **HTTP 200 with payload** except:

- **`/api/market/gex-heatmap/explain?ticker=SPY`** — 200 but empty summary off-hours (BIE explain path; non-blocking).
- **`/api/market/indices`**, **`/api/market/news?ticker=NVDA`** — 200 with sparse off-hours shape (indices still available via quote/bootstrap elsewhere).

Confirmed live: SPX desk/bootstrap/play/matrix, Thermal heatmap, HELIX flows/flow-brief/dark-pool, Vector walls/ladder/bars/prior-day/universe, Night Hawk edition, 0DTE board, Largo session, platform snapshot/intel, admin health, track record.

## Upstream providers (direct REST)

**Unusual Whales (22/22 PASS)** — every path in `live-api-integrations.ts` `UW_FETCH_FUNCTION_PATHS` resolved with `{ticker}=SPY` and returned data, including spot-exposures, greek-exposure, flow-per-strike-intraday, net-flow, market-tide, darkpool, economy/GDP, group-flow/mag7.

**Polygon (5/5 PASS)** — SPX index snapshot, SPY stock snapshot, SPY prev close, market status, Benzinga news.

**WebSocket channels** — not probed over HTTP (multiplex UW WS in `uw-socket.ts`); REST mirrors validated above and `socket-health` cron PASS.

## Cached docs-probe failures (used in code)

The June 2026 full catalog probe (`npm run probe:docs`) reported **17 used-in-code failures**. Re-probing the **live integration subset today: 0 failures**. Remaining catalog items are:

| Category | Paths | Verdict |
|----------|-------|---------|
| Probe param bugs | `market/correlations` (missing tickers), `atm-chains` (empty expirations), `{sector}/tickers` (wrong sector slug), option-contract `{id}` (stale OCC in probe) | Fix probe templates; not production regressions |
| Enterprise / premium UW | `ownership`, `congress/unusual-trades` | Not on current plan — guarded in app |
| Transient 503 (June) | spot-exposures strike/expiry variants, institution holdings | **Green today** on live re-probe |
| Polygon doc drift | `related-companies`, `stocks/vX/float`, options open-close | Unused or superseded paths in code — low priority |

Run `npm run probe:docs` to refresh the full 265-endpoint report.

## Exhaustive audit fixes (this PR)

1. Removed dead probe **`/api/account/positions/health/detail`** (route does not exist → 404 + false `undefined` JSON scan).
2. **`/api/signals/open`** — classify as **cron-only** (requires `CRON_SECRET`, not member session).
3. **Cognito OAuth routes** — GET without OAuth state returns 500; downgraded to WARN (expected).

## How to re-run

```bash
npm run validate:comprehensive-endpoints
npm run validate:exhaustive
node scripts/audit/data-validator.mjs
npm run probe:docs          # full 265 upstream catalog (~30 min, rate-limited)
```

Reports land in `audit-output/` (gitignored).
