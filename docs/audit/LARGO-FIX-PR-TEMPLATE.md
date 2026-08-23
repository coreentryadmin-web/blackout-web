# Largo Truncation Fix PR Template

Use this template for each of the 10 truncation fixes. Copy the relevant section and follow the structure exactly.

---

## P2-01: `get_market_context` Cross-Product Aggregation

**Title:** `fix(largo): get_market_context pagination for complete cross-product state`

**Root Cause:**
- Tool aggregates state from Helix, Thermal, Vector, Meridian, Night Hawk, SPX
- Returns late fields truncated: some products' state fully present, others partial
- 16k char boundary cuts cross-product aggregation incomplete

**Evidence:**
- Phase 3 probe: `get_market_context ""` returns TRUNCATED
- Measurement: ~14–18 fields before truncation, 8–10 visible
- Impact: Trades missing product context (e.g., "is Thermal warning?" invisible)

**Fix Strategy:** Option A — Paginate by product
- Return core state (market regime, breadth, VIX) in first payload (~8k)
- Paginate: `get_market_context products=Night_Hawk,Banger` → product-specific state
- Model can ask: "What's Thermal's view?" → second call, complete view

**Changes:**
- [ ] Modify endpoint to accept optional `products` param (default: core only)
- [ ] Add test: full vs paginated mode returns consistent data
- [ ] Verify Phase 4 answer quality: model still synthesizes complete picture
- [ ] Run probe: `--tools=get_market_context` → expect COMPLETE

**Test Case:**
```typescript
// Verify full state available via pagination
const core = await getMarketContext(""); // ~8k
const thermal = await getMarketContext("products=Thermal"); // ~6k
assert(core.market_regime === thermal.base_context.market_regime);
assert(thermal.thermal_state); // Not truncated
```

---

## P2-02: `get_nighthawk_dossier` Full Board Truncation

**Title:** `fix(largo): get_nighthawk_dossier pagination — top 50 plays + fetch-more`

**Root Cause:**
- Returns full board state: all plays, all positions, all exits
- 100+ plays across all buckets (OPEN, HOLD, TRIM, CLOSED)
- Truncates at ~50 plays; plays 51–100 invisible

**Evidence:**
- Phase 3 probe: TRUNCATED
- Measurement: play count before/after truncation
- Impact: Model sees top 50 by entry time, misses closed trades with valuable outcomes

**Fix Strategy:** Option B — Pagination (top N + on-demand)
- Default: `get_nighthawk_dossier` → top 50 plays (OPEN + best CLOSED)
- Fetch more: `get_nighthawk_dossier plays=51-100` → next cohort
- Minimize impact: model rarely needs full 100 for decision-making

**Changes:**
- [ ] Default: limit to 50 plays (sort by recency + exit status)
- [ ] Add param: `plays=<range>` for pagination
- [ ] Test: 3 calls → 150 plays accessible, no dups
- [ ] Verify Phase 4: model synthesis unchanged with top 50

**Test Case:**
```typescript
const top50 = await getNighthawkDossier(""); // ~15k → visible
assert(top50.plays.length === 50);
const next50 = await getNighthawkDossier("plays=51-100");
assert(next50.plays.length === 50);
assert(new Set([...top50.plays.map(p => p.id), ...next50.plays.map(p => p.id)]).size === 100);
```

---

## P2-03: `get_banger_board` Top 40 Candidates

**Title:** `fix(largo): get_banger_board limit to top 40 + highest-$volume ranking`

**Root Cause:**
- Returns 100+ candidates ranked by $-volume
- Truncates at ~40; candidates 41–100 invisible

**Evidence:**
- Phase 3 probe: TRUNCATED
- Measurement: Exact cutoff at candidate N
- Impact: Model lists top movers but misses lower-volume setups

**Fix Strategy:** Option A — Limit to top N
- Limit output: top 40 by $-volume
- Fits within cap with room to spare
- Least disruptive: traders typically care about top 40 anyway

**Changes:**
- [ ] Filter: return only top 40 candidates
- [ ] Maintain sorting: $-volume descending
- [ ] Test: exact 40, no partial entries
- [ ] Verify Phase 4: model reasoning unchanged

**Test Case:**
```typescript
const board = await getBangerBoard("");
assert(board.candidates.length === 40);
assert(board.candidates[0].dollar_volume >= board.candidates[39].dollar_volume);
// No candidate 41
assert(!board.candidates[40]);
```

---

## P3-01: `get_analyst_ratings` Market-Wide Consensus

