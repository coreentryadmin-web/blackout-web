# LARGO VALIDATION TEST MATRIX
## 2026-08-23 Comprehensive Certification Plan

**Purpose:** Systematically validate all 129 Largo tools against the certification framework  
**Scope:** Member-facing surface, tool payloads, UI rendering, logic pipeline, performance  
**Execution Mode:** Documented tests + live probe runs (requires prod auth)

---

## PHASE 1: SURFACE COVERAGE VALIDATION (STATIC)

### Test Matrix 1.1: Slash Commands
**Location:** `src/lib/largo/slash-commands.test.ts`

| Test Case | Validation | Status |
|-----------|-----------|--------|
| T1.1.1 | All 7 nav commands have correct href targets | ✓ Automated |
| T1.1.2 | All 4 terminal commands set correct deskScope | ✓ Automated |
| T1.1.3 | Ticker extraction works (`/spx NVDA` → `?ticker=NVDA`) | ✓ Automated |
| T1.1.4 | Slash menu filtering sorts by rank (900 prefix > 800 label > 700 alias > 500 substr) | ✓ Automated |
| T1.1.5 | Limit 12 results respected in filterLargoSlashCommands | ✓ Automated |
| T1.1.6 | Watch list parsing works (`/watch NVDA,TSLA` → watchTickers array) | ✓ Automated |
| T1.1.7 | Prompt commands built from LARGO_DESK_PROMPTS (non-social-pack only) | ✓ Automated |

**Test File:** `src/lib/largo/slash-commands.test.ts`  
**Run:** `npx tsx --test src/lib/largo/slash-commands.test.ts`

---

### Test Matrix 1.2: Tool Definitions
**Location:** `src/lib/largo/tool-defs.test.ts`

| Test Case | Validation | Status |
|-----------|-----------|--------|
| T1.2.1 | All 129 tool names in LARGO_TOOL_DEFS defined exactly once | ✓ Automated |
| T1.2.2 | No undefined references in tool descriptions | ✓ Static check |
| T1.2.3 | SPX_ENGINE_TOOL_NAMES ⊆ TOOL_GROUPS.spx_desk | ✓ Automated |
| T1.2.4 | HELIX_ENGINE_TOOL_NAMES ⊆ TOOL_GROUPS.flow_analysis | ✓ Automated |
| T1.2.5 | THERMAL_ENGINE_TOOL_NAMES ⊆ TOOL_GROUPS.stock_analysis | ✓ Automated |
| T1.2.6 | VECTOR_ENGINE_TOOL_NAMES ⊆ TOOL_GROUPS.stock_analysis | ✓ Automated |
| T1.2.7 | NIGHTHAWK_ENGINE_TOOL_NAMES ⊆ TOOL_GROUPS.platform | ✓ Automated |
| T1.2.8 | BIE_TOOL_NAMES all present in at least one TOOL_GROUP | ✓ Automated |
| T1.2.9 | No orphaned tools (not in any TOOL_GROUP) | ✓ Automated |
| T1.2.10 | Tool name drift detection (marker sweep prevents silent count changes) | ✓ Automated (tool-count-claims.test.ts) |

**Test File:** `src/lib/largo/tool-defs.test.ts`  
**Run:** `npx tsx --test src/lib/largo/tool-defs.test.ts`

---

### Test Matrix 1.3: Number Tokenization (Comma-Grouped)
**Location:** `src/features/largo/components/inline-markdown.test.ts`

| Test Case | Validation | Status |
|-----------|-----------|--------|
| T1.3.1 | `7,500` tokenizes as ONE token (not "7", "500") | ✓ Automated |
| T1.3.2 | `7,500,000` (multi-group) stays whole | ✓ Automated |
| T1.3.3 | `7,500.25%` composes correctly (sign+comma+decimal+percent) | ✓ Automated |
| T1.3.4 | `$7,500` (currency) preserves grouping | ✓ Automated |
| T1.3.5 | Bare `123` still matches (fallback for 1-3 digit integers) | ✓ Automated |
| T1.3.6 | No over-matching inside larger digit strings (e.g., `12345` not split) | ✓ Automated |

**Test File:** `src/features/largo/components/inline-markdown.test.ts`  
**Run:** `npx tsx --test src/features/largo/components/inline-markdown.test.ts`

---

### Test Matrix 1.4: Tools-Used Provenance
**Location:** `src/lib/largo/tools-used-provenance.test.ts`

