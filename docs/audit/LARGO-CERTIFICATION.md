# LARGO FULL PRODUCT CERTIFICATION
## 2026-08-23 COMPREHENSIVE VALIDATION REPORT

**Certification Order Received:** 2026-08-23T17:09:11Z  
**Scope:** Complete member-facing surface validation  
**Certification Status:** IN PROGRESS

---

## PART I: MEMBER-FACING SURFACE INVENTORY

### I.1: SLASH COMMANDS & DESK NAVIGATION

#### Navigate Commands (7 total)
All route users to other products or track record with optional ticker parameter parsing:

| Command | Aliases | Label | Href Target |
|---------|---------|-------|------------|
| `/spx-slayer` | spx, slayer, dashboard | Open SPX Slayer | /dashboard |
| `/helix` | flow, flows, tape | Open HELIX | /flows |
| `/thermal` | heatmap, gex, gamma | Open BlackOut Thermal | /heatmap |
| `/largo` | terminal, desk, ai | Stay on Largo | /terminal |
| `/nighthawk` | nh, 0dte, zerodte, board | Open Night Hawk | /nighthawk |
| `/vector` | chart, swing | Open Vector | /vector |
| `/meridian` | catalyst, earnings, macro | Open Meridian | /meridian |
| `/track-record` | record, stats, wins | Track Record | /track-record |

**Implementation:** `src/lib/largo/slash-commands.ts`
**Href Resolution:** `resolveSlashNavigateHref()` extracts optional ticker from args and appends `?ticker=` when applicable for `tickerAware` routes.

#### Terminal-Native Commands (4 total)
Stay in-terminal, set session scope via `deskScope` + `deskScopeArgs`:

| Command | Description | Question | Desk Scope |
|---------|-------------|----------|------------|
| `/watch` | Add tickers to watchlist | "Summarize what matters on my watchlist right now." | `largo` + watchTickers |
| `/diff` | Session changes | "What changed since my last turn — spot, flip, walls, flow?" | `largo` + mode: diff |
| `/board` | 0DTE board | "What's the 0DTE board P&L — open plays, marks, any stopped?" | `nighthawk` + mode: board |
| `/trinity` | SPX·SPY·QQQ | "Compare SPX, SPY, and QQQ — structure, flow skew, positioning." | `largo` + mode: trinity |

**Implementation:** `src/lib/largo/slash-commands.ts:TERMINAL_COMMANDS`  
**Scope Routing:** `deskScopeForCommand()` maps each terminal command to its scope/args; questions processed through `resolveLargoSlashSubmit()`.

#### Prompt Commands (~20+ dynamic)
Built from `LARGO_DESK_PROMPTS` (non-social-pack items become slash shortcuts).

**Implementation:** `src/lib/largo/slash-commands.ts:buildPromptCommands()`  
**Rank:** Prompt commands sort above nav commands (rank 100+).

#### Slash Menu Filtering
**Query Detection:** `largoSlashQueryFromInput()` → only first token (before space) triggers autocomplete  
**Scoring:** Prefix match (900pts) > label start (800) > alias start (700) > substring (500); tie-break by `rank` then label alpha  
**Limit:** 12 results by default (capped in `filterLargoSlashCommands()`)

---

### I.2: TOOLS (129 TOTAL)

#### Tool Inventory by Engine/Product

**SPX_ENGINE_TOOL_NAMES (11 tools)** — SPX Slayer's own engine state
1. `get_spx_structure` - Full SPX Sniper desk (price, GEX, flow, dark pool, news, macro, tide)
2. `get_spx_play` - SPX Slayer live play engine snapshot (phase, action, direction, grade, score, confluence)
3. `get_open_plays` - Open desk trades
4. `get_signal_log` - SPX signal log (committed signals only)
5. `get_spx_engine_snapshots` - Rejected/scanning history (gate blocks, veto reasons)
6. `get_lotto_state` - Today's lotto state
7. `get_setup_stats` - Win rates by setup from Postgres
8. `get_trade_history` - Closed trades (ticker, days optional)
9. `get_spx_confluence` - SPX confluence factors
10. `get_lotto_live` - Live lotto evaluation
11. `get_power_hour` - Power hour state/plays