**Title:** `fix(largo): get_analyst_ratings pagination — A-M, then N-Z on demand`

**Root Cause:**
- Returns market-wide analyst ratings (all 3000+ stocks)
- Truncates alphabetically at ~M; tickers N–Z invisible
- Model quotes only visible half of market

**Evidence:**
- Phase 3 probe: TRUNCATED at ticker M/N boundary
- Measurement: Field count A–M vs N–Z
- Impact: Analyst consensus biased toward first half of alphabet

**Fix Strategy:** Option B — Pagination by letter range
- Default: A–M ratings
- Paginate: `get_analyst_ratings range=N-Z` → second half
- Symmetric results, clear boundary

**Changes:**
- [ ] Default: A–M only
- [ ] Add param: `range=A-M|N-Z|all`
- [ ] Test: sum of A-M + N-Z equals full market
- [ ] Verify Phase 4: cross-product agreement unchanged

---

## P3-02: `get_confluence_outcomes` Historical Grading (Paginate or Filter)

**Title:** `fix(largo): get_confluence_outcomes paginate — recent-first, older on demand`

**Root Cause:**
- Returns 100+ historical outcomes
- Truncates; older outcomes invisible
- Model's historical calibration biased toward recent edge

**Evidence:**
- Phase 3 probe: TRUNCATED
- Impact: Outcome sample biased (recent-only vs true distribution)

**Fix Strategy:** Option B — Paginate recent-first
- Default: last 50 outcomes (most recent first)
- Paginate: `get_confluence_outcomes age=older` → next cohort
- Ensures model sees recent outcomes, can fetch historical context if needed

---

## P3-03: `get_group_greek_flow` Groups 21+

**Title:** `fix(largo): get_group_greek_flow limit to top 20 by exposure + pagination`

**Root Cause:**
- Returns 20–30+ sector/industry groups
- Truncates at group 20; groups 21+ invisible

**Evidence:**
- Phase 3 probe: TRUNCATED
- Measurement: Group count before/after

**Fix Strategy:** Option A — Limit to top 20
- Default: top 20 groups by gamma exposure (most relevant for traders)
- Fit within cap with margin
- Least disruptive: traders focus on major groups anyway

---

## P3-04 through P3-07: OI, Stats, Platform, Screener

**Pattern:** All follow same logic as above.

- **`get_market_oi_change`**: Limit to top 50 tickers by $-OI change
- **`get_market_stats`**: Strip moving averages for peripheral indices (keep current bar)
- **`get_platform_snapshot`**: Filter to active members only OR paginate active-first
- **`get_screener`**: Limit to top 40 candidates by score (same as banger_board fix)

For each, follow the template above with the corresponding fix strategy from `LARGO-PHASE-4-5-PLAN.md` Table §3.

---

## Common Testing Pattern (All Fixes)

```typescript
// 1. Verify tool no longer truncates
const { truncated } = await probeLatgo(tool, args);
assert(!truncated, `${tool} still truncates`);

// 2. Run Phase 4 spot-check: model reasoning unchanged
const answer = await askModel(`[question that uses ${tool}]`);
assert(answer.includes("expected_concept"), "Answer missing key concept");

// 3. Check cross-product consistency
// (if tool feeds into consensus scoring)
const full = await askModel("question_A");
// Latency should be same or slightly better (fewer tokens)
// Content should be same or equivalent
```

---

## Merge Criteria (All Fixes)

- ✓ Truncation probe: tool returns COMPLETE
- ✓ Phase 4 answer quality: completeness ≥80% for this tool's questions
- ✓ Phase 4 cross-product: no new disagreements introduced
- ✓ No regression: other tools' completeness unchanged
- ✓ Performance: latency same or better
- ✓ One issue per PR (do not combine multiple fixes)

---

## Commit Message Template

```
fix(largo): <tool> truncation — <strategy>

Root cause: <one-line explanation of data loss>
Evidence: Phase 3 probe TRUNCATED at <specific point>
Impact: <what agent can't do without this fix>

Fix: <Strategy A/B/C from plan>
  - <specific API change>
  - <pagination or limit logic>
  - <no backward compatibility breaks>

Testing:
  - Probe: get_zerodte_rejections (control) proven TRUNCATED
  - Tool: <tool> now returns COMPLETE
  - Phase 4: <representative question> scores 80%+ completeness
  - Cross-product: no new disagreements

Fixes LARGO truncation #<N> per docs/audit/LARGO-PHASE-4-5-PLAN.md

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0186bQtdaStfL887SvVLFFwx
```
