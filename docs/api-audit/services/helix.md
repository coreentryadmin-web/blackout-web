# HELIX Flow Feed — Deep End-to-End Audit
Last updated: 2026-06-29 18:05 ET (22:05 UTC) — automated run
Market status: **CLOSED / post-close** (run fired ~18:00 ET, after the 16:15 ET SPX options close — the "<5 min latest flow" RTH criterion does NOT apply this run; freshness is judged relative to the session close instead)

## Overall Health: **PASS**

HELIX is a real, multi-layer, resilient flow pipeline. Every live print traces to Unusual Whales (REST poll + WebSocket), through Postgres (`flow_alerts`, `ON CONFLICT (alert_id)`), out to clients via recency-ordered REST + SSE fan-out. No mock/fake/sample data in any production path. Premium, strike, expiry, side, route, dedup, ordering, and filters all verified correct against live data and source. Findings are minor (a cache-key omission, a cosmetic `source` label, non-persisted filters) — none corrupt or fabricate flow data.

> NOTE ON SKILL STEP 3: the task's live-check script hits `https://www.blackouttrades.com/api/flows` — that path **does not exist** (returns 404) and `www` strips the `Authorization` header. The real, gated endpoint is `/api/market/flows`, reached via the **apex** host `https://blackouttrades.com` with `Authorization: Bearer $CRON_SECRET`. This audit used the correct endpoint. Recommend updating the SKILL's STEP 3 block.

---

## Field Verification
| Field | Source | Parsed Correctly? | Stored Correctly? | Displayed Correctly? | Issues |
|---|---|---|---|---|---|
| Premium | UW `total_premium ?? premium` (pre-aggregated $ total) | ✅ taken as-is, **not** recomputed (UW already returns size×price×100) | ✅ `total_premium NUMERIC`; `<MIN_PREMIUM` (200K) dropped at ingest | ✅ `fmtPremium()` → $5.0B / $1.2M / $450K | Negative premium possible via `Number()` but UW sends none and the 200K floor excludes; effectively safe |
| Tape order | DB `ORDER BY COALESCE(created_at,inserted_at) DESC NULLS LAST` (`order:"recent"`) | ✅ | ✅ recency index | ✅ client re-sorts newest-first, undated rows last | **Premium-sort bug FIXED** — verified live: 20:12→20:11→20:10→20:09 UTC descending |
| Strike | `row.strike` → fallback `parseOccSymbol()` (`strikeRaw/1000`) | ✅ OCC `"GOOG260116C00200000"` & split fields both handled | ✅ `strike NUMERIC` | ✅ live shows 730, 745, 7200 — real | **"0C -" / 0C-prefix bug FIXED** (parseOccSymbol) |
| Expiry | `expiry/expiry_date/expiration` → OCC `20YY-MM-DD` | ✅ | ✅ `expiry DATE`, served `TO_CHAR(...,'YYYY-MM-DD')` | ✅ MM/DD/YY card format; `dte` computed vs **ET** calendar date | Weekly vs monthly not explicitly labeled (expiry date shown; acceptable) |
| Type (sweep/block) | `has_sweep` boolean; `alert_rule`/`rule_name` (RepeatedHits etc.) | ✅ `has_sweep` parsed; rule surfaced as badge | ✅ in `raw_payload` | ✅ alert-rule badges color-coded | No explicit sweep/block/split **enum** — UW rule string is the label; "split flow" is *derived* client-side (call+put ≤30m, each ≥$500K) |
| Sentiment / direction | side → `bullish`(call)/`bearish`(put)/`unknown` | ✅ | ✅ derived in SQL `CASE option_type LIKE 'c%'…` | ✅ | **Side-default bug FIXED** — missing side = `UNKNOWN`/non-directional, never fabricated as bullish call |
| Route | `whale`(≥$1M) / `0dte` / `stock` | ✅ | ✅ DB CASE: whale ≥1M, 0dte = expiry==ET-today, else stock | ✅ verified live (SPX $16.9M→whale, QQQ 730C Aug→stock) | Single-label: a **0DTE whale labels "whale"** (premium wins). By design. Minor parse-vs-DB definitional difference (parse uses dte≤0, DB uses expiry==today) but DB label is what the tape shows |
| Unusual flag | `score`, `alert_rule` | ✅ `score` parsed (default 0) | ✅ `score NUMERIC` | ✅ | — |
| Dedup | `alert_id = uw:${id}` (deterministic) or widening fallback | ✅ | ✅ `alert_id TEXT UNIQUE` + `ON CONFLICT DO NOTHING` | ✅ client dual-key (`id:` + composite) | **3 layers** (see below) — verified no dupes in live tape |