**HELIX_ENGINE_TOOL_NAMES (8 tools)** — Tape analysis & flow composition
1. `get_flow_tape` - Postgres HELIX tape (count, total_premium, top_tickers, recent, pull_skew, session_skew_baseline)
2. `get_helix_derived` - HELIX derived panels (Stacked Hits, Top Prints, Velocity Radar, Split Flow)
3. `get_flow_brief` - HELIX FlowBrief memo (deterministic session summary)
4. `get_helix_tape_analytics` - HELIX secondary panels (leaderboard, route breakdown, expiry concentration, call/put skew)
5. `get_postgres_flows` - Raw flow-alert prints (flat list, no aggregates)
6. `get_options_flow` - Per-ticker live flow (UW + Postgres merge for non-SPX; SPX Sniper desk slice for SPX)
7. `get_global_flow` - Market-wide live UW flow (pure live, no Postgres)
8. `get_helix_signal_outcomes` - Velocity/split-flow signal follow-through grading (direction, continuation rate, per-type split)

**THERMAL_ENGINE_TOOL_NAMES (6 tools)** — Thermal's own computed state
1. `get_positioning` - GEX positioning snapshot
2. `get_gex_heatmap` - Full GEX heatmap matrix
3. `get_gex_matrix_changes` - Matrix changes (transitions)
4. `get_thermal_compare` - Thermal comparison
5. `get_wall_dynamics` - Gamma wall dynamics (shared with VECTOR)
6. `get_gex_regime_events` - GEX regime transition history (Postgres log of flip/wall events)

**VECTOR_ENGINE_TOOL_NAMES (4 tools)** — Vector's own state
1. `get_vector_full_state` - Full Vector state
2. `get_vector_pulse` - Fast Vector pulse
3. `get_vector_analytics` - Vector analytics
4. `get_wall_dynamics` - Gamma wall dynamics (shared with THERMAL)

**NIGHTHAWK_ENGINE_TOOL_NAMES (8 tools)** — 0DTE Command & Night Hawk state
1. `get_zerodte_plays` - 0DTE Command scanner board + iron condor (plays, fresh_finds, excluded, rules)
2. `get_zerodte_rejections` - Gate-rejection log (gate_failed, threshold, computed metrics)
3. `get_zerodte_record` - 0DTE Command track record (win/loss stats, days window)
4. `get_nighthawk_edition` - Published Night Hawk edition (recap, plays with full thesis/entry/target/stop)
5. `get_nighthawk_outcomes` - Night Hawk closed/pending outcome ledger
6. `get_nighthawk_dossier` - Per-ticker research/scoring state (live staging, durable archive)
7. `get_banger_board` - Night Hawk Bangers lane (Engine B, weekly discovery + scale-out)
8. `get_swing_horizon` - Night Hawk Swings lane (multi-day, 7 action sections)

**MARKET_ENGINE_TOOL_NAMES (1 tool)** — Market-wide context (BIE router)
1. `get_market_context` - Polygon indices + session status + UW tide

**ZERODTE_ENGINE_TOOL_NAMES (2 tools)** — Narrow 0DTE Command reads
1. `get_zerodte_plays` - (also in NIGHTHAWK_ENGINE_TOOL_NAMES)
2. `get_zerodte_rejections` - (also in NIGHTHAWK_ENGINE_TOOL_NAMES)