| Test Case | Validation | Status |
|-----------|-----------|--------|
| T1.4.1 | Tools_used array contains three kinds: engine (SPX, HELIX, etc), BIE (cross-product), or generic | ✓ Automated |
| T1.4.2 | Detect collisions (tool name appears as prefetch marker and callable tool) | ✓ Automated |
| T1.4.3 | KNOWN_AMBIGUOUS list prevents false positives (currently: `get_helix_thermal_compare`) | ✓ Automated |
| T1.4.4 | No tool name sits in BIE calibration cohort unless intentionally in BIE_TOOL_NAMES | ✓ Automated |
| T1.4.5 | Regex must match something in scanned files (vacuous-guard control) | ✓ Automated |

**Test File:** `src/lib/largo/tools-used-provenance.test.ts`  
**Run:** `npx tsx --test src/lib/largo/tools-used-provenance.test.ts`

---

## PHASE 2: COMPONENT RENDERING (UI)

### Test Matrix 2.1: Terminal Components
**Manual + Playwright**

| Component | Validation | Status |
|-----------|-----------|--------|
| LargoTerminal | Renders input, message list, status, controls | Manual |
| LargoSlashMenu | Dropdown appears on `/`; filters correctly | Manual |
| LargoSlashPromptsMenu | Dynamic prompts from API load; select works | Manual |
| LargoMessageBody | Markdown renders; links work; evidence panel opens | Manual |
| LargoAnswerMessage | Answer + caveat footer both render | Manual |
| LargoThinkingState | Animated dots shown during streaming | Manual |
| LargoEmptyState | Module picker + starter cards shown on fresh session | Manual |
| LargoDeskScopeBanner | Current desk shown; click to change scopes | Manual |
| LargoStatusStrip | Session health, API status indicators | Manual |
| LargoTerminalToolbar | Reset, new conversation, fullscreen buttons | Manual |

**Test Runner:** Playwright E2E (not yet in suite; manual spot-check for now)

---

### Test Matrix 2.2: Answer Component Variants
**Automated via snapshot tests**

| Component | Case | Validation |
|-----------|------|-----------|
| BieAnswer | Structured intelligence (bullets, sections) | Renders, no orphan refs |
| BieScenarioCards | Outcome cards (bullish/bearish/neutral) | Card border, chips render |
| BieKeyLevelsTable | Support/resistance levels | Table layout, numbers format |
| BieChips | Tags (bullish, accumulating, etc) | Color, icon, hover state |
| LargoCompareCard | Side-by-side comparison | Two columns, aligned content |
| LargoPlaySimilarityCard | Play match card | Similarity %, reasoning |
| LargoStructuredCards | Generic container | Fallback for unknown types |

**Test File:** `src/features/largo/answer/*.test.ts`  
**Run:** `npx tsx --test src/features/largo/answer/`

---

## PHASE 3: TOOL PAYLOAD VALIDATION (LIVE)

### Test Matrix 3.1: Truncation Probe (16k Cap)
**Live probe against production**

**Entry Point:** `scripts/audit/largo-truncation-probe.mjs`

**Tested Tools (CRITICAL):**
```
get_zerodte_record (days=30)          → Expected: COMPLETE
get_zerodte_plays ()                  → Expected: COMPLETE
get_zerodte_rejections (largest window) → Expected: TRUNCATED (CONTROL)
get_nighthawk_edition ()              → Expected: COMPLETE
get_nighthawk_outcomes (days=30)      → Expected: COMPLETE
get_helix_tape_analytics (no ticker)  → Expected: COMPLETE (market-wide large)
get_helix_derived (no ticker)         → Expected: COMPLETE
get_helix_signal_outcomes ()          → Expected: COMPLETE
get_helix_thermal_compare (SPX)       → Expected: COMPLETE
```

**Methodology:**
1. Run probe against each tool
2. Verify CONTROL tool (get_zerodte_rejections) returns TRUNCATED marker
3. If control is COMPLETE, report all other COMPLETE as UNVERIFIED
4. If control is TRUNCATED, report each tool's actual status (COMPLETE/TRUNCATED/INDETERMINATE)
5. Aggregate: pass if all critical tools COMPLETE + control TRUNCATED

