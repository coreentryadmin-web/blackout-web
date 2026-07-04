# BLACKOUT Intelligence Engine (BIE)

**Mission:** the institutional brain of BLACKOUT — a continuously improving intelligence
system where every number is deterministic and traceable, most questions are answered
without any LLM, and external models (Claude) are the general-reasoning *fallback*, not
the foundation. Not a chatbot. An intelligent operating system.

**BIE is not a server or a message bus.** It is a set of plain TypeScript modules under
`src/lib/bie/*` that export async functions. Three things import them directly: Largo's
tool dispatcher (`src/lib/largo/run-tool.ts`), the admin report route
(`/api/admin/bie-report`), and a couple of dashboard routes (0DTE board echo). There is no
network hop between "BIE" and its callers — it is a library, not a service, so nothing
depends on a separate BIE process being up.

## Honest realism (read this first)

- **We do NOT train our own frontier LLM.** Pretraining or live weight-updates
  ("train every second") costs 8-9 figures in compute plus a research team, and no
  serious lab updates weights live in production — it is how models get corrupted.
- **We DO get "learning every minute"** — through knowledge and calibration updates:
  every scan, every graded play, every verified/unverified claim, every interaction
  becomes structured data that measurably changes behavior. Auditable, reversible,
  and honest.
- **The trust goal, correctly framed:** not "a model no one can question" but a system
  where every claim is so traceable that questioning it is EASY — and it survives.
- **Phase 4 (optional, data-gated):** fine-tune a small open-weight model on months of
  accumulated, outcome-graded Q&A. Only sensible once the data exists; by then it is
  cheap. Claude remains the fallback for open-ended reasoning either way.
- **BIE never invents a correctness verdict.** Accuracy comes from validation systems,
  audit trails, deterministic calculations, and source-of-truth checks — all plain code,
  independently verifiable. BIE's job is to detect, explain, rank, and (as of Stage 5
  step 1, see below) *propose* — never to decide on its own that something is correct,
  and never, today, to act on that proposal itself.

## The five layers