**BIE_TOOL_NAMES (9 tools)** — Cross-product intelligence
1. `get_ecosystem_context` - Unified cross-product read (ticker-scoped; SPX desk + flow + Thermal GEX + Vector + regime)
2. `call_internal_api` - Internal API fallback
3. `get_uw` - UW data fetch wrapper
4. `get_polygon` - Polygon data fetch wrapper
5. `get_vector_full_state` - (also in VECTOR_ENGINE_TOOL_NAMES)
6. `get_hot_tickers` - Hot/trending tickers
7. `get_market_regime` - Market-wide backdrop/regime intelligence
8. `get_confluence_outcomes` - Confluence factor follow-through grading
9. `get_similar_precedents` - Historical similar setups

**TOOL_GROUPS Inventory**

| Group | Count | Primary Callers | Purpose |
|-------|-------|-----------------|---------|
| `spx_desk` | 19 | SPX Slayer, SPX-scoped questions | SPX routing bundle |
| `flow_analysis` | 18 | HELIX, flow-scoped questions | Flow/tape analysis |
| `stock_analysis` | 20 | Technical, chart, option chain questions | Per-ticker analysis |
| `vol_analysis` | 7 | Vol regime, IV questions | Volatility & rates |
| `news_events` | 12 | News, earnings, catalyst questions | Event/catalyst calendar |
| `fundamental` | 11 | Company, analyst, insider questions | Fundamental research |
| `platform` | 14+ base + BIE | Cross-product, Night Hawk questions | Multi-product & BIE |
| `screener` | 7 | Sector, mover, breadth questions | Market screening |

**Total in TOOL_GROUPS:** 108+ (accounting for overlaps and BIE_TOOL_NAMES spread)

**Additional Tools Not in TOOL_GROUPS** (verified in tool-defs but outside routing):
- ~20 additional analytical/derived tools (confluence, precedents, etc.)

**Grand Total:** 129 tools per comment at line 1154 of tool-defs.ts

---

### I.3: APIS & HTTP ENDPOINTS

**Largo Session Management**
- `GET /api/market/largo/session` — Fetch current session info
- `POST /api/market/largo/session` — Update session state
- `POST /api/market/largo/reset` — Clear session/conversation

**Query & Chat**
- `POST /api/market/largo/query` — Run question (debounced, returns stream)
- `POST /api/market/largo/regenerate` — Re-run last question
- `GET /api/market/largo/status` — Session status (loading, error, ready)

**Context & State**
- `GET /api/market/largo/context` — Session context (scopes, tickers, etc.)
- `POST /api/market/largo/depth` — Toggle depth mode (shallow/deep reasoning)
- `POST /api/market/largo/historical-mode` — Toggle historical/real-time

**Output & Social**
- `POST /api/market/largo/draft-x-post` — Generate draft X/Twitter post
- `POST /api/market/largo/share-discord` — Share to Discord channel
- `POST /api/market/largo/draft-email` — Draft email (if enabled)

**Dynamism & Suggestions**
- `GET /api/market/largo/slash-prompts` — Fetch dynamic slash prompts (live reads turned into questions)
- `GET /api/market/largo/mini-panel` — Mini-panel data + actions
- `GET /api/market/largo/followup-chips` — Suggested follow-up questions

**Desk Scope & Routing**
- `POST /api/market/largo/desk-scope` — Set active desk (spx, flows, heatmap, terminal, etc.)
- `GET /api/market/largo/desk-scope` — Fetch current desk scope

**Admin/Debug (if applicable)**
- `GET /api/market/largo/record` — Fetch graded outcomes (0DTE, Swings, etc.)
- `POST /api/market/largo/truncation-check` — Verify payload caps (testing only)

---

### I.4: Terminal UI Components

**Composer Area** (Input + Controls)
- Textarea input field
  - Placeholder: "Type / for desk commands — SPX, flow, thermal, vector…"
  - Placeholder (busy): "Pulling live data…"
  - Slash autocomplete dropdown (12 results, scored/ranked)
  - Dynamic prompts menu (from `/api/.../slash-prompts`)

