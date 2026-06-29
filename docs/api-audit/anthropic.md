# Anthropic API Audit
Last updated: 2026-06-29 (automated)

> Scope: every code path that calls the Anthropic Messages API, compared against
> published feature/pricing docs. Pricing per the cached Anthropic model table
> (2026-06-04): Sonnet 4.6 `$3/$15` per MTok, Haiku 4.5 `$1/$5` per MTok, cache
> read `~0.1×` input, cache write (5m) `~1.25×` input, Batches `−50%`.
>
> **Dollar figures below are illustrative** — they combine published per-token
> pricing with **assumed** call volumes (flagged inline). They are NOT measured
> spend. The live, authoritative per-day total is the cross-replica Redis ledger
> (`aiSpendKey()` in `ai-spend-ledger.ts`); read that for ground truth before
> acting on any number here. Cross-ref: task #103 (prompt caching across surfaces).

## Summary
- **API surfaces using Anthropic: 9** (all routed through one provider:
  `src/lib/providers/anthropic.ts`).
- **Cost-reduction features available: 3** (prompt caching, Message Batches,
  model selection) — **using 2** (prompt caching *partially*; model selection
  *well*). Message Batches: **unused**.
- **Quality features available: 2** (adaptive thinking, extended thinking) —
  **using 0**.
- **Estimated monthly savings if the two real gaps close: ~$15–$60/mo** at
  current (modest) volume, dominated by extending prompt caching to the
  high-frequency SPX-play gate. This is small in absolute terms because the
  codebase is *already* well-disciplined: no Opus/Fable anywhere, Haiku on the
  hot commentary path, caching already live on Largo, a spend ledger + kill
  switch already in place. The headline opportunity is **operational
  (cache hit-rate on the SPX gate)**, not a model-tier overpay.

## What's already done well (don't "fix" these)
- **No premium models.** Every surface is Sonnet 4.6 or Haiku 4.5. No
  `claude-opus-*` / `claude-fable-*` call sites exist. (`PRICES` in
  [ai-spend.ts](../../src/lib/ai-spend.ts) lists Opus/Fable only for accurate
  accounting if `ANTHROPIC_MODEL` is ever overridden.)
- **Prompt caching is implemented** — `applySystemCache()` in
  [anthropic.ts:177](../../src/lib/providers/anthropic.ts) auto-arms
  `cache_control:{type:'ephemeral'}` on the system block above a ~16K-char floor,
  with an explicit `cacheSystem:true` opt-in. Largo uses it
  ([largo-terminal.ts:178,243](../../src/lib/largo-terminal.ts)).
- **Streaming** is used on the Largo tool loop (`client.messages.stream` +
  `finalMessage()`, [anthropic.ts:494](../../src/lib/providers/anthropic.ts)).
- **Tool use** is used (Largo, `anthropicToolLoop`), with per-tool-result size
  caps (`MAX_TOOL_RESULT_CHARS`) to avoid prompt-too-long 400s.
- **Spend accounting** — per-call cost is estimated from `usage` and written to a
  cross-replica Redis ledger with a threshold alert and an opt-in hard kill
  switch ([anthropic.ts:319](../../src/lib/providers/anthropic.ts)). This is the
  better-than-token-counting approach (see Token Counting below).
- **Sampling-param guard** — `modelRejectsSamplingParams()` strips `temperature`
  for Opus 4.7+/Fable so an `ANTHROPIC_MODEL` override can't 400 every call.

