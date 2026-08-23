# RTH Validation Window — 2026-08-24 09:30–16:00 ET

## Measurement Priorities

### P0 (Correctness — blocks member experience)

**1. Force-rebuild timing anomaly**
- Spike: SPY 56.7s (2026-08-13) exceeds 55s cap
- Measurement: Re-run `gex-force-rebuild-timing.mjs` during RTH
- Command: `node --import tsx scripts/audit/gex-force-rebuild-timing.mjs --tickers=SPY,SPX,QQQ,IWM --n=50 --cap=55000 --json`
- Decision gate: If consistent p95 > 55s, raise cap. If one-off, investigate background load.
- Result: Feeds back into cap decision for fail-closed timeout

**2. Public/member route divergence (walls)**
- Symptom: Member route uses UW WS override for SPX 0DTE; public route does not
- Off-RTH: Matched exactly (overlay unavailable, both raw)
- Measurement: Simultaneous snapshots of `/heatmap?ticker=SPX` vs `/tools/gamma-snapshot` at 5-minute intervals 10:00–15:00 ET
- Command: `node --import tsx scripts/audit/thermal-wall-divergence-probe.mjs --start='10:00' --end='15:00' --interval=300 --json`
- Decision gate: If divergence >0.5% (walls differ by >strike/$), decide: apply overlay to public or document divergence
- Result: Informs public product positioning

### P1 (Validation — confirms Phase 0 fixes)

**3. Horizon walls fix verification (0DTE/3DTE/7DTE)**
- Fix: Phase 0 PR #2753 added proper DTE bucketing
- Validation: Live data check SPX, SPY, QQQ that walls are bucketed correctly
- Manual: Open `/heatmap?ticker=SPX&tab=levels` during RTH, inspect Key Levels row
  - Should show three separate wall rows (0DTE call, 3DTE call, 7DTE call; 0DTE put, 3DTE put, 7DTE put)
  - All walls should be side-constrained (call walls at/above spot, put walls at/below spot)
- Result: Mark "LIVE VERIFIED" in certification matrix if correct, "REGRESSION" if wrong

**4. Shift event logging**
- Check: Flip_crossed and wall_broken events appear in Shifts tab when markets move
- Validation: Watch SPX 0DTE shifts tab 10:00–11:00 ET (highest volatility RTH window), look for event log entries
- Manual: Count events, inspect flip_reason and reason fields
- Result: Confirm shift event mechanism works in production

### P2 (Performance & divergence)

**5. Client poll latency**
- Measurement: Use browser DevTools Network tab on `/heatmap`, measure fetch latency
- Manual: Time 10 consecutive 5s-interval polls at 10:30 ET, report p50/p95 latency
- Result: Confirm <500ms fetch (should be cache-read only per architecture)

**6. Compare grid (7-ticker) rendering**
- Validation: Open `/heatmap?compare=SPX,SPY,QQQ,IWM,TSLA,AAPL,NVDA` during RTH
- Manual: Confirm all 7 tickers render without horizontal overflow, all columns visible
- Result: Confirm responsive grid layout works on desktop 1440px

## Expected Outcomes

| Measurement | Success Criteria | Blocker? |
|---|---|---|
| Force-rebuild p95 < 55s | New peak measured, cap justified | Yes if p95 > 55s |
| Public/member wall divergence | <0.5% or decision made | No (documented gap) |
| Horizon walls correct | 0DTE/3DTE/7DTE visible + constrained | Yes if missing |
| Shift events logged | Events appear with reasons | No (internal tracking) |
| Client poll <500ms | p95 <500ms | No (SLA is 15s) |
| Compare grid renders | All 7 visible, no overflow | No (mobile-first responsive) |

## Session Checklist

- [ ] 09:30 ET: Open browser, auth into /heatmap
- [ ] 10:00 ET: Start force-rebuild measurement (command above)
- [ ] 10:00–10:30 ET: Proxy-browser screenshot sprint (all tabs, tickers, viewports)
- [ ] 10:30–11:00 ET: Watch SPX shifts tab for events
- [ ] 11:00–15:00 ET: Periodic divergence snapshots (5-min intervals)
- [ ] 15:00 ET: Complete measurements, summarize results
- [ ] After close: Update certification matrix with live results

## What to Watch For

**Green flags:**
- Walls behave correctly (side-constrained, DTE-bucketed)
- Shifts show events with reasons
- No divergence between member/public routes
- Force-rebuild consistently <55s

**Red flags:**
- Wall constraints violated (call wall below spot, put wall above spot)
- Missing shift events during high-vol windows
- Public walls differ from member walls >0.5%
- Force-rebuild timeout or >55s consistent p95
- Compare grid overflow on 1440px

## Follow-up PRs (Blocked Until RTH Measurement)

If force-rebuild p95 is justified:
- PR: Raise `GEX_HEATMAP_FORCE_MAX_BLOCK_MS` from 55000 to 60000 (or measured p99)
- Impact: Gives more headroom for weekend/holiday latency spikes

If wall divergence is confirmed:
- Decision 1: Apply UW override to public route (requires UW auth on public builder)
- Decision 2: Document divergence in public page footer ("Member route uses insider dealer data during RTH")

If shift events are missing:
- Debug: Check if flip_crossed/wall_broken gates are firing

If client poll latency is high:
- Check: Redis cache hit rate vs miss rate during RTH
- Debug: Investigate cache-invalidation logic