- Control buttons
  - Mic (dictation toggle; `useDictation` hook)
  - ImagePlus (attachment button)
  - Send (submit query or continue streaming)
  - X/Square (cancel streaming)

**Message List**
- User message rendering
- Assistant thinking state (LargoThinkingState; streamed dots)
- Answer message (LargoAnswerMessage)
  - Markdown body (custom inline-markdown with comma-grouped number tokenization)
  - Evidence/citation rendering (links to sources)
  - Structured answer components (BIE cards, tables, chips)
  - Caveat footer (spend, model disclaimers)

**Answer Components** (composed per question)
- `LargoConcreteAnswer` — Plain text prose
- `BieAnswer` — BIE (BlackOut Intelligence Engine) structured answer
- `BieScenarioCards` — Outcome/scenario cards
- `BieKeyLevelsTable` — Support/resistance/pivot level table
- `BieChips` — Tag/label chips (e.g., "bullish", "accumulating", "earnings next week")
- `BieSectionCard` — Themed section container
- `LargoStructuredCards` — Generic structured output container
- `LargoCompareCard` — Side-by-side comparison view
- `LargoPlaySimilarityCard` — Play similarity/match card
- `LargoPreEarningsPackCard` — Earnings-specific card

**Status & Control Elements**
- FreshnessChip (timestamp; "as of 10:31 ET")
- Session controls
  - Conversation switcher (switch between saved sessions)
  - New conversation button (reset to empty state)
  - Session reset (full reset)
- Spend ceiling indicator (tokens used / limit)
- Answer mode toggle (text vs. structured)
- Depth toggle (shallow vs. deep reasoning)
- Historical mode toggle (backtest vs. live)
- Full-screen button (when supported on device)
- Regenerate button (when `canRegenerate=true`)

**State Indicators**
- LargoStatusStrip (session health, API status)
- LargoThinkingState (thinking indicator with animated dots)
- LargoEmptyState (initial state; module picker + starter cards)
- LargoDeskScopeBanner (shows active desk scope; allows change)
- LargoProactiveComposer (suggested follow-up or proactive question)
- LargoAnswerModeToggle (text ↔ structured toggle)

**Desk/Module Selection**
- LargoDeskModulePicker (browse/select desk: spx, helix, thermal, vector, meridian)
- Starter cards (product-specific suggested questions)
- Module-scoped questions (pre-filled with relevant desk context)

---

### I.5: Empty/Loading/Error/Degraded States

**Empty States**
- No conversation yet
  - Render: LargoEmptyState
  - Show: Module picker + starter cards
  - CTA: "Type a question or select a desk above"

- Fresh session
  - Render: Proactive composer + suggested reads
  - Example: "What's the SPX setup right now?"

**Loading States**
- Awaiting first token
  - Input placeholder: "Pulling live data…"
  - Thinking indicator active
  - Message: "(Analyzing...)"
  
- Streaming answer
  - Tool calls in progress (activeTools list shown)
  - Partial markdown rendering as it arrives
  - Stop button enabled

- Slow network
  - Status message: "Fetching data..." + elapsed time
  - Progress indicator on tool calls

**Error States**
- Attachment upload error
  - Message: "Failed to upload: [reason]"
  - Attachment removed from input
  - Recoverable with retry

- Tool execution failure
  - Caught at LargoMessageBody level
  - Rendered as: "⚠️ [Tool name] unavailable: [error message]"
  - Continues with available tools

- Network/connectivity loss
  - Status: "Connection lost. Retrying..."
  - Auto-retry backoff (exponential)
  - Manual retry button offered

- Session expiry/auth loss
  - Redirect to login or refresh token flow
  - Clear local state + show login screen

- 16k truncation
  - Tool result capped at 16k chars
  - Suffix: "…[truncated]" (visible to model)
  - Model notes truncation in answer: "I saw partial data because..."

