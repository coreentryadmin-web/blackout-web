# Largo AI — Deep End-to-End Audit
Last updated: 2026-06-29 16:03 PDT (automated `audit-largo-ai`)

## Overall Health: PASS (with 3 low-severity WARN items)

Largo's grounding architecture is strong and the task #73 SPX/SPY-confusion class of
bug is comprehensively defended in depth. Every numeric surface resolves from live
Polygon / UW / Benzinga / SPX-desk data or returns empty — no fabricated-value paths
were found. Session isolation, rate limiting, daily budget, global concurrency ceiling,
prompt caching, and an org-wide spend kill-switch are all in place. The WARN items are
coverage/robustness nits, not wrong-answer risks.

Code reviewed (all under `src/`):
- `app/api/market/largo/query/route.ts` — chat endpoint (gates, streaming, budget)
- `app/api/market/largo/session/route.ts` — session load (auth + ownership)
- `app/api/cron/largo-cleanup/route.ts` — retention sweep
- `lib/largo-terminal.ts` — turn orchestration / tool loop
- `lib/largo/{tool-defs,run-tool,system-prompt,largo-store,largo-live-feed,spx-desk-cache}.ts`
- `lib/largo-{budget,global-gate,local-gate}.ts`, `lib/providers/{anthropic,gex-positioning}.ts`
- `lib/nighthawk/positioning.ts` (backs `get_positioning`)

---

## Tool Grounding Verification

| Tool | Data Source | Live? | Can Return Stale? | TTL | Issues |
|---|---|---|---|---|---|
| get_quote | Polygon index/stock snapshot (`I:SPX` for SPX) | Yes | Provider snapshot only | provider | None — returns `{error}` if no quote, never a guess |
| get_market_context | Polygon `I:SPX`/`I:VIX` indices + ETFs + UW tide + SPX desk | Yes | Shared cache `TTL.MARKET_SNAPSHOT` | short | SPX spot is from `I:SPX` index, **not** SPY ✔ |
| get_gex | SPX 0DTE → SPX Sniper desk (`getLargoSpxLiveDesk`, dashboard-identical); else Polygon chain GEX → UW fallback | Yes | Per-user desk cache 60s | 60s | SPX path returns `source:"spx_sniper_desk"` + `as_of` ✔ |
| get_positioning | `getGexPositioning(sym)` shared `gex-heatmap:{ticker}` matrix → Polygon bundle fallback | Yes | Heatmap matrix cache | matrix TTL | Depends on `gex-heatmap:SPX` being warm (WARN-1); never fabricates — empty on cold |
| get_spx_confluence | `computeSpxConfluence(desk)` on cached live desk | Yes | Per-user desk cache 60s | 60s | Pure compute, no extra upstream; full confluence object surfaced ✔ |
| get_spx_structure | `marketPlatform.spx.getSpxDeskSummary()` (merged desk) | Yes | Desk cache | short | Same payload as SPX Sniper dashboard ✔ |
| get_options_flow / get_flow_tape | UW flow + Postgres HELIX tape | Yes | tape/Postgres | short | strike_stacks computed from raw alerts |
| get_my_positions | Night's Watch `getEnrichedPositionsForUser(userId)` | Yes | live valuation flagged | live | Fails closed if no auth scope; never fabricates P&L (null when `valuation_status!="live"`) ✔ |
| get_news / get_catalysts / get_price_targets | Benzinga primary → Polygon → UW | Yes | `TTL.EARNINGS` etc | varies | Feed text sanitized (`sanitizeFeedText`) + treated as untrusted |
| Live feed (every turn) | `get_market_context`+`get_spx_structure`+`getGexPositioning("SPX")`+technicals/flow/positions | Yes | per-job caches | ≤60s | GEX block correctly queries **"SPX"** and labels **"SPX spot (matrix)"** ✔ |

Key grounding facts:
- **No fallback/mock/hardcoded data paths.** Grep for `mock|hardcoded|TODO|FIXME|placeholder`
  in `run-tool.ts` = 0 hits. Where spot is unavailable, code gates on `spot > 0` and returns
  empty (`gex_rows:[]`, `n/a`) rather than synthesizing a value.
