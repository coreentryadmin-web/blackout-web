> **kind:** FINDING

## Night Hawk Legacy — desk playbook (regime strategy line) computed but never guaranteed to reach members — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `market-regime-detector`'s `deriveComposite()` (`derive-composite.ts`) already
computes an authored, human-readable strategy sentence per regime (e.g. "Dealers short gamma —
moves amplify. Trend up with breakout risk; calls favored; ride momentum, avoid fades.") and pins
it as `PlatformIntelSnapshot.playbook`. That value was already read in two places: (1)
`formatPlatformIntelForPrompt()` feeds it to the Claude edition-authoring prompt as advisory
context, so the LLM *may* choose to paraphrase or mention it in the freeform recap/play prose, and
(2) `publish_context.regime.composite_regime` (the raw enum, not the sentence) is pinned per play
for internal tooling (Discord trade notify, this session's own `posture-backtest.ts`). Neither path
guarantees the playbook sentence reaches the member-facing edition deterministically — it depends
entirely on LLM discretion, and there was no structured field carrying it at all.

**Evidence.** Traced `GET /api/market/nighthawk/edition`'s full response shape
(`NightHawkEdition`/`market_recap`) and `buildMarketRecap()` (`format.ts`): `tide`/`spx_vix` are
already deterministic member-facing prose fields (confirmed via `format.test.ts`'s existing
double-period regression tests), rendered by `PlaybookBoard.tsx`'s `MarketContextGrid` via
`marketContextItems()`. `composite_regime`/`playbook` were absent from both `buildMarketRecap`'s
return type and `marketContextItems`'s field list — confirmed by reading every call site
(`grep -rn "composite_regime\|platform_intel"` across `format.ts`/`edition-builder.ts`).

**Blast radius.** Three files, all additive: `format.ts` (`buildMarketRecap` gains a
`desk_playbook: string` field, `""` when `platform_intel`/`playbook` is unavailable — same
"only non-empty strings render" convention as every other field here), `edition-builder.ts` (both
`market_recap` construction sites — the normal-publish path and the recap-only/zero-plays path —
now forward `recap.desk_playbook`), `PlaybookBoard.tsx` (`marketContextItems` renders it as a new
"Desk Playbook" wide row in the existing Market Context grid, right after Tide/SPX·VIX). No gate,
scoring, ranking, or live-picks logic touched — pure recap enrichment.

**Fix rationale.** Minimal and additive: reuses an existing, already-computed, already-authored
string (no new capture, no new LLM call, no new DB read) and slots into the exact
label:value grid pattern `MarketContextGrid` already uses for `tide`/`spx_vix`/`sector_strength`/
`catalysts`. Chose NOT to touch `composite_regime`'s raw enum (`AMPLIFY_BREAKOUT` etc.) — that's
an internal code, not member-facing prose; `playbook` is the field specifically authored to be
read by a human. Left `formatPlatformIntelForPrompt`'s existing LLM-context path unchanged (still
useful advisory context for the narrative-generation prompt) — this fix makes the sentence
*additionally* guaranteed-visible, not a replacement for that path.

**Sample size / evidence.** 4 new unit tests: 2 in `format.test.ts` (desk_playbook sourced from
`platform_intel.playbook`; empty string, never null, when platform_intel is unavailable), 2 in
`PlaybookBoard.test.ts` (renders as a wide "Desk Playbook" row when present; omitted when
empty/absent — never fabricated). `npx tsc --noEmit` clean. Full `npm test`: 14862/14862 passing,
0 regressions.

**Next action.** None required — purely additive UI/data enrichment, safe to ship without a
follow-up measurement. Originated from Task #31 (Ask Largo × Night Hawk Legacy standing mandate,
"bring in your ideas" directive) during a quiet Friday-post-close/weekend audit window.