**Degraded States**
- `get_nighthawk_edition` returns `degraded: true`
  - Message: "⚠️ Using fallback data for tonight's Night Hawk edition"
  - Serves older published edition or cached backup

- Partial tool failures
  - Some tools succeed, some error
  - Answer continues with available data: "Flow data unavailable, but here's the structure..."

- Rate limiting (member hit UW rate cap)
  - Tool returns: `rate_limited: true`
  - Answer: "UW data currently rate-limited; showing cached data or alternative source"

- Stale data
  - Tool returns: `stale: true`, `as_of: timestamp`
  - Answer qualifies: "This data is from 5 minutes ago; live quote is [fetched separately]"

- Incomplete data (optional fields missing)
  - No warning; answer adapts: "No recent earnings, but here's the technicals"
  - Confidence fields omitted when not calibrated (SPX Slayer)

- Spend ceiling reached
  - Status: "Spend limit reached for this session"
  - Input disabled
  - CTA: "Start a new conversation to continue"

---

## PART II: VALIDATION FRAMEWORK

### II.1: Number Validation Path

For every number in an answer, trace:

| Stage | Component | Validation |
|-------|-----------|-----------|
| **SOURCE** | Product tool's own calculation or data provider | Verify tool definition matches payload structure |
| **TOOL PAYLOAD** | Serialized in HTTP response from run-tool.ts | Check presence in response; no drop-off during serialization |
| **TRANSPORT** | 16k character limit (key-order-decides-survival) | Verify payload < 16k; identify which keys survive if truncated |
| **MODEL** | Received and processed by Claude (per truncation-probe) | Model receives complete payload or truncated marker |
| **ANSWER** | Rendered in prose/markdown | Number appears exactly as received (rounding normalized at source) |
| **CITATION** | Evidence linked (if tool provided source URL) | Link URL is correct; link text matches evidence |
| **CAVEAT FOOTER** | Spend ceiling + model limitations stated | Spend calc is correct; model disclaimer current |

**Critical Traps:**
- Truncation: If payload exceeds 16k, key-order determines survival. Test with `largo-truncation-probe.mjs`.
- Normalization: Polygon returns `7499.360000000001`; tool must round at source, not in markdown.
- Comma Grouping: Numbers like "7,500" must tokenize as ONE token, not THREE. Tested by `inline-markdown.test.ts`.

---

### II.2: Label Validation

**Confidence Fields**
- [ ] Omitted when product cannot calibrate (SPX Slayer, Thermal)
- [ ] Calibrated against BIE_INTERACTIONS.calibration_cohorts when present
- [ ] Never invented to fill silence (fake 75% is worse than honest omission)
- [ ] Never compared across products if one is absent

**Coverage Boundaries**
- [ ] Product-specific tool clearly states scope (e.g., "0DTE Command ONLY")
- [ ] Cross-product tool names what products it touches
- [ ] Caveat fires for silent reconciliation (disagreements shown)

**Caveat Firing**
- [ ] Spend ceiling: "You've used X% of your session token limit"
- [ ] Model limitation: "I don't have access to [specific data]"
- [ ] Data freshness: "This data is [time] old"
- [ ] Stale/Degraded: Product returns `degraded: true` → caveat shown
- [ ] Rate-limited: Tool returns UW cap → caveat shown
- [ ] Truncation: 16k cap hit → caveat shown

---

### II.3: Interaction Validation

**Slash Commands**
- [ ] `/spx NVDA` correctly extracts ticker and navigates to `/dashboard?ticker=NVDA`
- [ ] `/watch NVDA,TSLA` builds watchlist args and submits scoped question
- [ ] `/diff` sets desk scope to `largo` + mode: `diff`
- [ ] `/board` navigates to Night Hawk with 0DTE board question
- [ ] Autocomplete filters correctly (prefix > label > alias > desc)
- [ ] Score tiebreaker works (by rank, then label alpha)