- **`?? 0` is used only as a guard**, never surfaced as a fact: `resolveSpot` returns `0` →
  downstream branches skip the fetch and return empty.
- **Input validation:** `validateTicker` rejects >10 chars / non-`[A-Za-z0-9.\-]` before any
  upstream call. `get_nighthawk_outcomes` clamps the LLM-supplied window to an integer 7–180
  (prevents a Postgres `invalid input syntax for integer` crash from a hallucinated float).
- **System prompt enforces grounding:** "Every number in your reply must appear in the live
  feed or a tool result from this turn"; explicit no-invented-data / no-fake-precision rules.

---

## Tool Registration Audit

| Check | Result |
|---|---|
| Tools defined in `tool-defs.ts` | 89 |
| Tools with a dispatch `case` in `run-tool.ts` | 89 — **100% covered** |
| Defined but unregistered (uncallable) | **None** |
| Registered but undefined (dead cases) | **None** |
| Defined but absent from every `TOOL_GROUP` (intent-unreachable) | **None** — LARGO-9 orphans fully resolved |

`getToolsForIntent()` filters the tool list per question (intent regexes + ticker detection),
with a `CORE_TOOLS` fallback when intent is ambiguous (`names.size <= 2`). Every defined tool
is reachable through at least one group or the core/ticker fallback.

---

## Known Grounding Issues (task #73)

- **SPX vs SPY confusion: RESOLVED (defense in depth).**
  1. Dedicated mandatory "SPX vs SPY" section in the system prompt with non-negotiable strike
     disambiguation rules (walls in thousands = SPX; never divide by 10; always prefix
     "SPX XXXX" / "SPY XXX").
  2. Live feed injects a GEX block from `getGexPositioning("SPX")` labeled "SPX spot (matrix)"
     — query and label agree (verified `largo-live-feed.ts:84` vs `:405`).
  3. `get_gex` routes SPX 0DTE to the SPX Sniper desk (`source:"spx_sniper_desk"`), genuinely
     SPX-denominated and identical to the dashboard.
  4. `get_quote` / `get_market_context` use Polygon `I:SPX` index, not SPY.
  5. Tool descriptions for `get_gex` / `get_positioning` explicitly state SPX strikes are
     thousands and "Do not divide by 10".
- **Stale GEX levels: RESOLVED.** Per-user SPX desk cache enforces a 60s TTL with LRU eviction
  (`spx-desk-cache.ts`); `get_gex` SPX path returns `as_of`. The shared matrix cache-reader
  (`getGexPositioning`) cross-validates call/put wall & flip against the UW REST strike ladder
  and logs a warning on >5pt divergence.
- **Confluence blind spots: RESOLVED.** `get_spx_confluence` runs `computeSpxConfluence` over
  the full merged live desk and is also pre-populated into the live feed every turn. Largo is
  no longer blind to the scored thesis (the original Largo-audit finding).

---

## Session Management

- **Storage:** Postgres (`largo_sessions` / `largo_messages`) when DB configured; in-memory LRU
  (cap 500 sessions) fallback otherwise. Both enforce owner checks.
- **Cross-user isolation: SAFE.** `ensureLargoSession` upserts with `RETURNING user_id` and
  throws if the existing owner ≠ caller (no silent hijack — `user_id` deliberately excluded from
  `DO UPDATE SET`). `fetchLargoHistory` / `fetchLargoMessagesPublic` / `getLargoSessionMessages`
  all gate on `sessionOwnedByUser`, including the no-DB memory path (LARGO-10 fix). `userId`
  always comes from server-side Clerk auth (`requireTierApi`), never from request body.