| Layer | What | Status |
|---|---|---|
| **L1 Deterministic** | Every number from verified calculation engines — greeks/GEX (Polygon chains), scorers, plan math, grading. No LLM ever computes a figure. | LIVE (platform law since the audits; 0DTE stack fully deterministic) |
| **L2 Knowledge** | Structured, searchable domain + platform knowledge (portable JSONB embeddings, cosine in Node; Voyage `voyage-3`). Docs, FINDINGS, editions, platform map, self-evals. Ingests every `.md` in `docs/`, `docs/bie/`, `docs/audit/`, plus `AGENTS.md`/`CLAUDE.md`, nightly via the `db-cleanup` cron — so a doc fix like this one propagates to Largo's retrieved grounding on the next ~3 AM ET run, not instantly. | **LIVE** (VOYAGE_API_KEY provisioned 2026-07-03; cold chunks backfill automatically) |
| **L3 Reasoning/Router** | Deterministic answer router: questions that map onto platform truth are answered instantly from source-of-truth readers — no LLM, no cost, zero hallucination. Ambiguous/reasoning questions → Claude with retrieved grounding plus **~50 Largo tools**, of which the BIE-authored subset is `get_ecosystem_context`, `get_hot_tickers`, `get_market_regime`, `get_confluence_outcomes` (see "Cross-instrument awareness" below) — growing as more instruments get a query surface, not a fixed count. | **Phase 1 — SHIPPED** (`src/lib/bie/router.ts`, `composers.ts`); 4 hand-tuned intents (today's-plays, ledger-ticker play state, SPX structure, market context) — unsure always falls through to Claude, on purpose |
| **L4 Self-evaluation** | Numeric-claim verifier: every figure in an LLM answer is matched against the data actually served that turn; unverified-heavy answers carry an explicit caution. Same philosophy as Night Hawk's grounding gates. | **Phase 1 — SHIPPED** (`src/lib/bie/verifier.ts`) |
| **L5 Learning** | Outcome-graded feedback: daily self-eval report (coverage/verification/cost avoided), 14-day calibration harness (score-band/ToD/spike buckets → evidence-cited gate recommendations, report-first, never tunes on noise), telemetry discovery report (slow/failing/expensive call patterns, application errors, cron/worker health, Railway/Postgres/Redis/Clerk-auth signals — see Stage 2/3 below) — all persisted into the knowledge store on the daily cron tick. | **SHIPPED**, expanding — full rollout history in `docs/bie/FULL-SYSTEM-AWARENESS.md` |

## Cross-instrument awareness — the ecosystem-context line

Every instrument (0DTE Command, Night Hawk, HELIX flow, the regime detector) already
writes its own findings into shared Postgres. Until this line shipped, nothing let one
instrument — or a member asking Largo a question — see what another instrument already
found. `src/lib/bie/ecosystem-context.ts`'s `fetchEcosystemContext(ticker)` is that shared
read layer: one function, one `Promise.all`, six fields per ticker:

1. `zerodte_today` — today's 0DTE Command take (direction, score, conviction, status), if any.
2. `nighthawk_recent` — the most recent **published** Night Hawk take (a play rejected at
   the trade-geometry gate never lands here — it shows up only as a `nighthawk_rejected`
   row in `recent_audit_entries`).
3. `recent_audit_entries` — the last 10 `alert_audit_log` rows for this ticker, the unified
   Stage 4 trail spanning all three write-paths (0DTE, Night Hawk published, Night Hawk
   rejected).
4. `recent_flow` — same-day HELIX call/put/unknown-side premium totals from `flow_alerts`
   (6h window), reported neutrally — never collapsed into a fabricated "bullish/bearish"
   label when the option side can't be parsed.
5. `recent_anomalies` — pattern-detected flow anomalies (concentration, coordinated sweep,
   premium spike, put surge) from `flow_anomalies`, written by the market-regime-detector
   cron; a third consumer of that table, alongside Night Hawk's own platform-intel snapshot
   and the member-facing `/api/market/anomalies` feed.
6. `flow_feed_fresh` — is the live HELIX flow pipeline actually delivering frames right now,
   cluster-wide (`isFlowFrameFreshAnywhere`, a Redis heartbeat, not one replica's in-memory
   guess)? Disambiguates `recent_flow: null`/empty `recent_anomalies`: could mean "genuinely
   quiet" OR "ingestion is down, we simply have no data" — two very different answers to
   give a member. When false, silence must be reported as "unknown," never as "quiet."

Fails open to an all-empty context on any error, by design — a lookup failure here must
never block whatever else Largo or a dashboard was already doing.

Complementary, ticker-list-scope reads:

- `fetchNighthawkEchoForTickers()` — one batched query for a whole 0DTE ledger, so the
  board can annotate "Night Hawk already picked this name" without one round trip per row.
- `fetchHotTickers()` (`src/lib/bie/hot-tickers.ts`) — leaderboard of single-name tickers by
  flow premium over 6h, index/ETF/leveraged-ETP names excluded, for open-ended "what's hot"
  questions that don't name a ticker.
- `computeConfluenceOutcomeStats()` (`src/lib/bie/confluence-outcomes.ts`) — over the last 60
  days of graded 0DTE flags, does agreeing/disagreeing with a ticker's prior Night Hawk take
  actually correlate with a different hit rate (agree / disagree / no_echo buckets, each with
  sample size, hit rate, avg move — buckets under 10 samples flagged `insufficient_sample`)?
  A **Stage 6 precursor measurement only** — read-only, never feeds back into live scoring.
- Regime backdrop (`src/lib/bie/market-regime.ts` via the `get_market_regime` tool) — the
  same regime signal that already drives Night Hawk's gates, now answerable in chat.

All four of the above are wired into Largo as tools (`get_ecosystem_context`,
`get_hot_tickers`, `get_market_regime`, `get_confluence_outcomes`) so a member can ask about
any of this directly, and into `/api/admin/bie-report` so the admin dashboard shows the same
signals structurally.

## Platform self-awareness — Stages 2 through 5

Full rollout history and evidence: `docs/bie/FULL-SYSTEM-AWARENESS.md`. Current status:

- **Stage 1 — SHIPPED**: docs/knowledge ingestion, API usage telemetry.
- **Stage 2 — SHIPPED**: backend/frontend error capture (`error_events`), cron/worker health,
  API rate-limit visibility, DB query-failure capture (with double-count dedup fixed),
  duplicate-alert detection, missed-alert (cron-outage) detection. Zero new
  credentials — all of it reads tables this app already writes.
- **Stage 3 — SHIPPED** (needed, and got, real infra access): Railway deploy status,
  resource usage (CPU/mem), env-var presence, and runtime error snapshots via the Railway
  GraphQL API; Postgres connection-pool stats; a `pg_stat_statements` presence check
  (checked only, never enabled, per explicit instruction); Redis internals (memory, keys,
  clients, uptime); Clerk sign-in failure capture via a DOM-observed beacon
  (`AuthFailureObserver.tsx`) since Clerk exposes no webhook/API for failed sign-ins.
- **Stage 4 — SHIPPED**: `alert_audit_log`, one unified schema every alert type writes to
  (design: `docs/bie/AUDIT-TRAIL-SCHEMA.md`) — 0DTE, Night Hawk published, and Night Hawk
  rejected all write one row per event, deduped by insert-detection/unique indexes, queryable
  via `fetchAlertAuditTrail()` and rendered in the admin dashboard's Audit trail panel. (A
  same-night P0 was found and fixed here: a JSON-vs-Postgres-array serialization bug meant
  every insert had silently failed for hours before this was caught — see FINDINGS.md.)