**Desk Scope Switching**
- [ ] Setting desk scope prefills question with relevant context
- [ ] Scope banner shows current desk; click to change
- [ ] Question adapts based on scope (e.g., `/helix` → "Summarize HELIX flow on [ticker]")

**Navigation & Links**
- [ ] Citations link to correct source (not fabricated URLs)
- [ ] Track-record link goes to `/track-record`
- [ ] Product nav links include `?ticker=` when applicable

**Social & Sharing**
- [ ] Draft X-post appears in modal with pre-filled text
- [ ] Share-to-Discord flow opens channel picker
- [ ] Generated text respects length limits (Twitter 280, etc.)

**Session Controls**
- [ ] Reset clears messages, resets spend, returns to empty state
- [ ] New conversation creates fresh session; doesn't clear history
- [ ] Switch conversation fetches correct conversation from localStorage
- [ ] Attach file uploads; shows preview; can remove before submit

---

### II.4: Logic Pipeline Validation

```
QUERY (user input) 
  ↓
PARSE (slash command → question + scope)
  ↓
ROUTE (question intent → TOOL_GROUPS selection)
  ↓
DISPATCH (send tools + question to Claude)
  ↓
TOOL CALLS (Claude calls 1..N tools in parallel)
  ↓
VERIFY RESULTS (check payload sizes, presence, data quality)
  ↓
CAVEAT GATES (spend, confidence, degradation, truncation)
  ↓
EMPTY-FALLBACK (if tool returns {}, graceful degradation)
  ↓
SPEND CEILING (if token limit exceeded, stop iteration)
  ↓
OUTPUT (render answer + evidence + caveat)
```

**Each Stage Validation:**

- [ ] **QUERY**: Input arrives correctly; slash command parsed or treated as plain text
- [ ] **PARSE**: Slash command splits into command + args; args extracted correctly
- [ ] **ROUTE**: Question intent matches expected TOOL_GROUPS; no silent narrowing
- [ ] **DISPATCH**: All 129 tools sent to Claude? (Not filtered, per CLAUDE.md 2026-08-10)
- [ ] **TOOL CALLS**: Parallel calls resolved; timeouts handled; no duplicates
- [ ] **VERIFY RESULTS**: Each tool result < 16k chars; no corruption during transport
- [ ] **CAVEAT GATES**: Spend tracked; confidence omitted when needed; degradation flagged
- [ ] **EMPTY-FALLBACK**: Tool returns `{}` or `[]`? Answer continues gracefully
- [ ] **SPEND CEILING**: Session token limit enforced? No overflow into next conversation?
- [ ] **OUTPUT**: Answer renders; evidence linked; caveat shown; no orphaned references

---

### II.5: Performance Certification

**Baseline Targets** (from operational SLA)

| Metric | Target | Method | Acceptance |
|--------|--------|--------|-----------|
| Time-to-first-token | < 2.0s | Measure from submit to first char rendered | P90 across 10 runs |
| Full-answer latency | < 12s | Measure from submit to final period | Typical case, empty tools ok slower |
| Tool-call round-trip | < 500ms | Network + processing + return | Per-tool, parallel calls faster |
| Spend per question | < 50k tokens | Input + output combined | Typical; image analysis spends more |
| Payload sizes | < 16k each | Per-tool result | Enforced at serialization |
| Conversation lifespan | > 30 turns | Before hitting session token limit (context + spend) | Member's full work session |

**Certification Tests:**
- [ ] Measure TTFT on 5 typical questions (SPX, flow, earnings, etc.)
- [ ] Measure full-answer latency (cold and warm caches)
- [ ] Measure tool-call parallelism (one vs. multiple tools)
- [ ] Measure token spend: input (system + tools + question), output (answer + thinking)
- [ ] Measure conversation longevity (30 turns, typical spend per turn)
- [ ] Run under load (concurrent sessions) and report latency quantiles

---

## PART III: TOOLS USED PROVENANCE & CALIBRATION