**Run Command:**
```bash
node --import tsx scripts/audit/largo-truncation-probe.mjs \
  --tools=get_zerodte_record,get_zerodte_plays,get_zerodte_rejections \
  --control=get_zerodte_rejections \
  --base=https://blackouttrades.com \
  --json
```

**Expected Output:**
```json
{
  "control": {
    "name": "get_zerodte_rejections",
    "status": "TRUNCATED",
    "proven": true
  },
  "tools": [
    { "name": "get_zerodte_record", "status": "COMPLETE", "verdict": "CONFIRMED" },
    { "name": "get_zerodte_plays", "status": "COMPLETE", "verdict": "CONFIRMED" },
    { "name": "get_zerodte_rejections", "status": "TRUNCATED", "verdict": "CONFIRMED" }
  ],
  "runId": "...",
  "exitCode": 0
}
```

**Acceptance Criteria:**
- [ ] Control tool status is TRUNCATED (proves instrument works)
- [ ] All critical tools report COMPLETE (not TRUNCATED, not INDETERMINATE)
- [ ] Exit code is 0 (no errors detected)
- [ ] No tool is listed as INDETERMINATE (unknown state)

---

### Test Matrix 3.2: Payload Hygiene (Per-Tool)
**Static analysis + sample runs**

| Tool | Max Typical Size | Notes |
|------|-----------------|-------|
| get_spx_structure | ~8k | Desk snapshot (live data) |
| get_nighthawk_edition | ~6k | Published plays (10-15 plays × 400 chars) |
| get_zerodte_plays | ~5k | Scanner board (20-30 plays) |
| get_zerodte_record | ~3k | Track record (stats only) |
| get_helix_tape_analytics | ~9k | Market-wide tape (500 rows aggregated) |
| get_flow_tape | ~7k | Postgres tape (50 rows, wide fields) |
| get_earnings | ~4k | Earnings + estimates (Benzinga structured) |
| get_news | ~8k | News articles (10 headlines + summaries) |

**Validation:**
- [ ] Largest tool tested at max-case args (market-wide, wide window)
- [ ] No tool exceeds 16k under normal usage
- [ ] Key-order analyzed: critical keys (name, price, pnl) early in JSON

---

## PHASE 4: LOGIC PIPELINE (INTEGRATION)

### Test Matrix 4.1: Query → Answer Flow
**End-to-end Playwright E2E**

| Flow | Steps | Validation |
|------|-------|-----------|
| Plain question | Input "What's SPX?" → Submit → Get answer | Answer appears; no orphan refs |
| Slash navigate | `/spx` → Navigate to `/dashboard` | Router works |
| Slash terminal | `/watch NVDA,TSLA` → Set scope + question | Question prefilled with watchlist |
| Slash prompt | `/spx-setup` → Fire question | Question from LARGO_DESK_PROMPTS fires |
| Regenerate | Answer ready → Click regenerate → New answer | Same question re-runs; different answer ok |
| Session reset | Mid-conversation → Reset → Empty state | Messages cleared, input focused |

**Test File:** Manual (or Playwright E2E if available)

---

### Test Matrix 4.2: Tool Routing
**Inspect Claude's actual tool calls**

| Intent | Expected TOOL_GROUPS | Validation |
|--------|-------------------|-----------|
| "What's the SPX setup?" | spx_desk (narrow: SPX_ENGINE_TOOL_NAMES) | Uses get_spx_structure not generic flow |
| "Show HELIX flow" | flow_analysis (HELIX_ENGINE_TOOL_NAMES) | Uses get_flow_tape not get_global_flow |
| "Thermal heatmap status?" | stock_analysis (THERMAL_ENGINE_TOOL_NAMES) | Uses get_positioning not get_gex |
| "0DTE board?" | platform (NIGHTHAWK_ENGINE_TOOL_NAMES) | Uses get_zerodte_plays not generic plays |
| "What's the market doing?" | vol_analysis (MARKET_ENGINE_TOOL_NAMES) | Uses get_market_context |

**Method:** Run query; inspect `bie_interactions.tools_used`; verify cohort membership

---

### Test Matrix 4.3: Spend Ceiling Enforcement
**Simulate high-spend questions**

| Scenario | Expected Behavior | Validation |
|----------|------------------|-----------|
| Normal question (5-10k tokens) | Continue normally | Status shows spend; answer completes |
| High-spend question (25-40k tokens) | Warn but allow | Caveat footer shows "45% of limit used" |
| Over-limit (sum > session ceiling) | Stop iteration, show caveat | "Spend limit reached" message; input disabled |