## Model Usage
| Surface | File | Current Model | Recommended | Reason |
|---|---|---|---|---|
| Largo AI chat (tool loop) | [largo-terminal.ts](../../src/lib/largo-terminal.ts) | Sonnet 4.6 | **Keep** | Reasoning + tool use; Haiku would degrade synthesis quality. |
| SPX desk commentary | [spx-commentary.ts](../../src/lib/providers/spx-commentary.ts) | Haiku 4.5 | **Keep** | High-frequency, every RTH cycle; Haiku is the right cost tier. |
| SPX play gate (verdict) | [spx-play-claude.ts](../../src/lib/spx-play-claude.ts) | Sonnet 4.6 (default) | **Keep model; add caching** | Schema-constrained verdict; high volume — caching matters more than tier here (see Gap #1). |
| Night Hawk edition synthesis | [claude-edition.ts:159](../../src/lib/nighthawk/claude-edition.ts) | Sonnet 4.6 | **Keep** | 4,500-token structured JSON over a big prompt; quality-sensitive. |
| Night Hawk play critic | [play-critic.ts:101](../../src/lib/nighthawk/play-critic.ts) | Sonnet 4.6 | **Keep** | Quality-review pass; one call per cron. |
| Night Hawk play explainer | [play-explainer.ts:147](../../src/lib/nighthawk/play-explainer.ts) | Sonnet 4.6 | Consider Haiku 4.5 | On-demand prose explanation; lower-stakes. Test for quality regression first. |
| GEX heatmap explain | [gex-heatmap/explain/route.ts:295](../../src/app/api/market/gex-heatmap/explain/route.ts) | Sonnet 4.6 | Consider Haiku 4.5 | 600-token narrative; Haiku likely sufficient. Test first. |
| Flow brief | [flow-brief/route.ts:158](../../src/app/api/market/flow-brief/route.ts) | Sonnet 4.6 | Consider Haiku 4.5 | Short brief; Haiku candidate. Test first. |
| Night's Watch position narrative | [position-narrative.ts:152](../../src/lib/nights-watch/position-narrative.ts) | Sonnet 4.6 (`LARGO_MODEL`) | Consider Haiku 4.5 | Per-position prose; Haiku candidate. Test first. |

All models resolve through `resolveModel()` → `DEFAULT_MODEL = "claude-sonnet-4-6"`
unless `ANTHROPIC_MODEL` overrides. The three "consider Haiku" rows are the only
plausible tier downgrades, and each is a **quality judgment call** — do not flip
them blind; A/B a sample first. Potential saving is ~3× on those surfaces' tokens
(Sonnet→Haiku is `$3/$15` → `$1/$5`), but they are low-volume, so absolute
dollars are small.

## Feature Coverage
| Feature | Status | File:Line | Estimated Savings |
|---|---|---|---|
| Prompt Caching | **Partial** — Largo only | [anthropic.ts:177](../../src/lib/providers/anthropic.ts); callers at [largo-terminal.ts:178,243](../../src/lib/largo-terminal.ts) | Extending to the SPX-play gate is the single largest lever (Gap #1). |
| Message Batches | **Unused** | — | −50% on Night Hawk's 2 cron calls/run (Gap #2); modest, async only. |
| Token Counting | **Unused (intentional)** | post-hoc `estimateCostUsd()` in [ai-spend.ts:47](../../src/lib/ai-spend.ts) | $0 — pre-flight counting adds an API round-trip; post-hoc `usage` accounting is correct and cheaper. No action. |
| Streaming | **Used** | [anthropic.ts:494](../../src/lib/providers/anthropic.ts) (Largo) | Latency/UX, not cost. |
| Tool Use | **Used** | [anthropic.ts:418](../../src/lib/providers/anthropic.ts) (Largo) | n/a |
| Adaptive / Extended Thinking | **Unused** | — | Quality lever, not cost (Gap #3). |

## Cost Reduction Opportunities (ranked by leverage)

### 1. Extend prompt caching to the SPX-play gate (and other repeated-prompt surfaces) — HIGHEST LEVERAGE
[spx-play-claude.ts:308](../../src/lib/spx-play-claude.ts) calls
`anthropicText(prompt, 500, undefined, …)` — **`system` is `undefined`**, so the
schema + instruction preamble lives inside the volatile `user` prompt and **is
never cached**. Per project memory this gate fires very frequently during RTH
(hundreds of heartbeat ticks/day, ~24 cached APPROVE_BUY today). Each tick re-pays
full input price for the *same* instruction/schema prefix.

**Fix:** split the prompt — move the stable schema + rubric + instructions into a
`system` block and pass `cacheSystem:true`; keep only the live levels/flow/news in
the `user` message. Within any 5-minute window the stable prefix bills at `~0.1×`
instead of `1×`.

- **Pre-req:** the stable system block must be **≥2,048 tokens** (Sonnet's minimum
  cacheable prefix) and **byte-identical** every tick — no timestamps/UUIDs in it.
  If the current preamble is smaller than 2,048 tokens, caching silently no-ops
  (and costs a tiny write premium); measure with `count_tokens` once before
  committing.
- **Illustrative saving (ASSUMED volume — verify against the ledger):** if the
  gate runs ~400×/RTH day with a ~2,500-token stable prefix at Sonnet input
  (`$3`/MTok), the prefix alone is `400 × 2,500 × $3/1e6 ≈ $3.00/day` uncached.
  With ~90% of those served from a warm 5-min cache, the prefix cost drops to
  `~$0.35/day` → **~$2.65/day ≈ $55/mo** saved on this surface alone. (Output and
  volatile-input tokens are unchanged.) This dominates every other line item.
- **Apply the same pattern** to any surface that re-sends a large stable
  preamble on a repeating cadence — chiefly **SPX commentary** (every RTH cycle,
  `system:undefined` today at [spx-commentary.ts:578](../../src/lib/providers/spx-commentary.ts))
  and **GEX explain**. Same caveat: only wins if the stable prefix clears the
  model's min-cacheable-prefix floor (Haiku = 4,096 tokens; Sonnet = 2,048).

### 2. Move Night Hawk cron generations to the Message Batches API — MODEST, LOW-RISK
Night Hawk runs twice daily on a cron (5:30pm / 4:30pm ET, not latency-sensitive)
and makes **two** large Sonnet calls per run: edition synthesis (4,500 out tokens,
[claude-edition.ts:159](../../src/lib/nighthawk/claude-edition.ts)) + critic (3,000
out tokens, [play-critic.ts:101](../../src/lib/nighthawk/play-critic.ts)). Batches
give a flat **−50%** on all token usage; most batches finish well under an hour,
which the evening cron can absorb.

- **Caveat — this is the *one* place the batch model fits, and it fits weakly:**
  Batches shine on *many independent* requests; Night Hawk is only 2 sequential
  calls (critic depends on synthesis output, so they can't even be batched
  together — it'd be two batches of one, or a batch of one for synthesis only).
  The 50% is real but the engineering (submit → poll → retrieve, plus restructuring
  the cron to tolerate async) may exceed the saving at current volume.
- **Illustrative saving (ASSUMED volume):** synthesis+critic ≈ (large input +
  7,500 out) Sonnet tokens × 2 runs/day. Even at a generous ~$0.15/run, −50% is
  **~$0.15/day ≈ $4–5/mo**. **Recommendation: defer** unless a future fan-out
  (e.g. per-ticker dossiers via Claude, or multi-edition generation) creates a
  genuine bulk workload — *then* Batches becomes compelling.

### 3. (Not a saving) Token Counting API — leave unused
The code estimates cost from the response `usage` block post-hoc
([ai-spend.ts:47](../../src/lib/ai-spend.ts)). A pre-flight `count_tokens` call
would add a network round-trip per request for no cost benefit (you still pay for
the real call). The current approach is correct. **No action.**

## Quality Improvement Opportunities (output, not cost)
- **Adaptive thinking** (`thinking:{type:"adaptive"}`, Sonnet 4.6 supports it) is
  **unused**. It could improve the hardest reasoning surfaces — Largo tool loop
  and the Night Hawk critic — by letting the model think before committing. It
  *adds* token cost (thinking tokens bill as output), so it's a quality/cost
  trade, not a saving. Worth an A/B on Largo answer quality; leave the
  high-frequency/low-stakes surfaces (commentary, SPX gate verdict) on the
  current no-thinking path.
- The provider does not currently expose a `thinking` param at all
  ([anthropic.ts](../../src/lib/providers/anthropic.ts)); adding it would be a
  small, additive change to `anthropicText`/`anthropicToolLoop` options.

## Implementation Recommendations (concrete)
1. **SPX-play gate caching** ([spx-play-claude.ts:~280–308](../../src/lib/spx-play-claude.ts)):
   refactor the prompt into `(stableSystem, volatileUser)`; call
   `anthropicText(volatileUser, 500, stableSystem, { cacheSystem:true, temperature:0, … })`.
   First verify `stableSystem` is ≥2,048 Sonnet tokens (`messages.count_tokens`
   one-off) and contains **no per-tick volatile text**. Confirm hits via
   `usage.cache_read_input_tokens > 0` in telemetry after deploy.
2. **SPX commentary + GEX explain caching**: same split. Pass `system` (currently
   `undefined`) as the stable preamble with `cacheSystem:true`. Only ship if the
   preamble clears the model's min-cacheable floor.
3. **Optional Haiku downgrades** (GEX explain, flow brief, NW narrative, NH
   explainer): A/B each against Sonnet on a saved sample; flip only the ones that
   hold quality. Low absolute dollars — do these only if free engineering time.
4. **Defer Message Batches** until a genuine bulk Claude workload exists; revisit
   if per-ticker Claude fan-out is added to Night Hawk.
5. **Optional adaptive thinking** on Largo: add a `thinking` passthrough to
   `anthropicToolLoop` and A/B answer quality vs. token cost.

## Honest caveats
- Every dollar figure assumes call volumes that are **not measured here**. Before
  prioritizing, pull real per-surface token totals from the spend ledger / API
  telemetry. The *ranking* (caching ≫ batches) is robust regardless of exact
  volume; the absolute dollars are not.
- The codebase is already near the cost-efficient frontier for its model choices.
  The remaining wins are operational (cache hit-rate), not architectural
  (no model-tier overpay to unwind).