### III.1: Tools_used Recording

**What is Recorded:**
- `bie_interactions.tools_used` — Array of tool names called on this turn

**Critical Gaps in Recording:**
- No call inputs stored (so `get_ecosystem_context` scope is unknown)
- No tool success/failure stored (all tools treated equally)
- No timestamp per tool (only query-level timestamp)

**Cohort Membership** (verified lists in tool-defs.ts)
- `SPX_ENGINE_TOOL_NAMES` — Did this turn read SPX Slayer's own state?
- `HELIX_ENGINE_TOOL_NAMES` — Did this turn read HELIX flow/tape state?
- `THERMAL_ENGINE_TOOL_NAMES` — Did this turn read Thermal's GEX state?
- `VECTOR_ENGINE_TOOL_NAMES` — Did this turn read Vector's chart state?
- `NIGHTHAWK_ENGINE_TOOL_NAMES` — Did this turn read Night Hawk's own state?
- `BIE_TOOL_NAMES` — Did this turn use BIE cross-product tools?
- `MARKET_ENGINE_TOOL_NAMES` — Did this turn read market context?
- `ZERODTE_ENGINE_TOOL_NAMES` — Did this turn read 0DTE Command's state?

**Ambiguity Handling:**
- Tools present in multiple cohorts (e.g., `get_wall_dynamics` in THERMAL + VECTOR)
  - Recorded by name only; context inferred from question
  - `KNOWN_AMBIGUOUS` list in `tools-used-provenance.test.ts`

---

### III.2: Calibration Cohorts

**BIE Calibration Cohorts** (src/lib/bie/calibration.ts)

For each product lane (SPX, HELIX, THERMAL, VECTOR, NIGHTHAWK, Market), measure:
- Tool cohort presence (e.g., SPX_ENGINE_TOOL_NAMES subset called?)
- Answer quality (correctness, completeness, caveats)
- Confidence accuracy (if present)
- Coverage (what questions could NOT be answered?)

**Persistent Data Shapes:**
- `bie_interactions` table stores: user, question, engine_cohorts, tools_used, answer, quality_score, confidence_override, calibration_version
- Shapes must be versioned (MERGE_POLICY_VERSION, CALIBRATION_VERSION)
- Shape changes require migration + re-baseline

---

## PART IV: MISSING FEATURES & KNOWN GAPS

- [ ] Depth mode (shallow vs. deep reasoning) — parsed but not enforced in prompt
- [ ] Historical mode (backtest vs. live data) — toggle present; enforcement unclear
- [ ] Chart guide (educational tooltip) — UI present; backend integration?
- [ ] Email draft/share — button present; backend not implemented?

---

## PART V: CERTIFICATION SIGN-OFF

### Validation Checklist

- [ ] All 129 tools enumerated and tested
- [ ] All slash commands work (nav + terminal + prompts)
- [ ] All APIs respond correctly (session, query, context, output)
- [ ] All UI components render (no undefined refs, proper states)
- [ ] Empty/loading/error/degraded states tested (no silent failures)
- [ ] Number validation path traced (source → output)
- [ ] Label validation passed (confidence omitted when needed)
- [ ] Interaction validation passed (slash, scope, nav, social)
- [ ] Logic pipeline validated (no silent narrowing, spend enforced)
- [ ] Performance baseline met (TTFT < 2s, answer < 12s)
- [ ] Tools_used provenance verified (correct cohort membership)
- [ ] Calibration cohorts defined (pre-baseline metrics logged)

### Final Verdict

**Certification Status:** PENDING FULL VALIDATION  
**Blocker-Level Issues:** None identified to date  
**Open Measurements:** Large-scale truncation probe (all 129 tools); live performance under load  
**Next Step:** Run truncation probe + performance baseline suite; then mark COMPLETE

---

**Certified By:** Claude Code Session (2026-08-23)  
**Last Updated:** 2026-08-23T18:45:00Z