- **Stage 5, step 1 — SHIPPED, deliberately narrow**: `findStage5Proposals()`
  (`src/lib/bie/stage5-proposals.ts`) does one mechanical, non-LLM-judgment check — does an
  exported component have zero references anywhere in `src/`? — and returns plain-text
  findings. **It never writes a file, never runs git, never calls the GitHub API, and never
  drafts a diff or opens a PR.** Stage 5's actual end state (BIE opening its own PRs) is
  explicitly not built and explicitly not authorized — this is step 1 of a multi-step path
  toward that, not the destination.

All of the above is surfaced live in one place: `GET /api/admin/bie-report` (admin-only)
computes every Layer-5 report on demand plus every Stage 2-5 probe, so "what is BIE seeing
right now" is one authenticated request, never a wait for a cron.

## Phase 1 (router/verifier/ledger — foundation the rest of this doc builds on)

1. **Router** — `classifyBieIntent` (pure, conservative: unsure → Claude) routes:
   today's-plays, ledger-ticker play state, SPX structure, market context. Composers
   assemble markdown from the same readers the dashboards use. Wired into BOTH
   `runLargoQuery` and `runLargoQueryStream` ahead of any Anthropic call; any router
   error falls through — Claude is never blocked. Answers carry
   `source: "blackout-intelligence"`, static follow-ups (no Haiku call), and persist
   into the session like any turn.
2. **Verifier** — captures every tool result Claude sees during a turn, extracts the
   answer's numeric claims (skipping years/counts), matches with 0.5% tolerance plus
   desk-taught derivations (2×/half for the +100%/−50% rules, %↔fraction), appends a
   caution when ≥4 claims and <50% traceable.
3. **Ledger** — `bie_interactions`: question, intent, answer_source (`bie-router` |
   `claude`), claim counts, latency. Router coverage %, verification rate, and cost
   avoided are queryable from day one.

## Metrics that define success (queryable, not vibes)

- Router coverage: % of Largo turns answered internally (target: grow 0 → 50 → 80%+ as
  intents are added; NEVER at the cost of a wrong route — a missed route costs one
  Claude call, a wrong route costs trust).
- Verification rate: % of Claude-answer figures traceable to turn data.
- Cost avoided: routed turns × avg Claude turn cost.
- Play calibration: 0DTE ledger hit-rate by score band / aggression / time-of-day →
  gate adjustments with evidence.

## Phase plan

- **Phase 2 — Knowledge: SHIPPED + ACTIVE** (VOYAGE_API_KEY provisioned
  2026-07-03). Ingestion (docs/, FINDINGS, AGENTS/CLAUDE, latest NH edition,
  generated platform map) runs daily, hash-deduped BEFORE embedding so unchanged
  content is free — and chunks stored cold before the key existed are backfilled;
  retrieval grounds the Claude fallback.
- **Phase 3 — Learning loops: SHIPPED.** Daily self-eval (router coverage, Claude
  calls avoided, verification rate, session W/L) + 14-day calibration harness
  (evidence-cited gate recommendations at n≥10 per bucket; report-first) + the router
  eval set living in CI (`bie.test.ts` — no route change ships without it passing).
- **Phase 4 — Platform intelligence + distillation:** platform-map ingestion and the
  daily telemetry discovery report (slowest/most-failing/most-expensive call
  patterns) are SHIPPED, now folded into Stages 2-5 above. Remaining Phase-4 items are
  DATA-GATED by design: knowledge Q&A router intents (needs the embeddings key +
  corpus, both now live, but not yet built as router intents), and optional
  small-model distillation (needs months of graded interactions + a buy decision).
- **Stage 6 (not started, not authorized):** using outcome data (e.g. confluence
  outcomes above) to actually calibrate or adjust live scoring. Explicitly a separate
  decision from everything shipped so far — every Stage 6 precursor measurement built
  to date is read-only and reports numbers, it does not act on them.

## Purchases / external dependencies (honest list)

| Item | Needed for | Cost ballpark | When |
|---|---|---|---|
| Embeddings API key (Voyage AI `voyage-3`) | Phase 2 retrieval | ~$0.06 / M tokens — trivial (est. <$1/mo at our corpus size) | **PROVISIONED 2026-07-03** (`VOYAGE_API_KEY` on Railway) |
| ~~pgvector extension~~ | ~~Phase 2 store~~ | not needed — shipped with portable JSONB embeddings + cosine in Node (corpus is thousands of chunks, not millions) | — |
| Open-weight inference host (Together/Fireworks per-token, or GPU rental) | Phase 4 distillation ONLY | $0 until used | Deferred — decide with data |
| New market-data APIs | — | none needed: Polygon + UW + Benzinga cover the domain | — |

Claude (existing) remains the paid general-reasoning fallback; its usage shrinks as
router coverage grows — that is the dependency-reduction curve, delivered safely.
