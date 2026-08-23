# VECTOR PHASE 2 RUNBOOK — Monday RTH 09:30–16:00 ET (2026-08-24)

**CRITICAL**: Phase 2 **cannot run off-hours**. Every validation here depends on live market data flowing through the rail. An empty rail (no UW positions, no members trading, no wall activity) returns FALSE COMPLETE across every check. This is not a bug; it is an accurate reflection of market state.

---

## Pre-9:30 Checklist (Start 09:15 ET)

- [ ] Confirm `NODE_USE_ENV_PROXY=1` is set (for proxy-browser.cjs tunnel)
- [ ] Confirm `POLYGON_API_KEY` is set (for cross-checks)
- [ ] `npm run healthcheck:0dte` passes at least stages A–D (INFRA may skip, it is fine)
- [ ] Start the web service locally or confirm prod is live
- [ ] Open the member desk at `https://blackouttrades.com/vector` in a browser with auth cookie
- [ ] Confirm SSE `/stream` is connected (live candle ticking)

---

## Window 1: 09:30–10:00 ET — Wall Warmup & Laser Tests

**Goal**: Verify rail starts cleanly at market open.

### 1.1 Oracle wall records — manual check

```bash
# At 09:30 ET exactly, fetch the state
curl -s -H "Authorization: Bearer $CLERK_JWT" \
  "https://blackouttrades.com/api/market/vector/walls?dte=0dte" \
  | jq '.callWalls[] | {strike, pct, notional} | select(.notional > 1000)' | head -5
```