---

## Live Data Check (via apex + Bearer, `/api/market/flows`)
- **Latest flow age:** last print `2026-06-29T20:12:12Z` = 16:12 ET, i.e. right at the SPX close. Run fired ~22:05 UTC, so age ≈ 1h53m — **expected post-close**, NOT a staleness failure. ✅ (context-appropriate)
- **Flows in default window (since_hours=168):** 100 returned. `since_hours=1` → 0 (no prints in the 17:05–18:05 ET dead window — correct, market closed). ✅
- **Premium range:** $290K – $16.9M across the sample; whale tail to $12.2M/$10.9M. All within the reasonable $10K–$50M band, all ≥ the 200K floor. ✅
- **Null/garbage fields:** none — every row had a valid uppercase ticker, real strike, CALL/PUT side, and real `alerted_at`/`event_at`. No `UNKNOWN` sides in the live sample. ✅
- **Timestamps:** ISO-8601 UTC (`…Z`) in the API; `dte`/expiry labels computed against the **America/New_York** calendar date in both SQL and the client card. ✅
- **Ingest cron health:** `GET /api/cron/flow-ingest` → `{ok:true, ingested:0, polled:100}` — polled 100 from UW, 0 newly inserted (all already persisted, dedup working). ✅

---

## Filter Logic Verification
| Filter | Works Correctly? | Notes |
|---|---|---|
| Min premium | ✅ verified live | `?min_premium=2000000` → all rows ≥ $2M (16.9M, 12.2M, 10.9M, 3.7M, 3.8M). Client floor `FLOOR_PREMIUM=200K` matches server `UW_FLOW_MIN_PREMIUM` default (audit gap #16 holds) |
| Ticker | ✅ verified live | `?ticker=SPX` → 100% SPX rows. Client input uppercased, ≤6 chars |
| Sentiment (CALL/PUT/ALL) | ✅ | Client `typeFilter`; UNKNOWN/typeless prints excluded from ALL counts (gap #6) |
| Expiry | ⚠️ partial | No dedicated expiry filter UI; expiry is shown + drives `dte`/route. Replay/strike-stack use it. Not a defect, just not a user filter |
| Filter persistence across reload | ⚠️ **NOT persisted** | min-premium, type, ticker are component state only — reset on reload. Only the **watchlist** (starred tickers) persists via `useWatchlist()` localStorage. Low-severity UX gap |

---

## SSE Streaming
- **Endpoint responding:** `GET /api/market/flows/stream` (gated by `authorizeMarketDeskApi`, `ensureDataSockets()` boots the UW WS on any replica — audit gap #4). ✅
- **Reconnect logic:** PRESENT — client `createFlowEventSource` reconnects 1s→exponential→30s cap; server emits `connected` + 25s `heartbeat`; backpressure drops slow clients (`desiredSize`, `SSE_MAX_STREAMS` default 500). ✅
- **Cross-instance fan-out:** Redis pub/sub channel `blackout:flow-events`; `__origin`/INSTANCE_ID loopback guard prevents double fan-out; bare legacy messages fanned exactly once. ✅
- **Latency:** WS path calls `persistAndPublishFlowAlert` → `publishFlowEvent` synchronously on receipt, so new prints reach the tape within seconds of UW delivery (could not load-test live post-close).

---

## Deduplication (3 layers — all verified)
1. **DB:** `alert_id TEXT UNIQUE` + `INSERT … ON CONFLICT (alert_id) DO NOTHING RETURNING id`; `rowCount>0` ⇒ genuinely new. Deterministic id `uw:${id}`; timestampless prints use a **widening** fallback key (`ticker:time:strike:type:premium[:trade_count]`) so distinct same-instant prints don't collide.
2. **In-process (ingest + WS):** `makeFlowDedup({ttlMs:60_000, maxKeys:5_000})` — bounded LRU+TTL, keyed on the SAME id as the DB, so a hit can only suppress what the DB would also reject.
3. **Client (`seenRef`):** dual-key (canonical `id:${alert_id}` + composite `ticker|strike|type|alerted_at[0:19]`), trimmed to newest 1000 — prevents REST↔SSE cross-path dupes after a reconnect (audit gap #13).

`shouldFanOut(inserted, usingDb, insertFailed)` ensures a genuine ON-CONFLICT duplicate is NOT re-published (stops WS+REST double-posting the same whale to Discord/SSE), while a *thrown* DB error still fans out (availability over strict dedup).

---

## Data Integrity Issues Found
**None affecting correctness.** Specifically verified:
- ❌ No mock/fake/sample/placeholder/demo flow arrays in production (`src/lib`, `src/app/api`, `src/components`). The only "sample"/"flow" grep hits are dark-pool overlay *sample-time* comments and a Largo input placeholder — benign.
- ❌ No null critical fields in live data (ticker, strike, side, premium, timestamps all populated).
- ✅ Premium is read straight from UW's pre-aggregated `total_premium` — no fragile local `size×price×100` recomputation to drift.

---

## Minor Findings (non-blocking — recommend fixing)
1. **`limit` is omitted from the Postgres cache key** — `src/app/api/market/flows/route.ts:72`
   `cacheKey = flows:pg:${since_hours}:${min_premium}:${ticker}` does **not** include `limit`.
   Observed live: `?limit=10` returned **100** rows (served a cache entry populated by an earlier different-limit caller; first-writer-wins).
   Impact: a small-limit caller can receive **more** rows than asked (never fewer/wrong rows; the page default of 500 is unaffected). Over-fetch + a slightly misleading `count`. **LOW.** Fix: add `:${limit}` to the key (and bucket it if cardinality is a concern).
2. **`source:"cache"` in the live response vs `source:"postgres"` in current code** — `route.ts:112` returns `source:"postgres"`, but prod returns `source:"cache"`. Indicates a **deploy lag** (prod running an older route revision) or a stale shared-Redis payload from a prior shape. **COSMETIC** — the flow rows themselves are correct either way. Worth confirming the latest route is deployed.
3. **Filters not persisted across reload** (min-premium/type/ticker) — see Filter table. **LOW UX.**
4. **No explicit weekly/monthly expiry label and no sweep/block/split enum** — UW's `alert_rule` string + `has_sweep` carry the semantics; "split flow" is derived client-side. Acceptable, but a normalized `flow_type` enum would make filtering/labeling cleaner. **INFO.**

---

## Known Issues (from task backlog / memory)
- HELIX flow pipeline items previously fixed and re-confirmed here: premium-sort→time-sort, `alerted_at`/`event_at` separation, `0C-`/OCC strike parsing, side-default→UNKNOWN (no fabricated bullish), undated-print exclusion from LIVE/sort (gap #6).
- `signal_events`/`signal_outcomes` learning loop is dormant (separate pipeline) — **not** part of the HELIX tape and out of scope here.
- Discord flow webhook + audio whale beep are inert unless their env/toggles are set — by design.

---

## Recommendations
1. **Add `limit` to the flows Postgres cache key** (`route.ts:72`) so the param is honored from cache. (LOW, quick.)
2. **Confirm the latest `/api/market/flows` route is deployed** — reconcile the `source:"cache"` vs `source:"postgres"` discrepancy (likely a stale deploy/cached payload).
3. **Fix the SKILL's STEP 3 live-check** to hit `https://blackouttrades.com/api/market/flows` (apex) with `Bearer $CRON_SECRET`, not `www/api/flows` (404, strips auth).
4. **Persist min-premium/type/ticker filters** to localStorage or the URL for a better tape UX. (LOW.)
5. **Re-run this audit during RTH (3pm ET)** to exercise the live <5-min freshness criterion and SSE latency under an active tape — this run was post-close and could only validate the data-at-rest + endpoints, not real-time push latency.

---
_Verified against live `/api/market/flows`, `/api/cron/flow-ingest` (apex + Bearer) and source at HEAD. No secrets printed. Flows confirmed REAL UW trades, correctly priced and directional._