- **Context window: BOUNDED.** History capped at `MAX_HISTORY=28` messages (`trimHistory`),
  `maxTokens=4096`, `maxRounds=12`. Role alternation fixed (LARGO-3: user turn persisted only
  AFTER the assistant completes, so an aborted tool loop can't orphan a trailing user message).
- **Cleanup: WORKING.** `largo-cleanup` cron (`railway.largo-cleanup.toml` → `hit-cron.mjs
  /api/cron/largo-cleanup`, Bearer-authorized) deletes sessions inactive > `LARGO_SESSION_
  RETENTION_DAYS` (default 7), messages cascade. Per-session row cap of 50 enforced on every
  append.

---

## Rate Limiting & Cost Controls

- **Per-user concurrency:** max 2 simultaneous queries (Redis atomic INCR+EXPIRE Lua, 180s TTL,
  fails open to a process-local backstop of 6 on Redis loss).
- **Org-wide concurrency ceiling:** `DEFAULT_LARGO_GLOBAL_MAX_CONCURRENT=40` (leak-safe ZSET,
  150s inflight TTL, self-healing on crashed-replica reservations).
- **Daily per-user budget:** `DEFAULT_LARGO_DAILY_QUERY_BUDGET=100/day` (Redis counter, expires
  at ET midnight; recorded on both success AND failure — conservative).
- **AI spend tracking: ACTIVE.** Cross-replica spend ledger in `ai-spend-ledger` wired into
  `providers/anthropic.ts` (alert threshold + per-process backstop).
- **Daily spend kill-switch: OPT-IN.** `DAILY_AI_SPEND_KILL_USD` gates the org-wide hard stop;
  **disarmed by default** (matches the AI-spend-guardrails memo). Fails CLOSED to the per-process
  backstop on Redis loss. Recommend arming it in prod (WARN-2).
- **Prompt caching: ENABLED (task #103 done).** `cacheSystem: true` + `cache_control:
  {type:"ephemeral"}` on the stable system prompt block (~50% system-token savings on repeats).
- **Per-round timeout:** 60s so one slow round degrades to partial text instead of a 500 (#77 E).
- **Current model:** `LARGO_MODEL = "claude-sonnet-4-6"` — appropriate tier for an interactive
  desk assistant (not Opus); cost-aware.
- **Auth/launch gates:** `requireTierApi("premium")` + `requireToolApi("largo")` launch lock on
  both query and session routes. Endpoints verified live: apex POST `/api/market/largo/query`
  → 401 unauth (gate working); `www` → 301 (apex-host rule); session → 401.

---

## Missing Tools / Gaps

- No `/api/terminal/health` (or `/api/market/largo/health`) endpoint exists — the task's STEP 6
  health probe has no target. Low value to add, but noted for completeness.
- No authenticated synthetic end-to-end query is run by any cron — grounding is verified by code
  path + the `data-correctness` cron's matrix checks, not by an actual Largo answer assertion.
  A signed-in canary ("what is SPX spot?" → assert reply contains the live `I:SPX` value within
  tolerance) would catch a regression that static analysis can't (WARN-3).

---

## Recommendations (ranked; wrong-answer risks are P0)

- **P0 — none.** No wrong-answer (fabrication / SPX-as-SPY mislabel) path was found. The #73
  class is defended at the prompt, feed, and tool layers simultaneously.
- **WARN-1 (P2) — `get_positioning` SPX coverage depends on a warm `gex-heatmap:SPX` matrix.**
  If only the SPY heatmap is warmed by crons, `get_positioning("SPX")` returns null and falls
  back to `fetchStockSnapshot("SPX")` (which isn't a tradable stock) → empty summary. This is
  *safe* (empty, never SPY-mislabeled-as-SPX), but it silently drops SPX positioning on that
  path. Mitigation already exists: `get_gex` covers SPX via the desk. Action: confirm the SPX
  heatmap is warmed, or have `fetchPositioningSummary` short-circuit SPX to the desk like
  `get_gex` does.
- **WARN-2 (P2) — arm the spend kill-switch in prod.** `DAILY_AI_SPEND_KILL_USD` is unset by
  design, so the hard org-wide stop is currently inert; only the budget/concurrency gates bind.
  Set a ceiling so a runaway can't burn unbounded Anthropic spend before midnight reset.
- **WARN-3 (P3) — add an authenticated grounding canary.** A scheduled signed-in query asserting
  Largo's SPX-spot answer matches live `I:SPX` (±tolerance) would turn this static audit into a
  live regression guard.

## Verdict
Largo is production-grade on grounding, isolation, and cost control. Ship-safe. The three WARN
items are hardening, not fixes — none represents a current wrong-answer risk to traders.