**Method:** Monitor token spend in real-time; verify caveat appears

---

## PHASE 5: PERFORMANCE BASELINE

### Test Matrix 5.1: Latency Measurements
**Live latency test suite**

**Setup:**
- 5 representative questions
- Cold cache + warm cache runs
- 3 iterations each
- Report p50, p90, p95 + mean

**Questions:**
1. "What's SPX?" (SPX_ENGINE_TOOL_NAMES)
2. "Show HELIX flow" (HELIX_ENGINE_TOOL_NAMES)
3. "Earnings today?" (news_events + fundamental)
4. "0DTE board?" (NIGHTHAWK_ENGINE_TOOL_NAMES)
5. "Compare SPX vs Night Hawk" (cross-product, get_spx_vs_nighthawk_comparison)

**Metrics:**
| Metric | Target | p50 | p90 | p95 | Max |
|--------|--------|-----|-----|-----|-----|
| TTFT | < 2.0s | 1.2s | 1.8s | 2.1s | 2.5s |
| Full-answer | < 12s | 6.5s | 9.8s | 11.2s | 13s |
| Tool round-trip | < 500ms | 150ms | 350ms | 400ms | 500ms |

**Pass Criteria:**
- [ ] TTFT p95 < 2.0s
- [ ] Full-answer p95 < 12s
- [ ] Tool round-trip p95 < 500ms
- [ ] No outlier > 2× target

**Run Command:**
```bash
npm run validate:largo-latency
```

---

### Test Matrix 5.2: Token Spend Analysis
**Per-question spend tracking**

| Question Type | Avg Input | Avg Output | Avg Total | Acceptable |
|----------------|-----------|-----------|-----------|-----------|
| Simple quote | 500 | 1,000 | 1,500 | < 2,500 |
| Multi-tool | 2,000 | 3,000 | 5,000 | < 8,000 |
| Complex cross-product | 3,500 | 8,000 | 11,500 | < 15,000 |
| Full session (30 turns) | — | — | 35,000 | < 60,000 |

**Methodology:** Instrument `useLargoChat` hook to track token usage; log per-turn

---

## PHASE 6: KNOWN DEFECTS & WORKAROUNDS

### Active Issues

| Issue | Severity | Status | Workaround |
|-------|----------|--------|-----------|
| `get_zerodte_rejections` truncates on largest window | P2 | Confirmed | Limit window to 7 days in queries |
| Depth mode toggle parsed but not enforced | P3 | Open | Feature not yet implemented |
| Historical mode state not persisted | P3 | Open | Session-local only, no backend storage |
| Chart guide (educational tooltip) not integrated | P3 | Open | UI component only; tooltip not firing |

---

## EXECUTION CHECKLIST

### Pre-Certification (Automated)
- [ ] Run all unit tests: `npm test`
- [ ] Check tool-defs drift: `npx tsx --test src/lib/largo/tool-defs.test.ts`
- [ ] Check slash commands: `npx tsx --test src/lib/largo/slash-commands.test.ts`
- [ ] Check number tokenization: `npx tsx --test src/features/largo/components/inline-markdown.test.ts`
- [ ] Check tools-used provenance: `npx tsx --test src/lib/largo/tools-used-provenance.test.ts`
- [ ] Build: `npm run build`
- [ ] Type check: `npx tsc --noEmit`

### Live Validation (Requires Prod Access)
- [ ] Run truncation probe: `node --import tsx scripts/audit/largo-truncation-probe.mjs --json`
- [ ] Run latency baseline: `npm run validate:largo-latency`
- [ ] Manual spot-checks:
  - [ ] Terminal UI renders (no console errors)
  - [ ] Slash commands filter + select
  - [ ] Answer components render (text, structured, cards)
  - [ ] Spend indicator updates
  - [ ] Social share flows (X-post, Discord)

### Final Sign-Off
- [ ] All unit tests pass
- [ ] Truncation probe: all critical tools COMPLETE + control TRUNCATED
- [ ] Latency: TTFT p95 < 2s, answer p95 < 12s
- [ ] No console errors during normal usage
- [ ] Spend ceiling enforced (session stops when limit reached)
- [ ] Sign certification document with results

---

**Certification Ready:** Once all checkboxes pass  
**Last Updated:** 2026-08-23T19:00:00Z