**Expect**: Non-empty walls for SPX 0DTE. If all `null` or empty, market or chain is broken (not Vector's fault).

### 1.2 Bead rail start — Redis direct

```bash
# Slot into the tunnel and read the rail birth
NODE_USE_ENV_PROXY=1 redis-cli -u "$REDIS_URL" \
  --tls --cacert /root/.ccr/ca-bundle.crt \
  lrange "vector:wall-history:SPX:$(date +%Y%m%d)" 0 3 \
  | jq -r '. | @base64d | fromjson' \
  | jq '.[] | {time, walls: (.wallsRaw | length)}'
```

**Expect**: First bead at 09:30 ET; 5-second bucket sequence (if recorded at 09:30:05, next at 09:30:10).

### 1.3 Freshness gate — walls staleness check

```bash
# Run the cron health check
npm run healthcheck:0dte -- --stage=B,D
```

**Expect**: FLOW/BREAKOUT present (AMBER OK if market boring); DATA-PATH GREEN (walls served freshly).

---

## Window 2: 10:00–12:00 ET — Polygon Cross-Checks (Walls, IV, Moves)

### 2.1 Walls: Call/put agreement (3 oracles)

**For each ticker (SPX, SPY, QQQ)**:

```bash
# Fetch from Vector chart
TICKER=SPX
curl -s -H "Authorization: Bearer $CLERK_JWT" \
  "https://blackouttrades.com/api/market/vector/walls?ticker=$TICKER&dte=0dte" \
  | jq '{ticker: "'$TICKER'", call_top: .callWalls[0], put_top: .putWalls[-1]}'

# Fetch from Polygon for ground truth (requires POLYGON_API_KEY)
curl -s "https://api.polygon.io/v3/snapshot/options/$TICKER?order=desc&limit=1&apiKey=$POLYGON_API_KEY" \
  | jq '.results[0] | {ticker: .underlying_ticker, call_iv: .option.details.contract_type, volume}'
```

**Validation**: 
- Vector's top call strike within 2% of IV-weighted ATM strike
- Put symmetry: if no put wall, missing data not calc bug

### 2.2 Expected move: Formula + IV sourcing

**For SPX, SPY, QQQ**:

```bash
TICKER=SPX
# Vector's expected move
curl -s -H "Authorization: Bearer $CLERK_JWT" \
  "https://blackouttrades.com/api/market/vector/expected-move?ticker=$TICKER&dte=0dte" \
  | jq '{ticker: "'$TICKER'", move_pct: .movePct, atm_iv: .atmIv}'

# Ground truth: manual calc
# σ = atmIv, move₁ = spot · σ · √(dte_days/365)
# movePct = move₁ / spot
# For 0DTE: √(1/365) ≈ 0.0523
```

**Validation**: movePct matches σ · 0.0523 (within 0.5 percentage points for rounding).

### 2.3 Max pain & gamma magnet

```bash
# Max pain (should match dealer-intent strikes)
curl -s -H "Authorization: Bearer $CLERK_JWT" \
  "https://blackouttrades.com/api/market/vector/max-pain?ticker=SPX" \
  | jq '{max_pain: .strike, strength: .strengthPct}'

# Gamma magnet (should match flip or nearest wall)
curl -s -H "Authorization: Bearer $CLERK_JWT" \
  "https://blackouttrades.com/api/market/vector/walls?ticker=SPX&dte=0dte" \
  | jq '{walls: .callWalls | length}'
```

**Validation**: Max pain strike is typically where IV is lowest (dealer pulls to max decay). Magnet distance matches wall proximity.

### 2.4 Fib retracement ratios (P4 precision check)

```bash
# Read the analytics payload
curl -s -H "Authorization: Bearer $CLERK_JWT" \
  "https://blackouttrades.com/api/market/vector/analytics?ticker=SPX&regimeDays=1" \
  | jq '.fib_swing.retracements[] | {ratio, price}'
```

**Validation**: Ratios should be 0.382, 0.618, 0.786, etc. At 2dp they truncate to 0.38, 0.62, 0.79 (**this is the P4 defect**). Note but do not block on.

---

## Window 3: 12:00–14:00 ET — UI Pixel Validation

### 3.1 Desktop member desk (`/vector`)

```bash
# Capture all four segment tabs
COOKIE="$(__session_jwt_here__)"
VIEWPORT="1440x900"

for SEGMENT in "Chart" "Helix" "Matrix" "Scanner"; do
  node --import tsx proxy-browser.cjs \
    "https://blackouttrades.com/vector" \
    "/tmp/vector-$SEGMENT.png" \
    --cookie "Cookie: __session=$COOKIE" \
    --viewport "$VIEWPORT" \
    --wait 3000
  echo "✓ $SEGMENT captured"
done
```

**Validations**:
- **Chart tab**: Bead column width, wall colors, flip line, legend
- **Helix tab**: Pulse signals firing, no console errors
- **Matrix tab**: Ladder rendering, strike grid, spot row highlight
- **Scanner tab**: Universe grid, row heights, horizontal scroll OFF

**Regression baseline** (from prior runs):
- No CLS (Cumulative Layout Shift) regression
- No text overflow into other columns
- Tab switching instantaneous (no blank paint)

### 3.2 Mobile view (`/vector`)

```bash
VIEWPORT="430x932"
node --import tsx proxy-browser.cjs \
  "https://blackouttrades.com/vector" \
  "/tmp/vector-mobile.png" \
  --cookie "Cookie: __session=$COOKIE" \
  --viewport "$VIEWPORT" \
  --wait 3000
```

**Validations**:
- Chart/Helix/Matrix/Scanner tabs all clickable
- No horizontal scroll (body width overflow)
- Tap targets ≥24px (modal, buttons)

### 3.3 SPX Slayer embed (`/dashboard`)

```bash
node --import tsx proxy-browser.cjs \
  "https://blackouttrades.com/dashboard?tab=vector" \
  "/tmp/spx-vector-embed.png" \
  --cookie "Cookie: __session=$COOKIE" \
  --viewport "1440x900" \
  --wait 5000
```

**Validation**: `SpxVectorEmbed` chart renders, no regressions from #2453 CLS fix. Note: chart-only, no ladder/scanner.

### 3.4 Depth ladder tab

```bash
npm run test:depth-ladder-ui-audit -- \
  --base "https://blackouttrades.com" \
  --viewport "1440x900"
```

**Validation**: Rungs painted, spot row visible, honest-limits note present, no console errors.

---

## Window 4: 14:00–15:30 ET — Transport Cap Confirmation (CRITICAL)

**This is the REAL defect test. Off-hours it will lie.**

### 4.1 Truncation probe — all three tools

```bash
# LIVE agent asks each tool in a loop
node --import tsx scripts/audit/largo-truncation-probe.mjs \
  --tools "get_vector_full_state,get_vector_pulse,get_vector_analytics" \
  --base "https://blackouttrades.com" \
  --json
```

**Validation targets**:
- **`get_vector_full_state`**: COMPLETE (payload not truncated). This is the #2649 fix verification.
- **`get_vector_pulse`**: COMPLETE (compact payload, never at risk).
- **`get_vector_analytics`**: COMPLETE (estimated 87% transport cap at default `regimeDays`; under budget).

**Expected outcome**: All three COMPLETE with CONTROL PROVEN (control tool demonstrably exceeded cap, confirming instrument is sensitive).

**If truncated**:
- **`get_vector_full_state` TRUNCATED** → #2649 fix not working; roll back or dig into `fitVectorFullStateForModel`
- **`get_vector_analytics` TRUNCATED** → Queue the P4 fix: fit with `fit-tool-result.ts`

### 4.2 Live payload size check

```bash
# Measure actual wire size
curl -s -H "Authorization: Bearer $CLERK_JWT" \
  "https://blackouttrades.com/api/market/vector/full-state?ticker=SPX" \
  | wc -c
```

**Expect**: <14,000 bytes (the repo's safety budget). If over 14,000, the fix is working but the safety margin is gone.

---

## Window 5: 15:30–16:00 ET — Rail Accumulation & Close

### 5.1 Final rail state

```bash
# How many beads did we record today?
NODE_USE_ENV_PROXY=1 redis-cli -u "$REDIS_URL" \
  --tls --cacert /root/.ccr/ca-bundle.crt \
  llen "vector:wall-history:SPX:$(date +%Y%m%d)"
```

**Expect**: (16:00 − 09:30) / 5s = 390 buckets = 390 beads. Within ±5 is OK (network jitter).

### 5.2 Leader lock trace

```bash
# Did the leader stay alive the whole session?
NODE_USE_ENV_PROXY=1 redis-cli -u "$REDIS_URL" \
  --tls --cacert /root/.ccr/ca-bundle.crt \
  get "vector:wall-leader:SPX:$(date +%Y%m%d)"
```

**Expect**: Should expire/renew, not stale for >45s ever. If found abandoned, the backup cron (deliberately not deployed) would have taken over — but it isn't, so **this is a gap to document** (P3).

### 5.3 Universe snapshot freshness

```bash
# Did the ~5 min universe cache stay fresh?
NODE_USE_ENV_PROXY=1 redis-cli -u "$REDIS_URL" \
  --tls --cacert /root/.ccr/ca-bundle.crt \
  hget "vector:universe:snapshot" "asOf"
```

**Expect**: Within last 5 minutes. If stale, the cron missed a fire or the data path is broken.

---

## Post-16:00 ET — Data Collection & Cleanup

### 6.1 Collect all logs and screenshots

```bash
# Bundle results
tar czf /tmp/vector-phase2-${DATE}.tar.gz \
  /tmp/vector-*.png \
  /tmp/vector-phase2-*.log
```

### 6.2 Database snapshot (for FINDINGS.md)

```bash
# Export any DB findings (e.g., alert rule counts, bead write failures)
# Kept in /tmp or notes for Phase 3 report
```

---

## Phase 2 Verdict Matrix

| Check | Status | Evidence | Action |
|-------|--------|----------|--------|
| Wall warmup | GREEN / AMBER / RED | 09:30 rail start timestamp | If RED: market closed or GEX broken (not Vector) |
| Polygon cross-checks | GREEN / YELLOW | Calc agreement within tolerance | If YELLOW: provider version mismatch (note, don't block) |
| UI desktop | GREEN / RED | Screenshots, console errors | If RED: fix in Phase 3 |
| UI mobile | GREEN / RED | Screenshot, tap target scan | If RED: fix in Phase 3 |
| SPX embed | GREEN / RED | Screenshot, CLS check | If RED: blocking for production (revert #2453 or root cause) |
| Truncation probe | COMPLETE / TRUNCATED / UNVERIFIED | Agent loop observation | If TRUNCATED: #2649 failed (critical bug) |
| Rail accumulation | GREEN / YELLOW | Bead count, leader lock | If YELLOW: document gap (backup cron missing) |

---

## What "Phase 2 COMPLETE" Looks Like

1. ✓ Walls match Polygon within 2%
2. ✓ Expected move formula validated
3. ✓ `largo-truncation-probe.mjs` COMPLETE on all three tools (live confirmation of #2649)
4. ✓ UI pixel validation green on 1440 + 430 + embed
5. ✓ Rail accumulation: ~390 beads, freshness OK
6. ✓ All logs collected for FINDINGS.md

**If all above green**: Phase 3 is documentation + addressing P3/P4 items.  
**If any red**: One or more P0/P1 bugs found; open fix PRs before closing certification.
