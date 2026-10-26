## Ask Largo swing play-brief: "Flow & positioning" collapse dropped all notable prints and 3 of 4 anomalies for OPEN/WATCH briefs, and Largo's own tool had no way to request the uncollapsed read — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Found by** | Live-production audit, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-26 |
| **Scope** | `src/lib/swing/play-brief-narrative.ts` (`flowNarrative`), `src/lib/largo/tool-defs.ts` (`get_swing_play_brief` schema), `src/lib/largo/run-tool.ts` (dispatch), `src/lib/largo/swing-play-brief-read.ts` (`swingPlayBriefForLargo`) |

### Root cause

`composeSwingPlayBrief` (`play-brief.ts`) collapses several intel sections into the "Trade manager
read" narrative for OPEN/WATCH buckets (`collapseRedundantIntelSections`,
`play-brief-intel-collapse.ts` — `NARRATIVE_COVERED_TITLES` includes `"Flow & positioning"`;
collapse is skipped only for `bucket === "closed"`). The full `flowIntelSection`
(`play-brief-intel.ts:1410-1517`) renders up to 4 deduped flow anomalies ("**Flow anomalies:**")
and up to 5 itemized notable prints with strike/right/premium/age ("**Notable prints (48h, largest
premium first):**"). The collapsed replacement, `flowNarrative` (`play-brief-narrative.ts:541-571`),
rendered only the one-line HELIX tape aggregate plus **at most the single first anomaly**
(`ctx.ecosystem?.recent_anomalies?.[0]`) — anomalies 2-4 were silently dropped, and zero notable
prints ever reached the collapsed narrative, even though `collapseRedundantIntelSections`'s own
auto-generated note tells the reader the content was "folded into Trade manager read above."

This is the same bug class FINDINGS.md's "VEX/DEX/CHARM content silently dropped for OPEN/WATCH
swing briefs" entry already fixed once for `dealerPostureLine`/"GEX posture" — a collapse-note
claim that was false for specific fields the narrative bullet never actually carried. This finding
is the same shape for "Flow & positioning"'s notable-prints/multi-anomaly content, which that
earlier fix did not touch.

Separately, Largo's own `get_swing_play_brief` tool had no mechanism to request the uncollapsed
read at all: its input schema took only `ticker`/`positionId`/`strike`/`right`/`status` (no
`expandIntel`), `swingPlayBriefForLargo` always called `composeSwingPlayBrief(ctx)` with no second
argument, so `opts?.expandIntel` was unconditionally `undefined` and `collapseIntel` was
unconditionally forced `true` (`play-brief.ts:2151`, `{ collapseIntel: !opts?.expandIntel }`). The
Command Deck UI's own "Show detail" toggle flips `?expandIntel=1` directly on the HTTP route
(`src/app/api/market/swing/play-brief/route.ts`) — a mechanism the tool-calling surface structurally
could not reach, so every chat-surfaced Largo answer was permanently stuck on the collapsed read's
own "expand via follow-up chips or Open Largo" note with no way to actually act on it.

### Evidence

Live-verified this session: `GET /api/market/swing/play-brief?playId=SWING:ASTS&ticker=ASTS&positionId=2111&status=COMMIT`
(the default call, exactly what Largo's tool uses) returned a Trade-manager bullet with just the
aggregate line + 1 anomaly, while the SAME instant's `...&expandIntel=1` call showed the full
section: 3 real prints (CALL 105.00 $518K [21m ago], PUT 22.50 $296K [11m ago], PUT 45.00 $254K
[4h ago]) and more anomaly detail. This reproduced across 7 real OPEN positions (PANW, CRML, FLY,
OUST, RDW, ASTS, FTNT) — all showed the same "aggregate + at most 1 anomaly, zero notable prints"
shape when collapsed, while 5 real CLOSED briefs (which bypass collapse) showed the full itemized
lists.

### Blast radius

Single call site for part 1 — `flowNarrative`'s return string, the only "Flow & positioning"
content surviving collapse for OPEN/WATCH. No other section or consumer reads
`recent_anomalies`/`flow_full_state.recent` for the collapsed narrative; `flowIntelSection` itself
(the CLOSED-bucket / narrative-absent path) is untouched. For part 2, the new `expandIntel`
parameter is additive and optional everywhere it threads (`tool-defs.ts` schema,
`run-tool.ts` dispatch, `SwingPlayBriefLargoHints`) — every existing call site that never set it
(the Command Deck UI goes through its own HTTP route, unaffected; the cross-product fan-out in
`cross-product-read.ts` calls `get_swing_play_brief` with `{ ticker: t }` only) keeps defaulting to
the collapsed read exactly as before.

### Fix

1. Extended `flowNarrative` to append ALL deduped anomalies (same `(anomaly_type, detail)` dedup as
   `flowIntelSection`, capped at 4 — the market-regime-detector cron only dedups within a 15-minute
   window at write time, so a persisting pattern can write a second byte-identical row) and the top
   3 notable prints from `ctx.ecosystem?.flow_full_state?.recent` (same `fmtPremium`/
   `relativeAgeLabel`/`fmtPriceLevel` strike-rounding helpers `flowIntelSection` uses, same
   ordering/caption — "(48h, largest premium first)" — so the two can never drift into reporting
   different facts off the identical underlying data). No separate `flow_feed_fresh` gate was
   needed: `flow` (the HELIX tape aggregate) is already `trustedHelixFlow(ctx.ecosystem)`, which
   returns `null` whenever the feed is stale, so reaching this code already proves freshness.
2. Added an optional `expandIntel: boolean` property to `get_swing_play_brief`'s tool schema
   (`tool-defs.ts`), threaded it through `run-tool.ts`'s dispatch into
   `SwingPlayBriefLargoHints.expandIntel` (`swing-play-brief-read.ts`), and into
   `composeSwingPlayBrief(ctx, { expandIntel: hints?.expandIntel ?? false })` — the same option the
   HTTP route's `?expandIntel=1` already threads, now reachable from Largo's own tool-calling
   surface for the first time. Updated the tool's description to document the collapse behavior and
   the new parameter.

### Fix rationale

Mirrors the VEX/DEX/CHARM fix's own rationale: special-casing `collapseRedundantIntelSections` to
keep "Flow & positioning" rendered whenever it carries anomalies/prints would leave the "folded
into Trade manager read" note literally false in the kept-but-partial case and complicate the
collapse function's single title-match rule. Threading the content into the narrative itself makes
the existing claim true instead of carving an exception to it. For the tool parameter, reusing the
existing `composeSwingPlayBrief`/`ComposeSwingPlayBriefOptions.expandIntel` plumbing (already built
and used by the HTTP route) rather than inventing a second mechanism keeps the chat-answer and
Command-Deck-panel reads identical through identical logic, per this file's existing pipeline
discipline.

### Regression test

- `src/lib/swing/play-brief-narrative.test.ts` gained 2 tests: one proving all 3 fixture anomalies
  and 2 itemized notable prints now appear in the collapsed narrative body (live-repro shape); one
  proving a persisting anomaly rewritten across two cron cycles still dedupes to one occurrence
  (mirrors `flowIntelSection`'s own existing dedup test).
- `src/lib/largo/swing-play-brief-read.test.ts` gained 2 tests: `expandIntel: true` forwards
  `{ expandIntel: true }` to `composeSwingPlayBrief`'s options; omitting it forwards
  `{ expandIntel: false }` (the default stays the collapsed read).
- `src/lib/largo/tool-defs.test.ts` gained 1 test: `get_swing_play_brief`'s schema declares an
  optional `expandIntel` boolean property.

### Verification

- RED→GREEN proof: reverted the 4 implementation files (`play-brief-narrative.ts`, `tool-defs.ts`,
  `run-tool.ts`, `swing-play-brief-read.ts`) to their pre-fix state with the new tests left in
  place — exactly 4 of 221 tests failed (the 3 new positive-content/plumbing assertions plus the
  tool-defs schema assertion; the dedup test passed vacuously either way, as expected for a
  dedup-only guard, same as the sibling VEX/DEX/CHARM fix's own staleness-suppression test).
  Restoring the fix brought all 221 back to green.
- `node --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts
  src/lib/largo/swing-play-brief-read.test.ts src/lib/largo/tool-defs.test.ts` (Node 20) —
  221/221 pass, 0 fail.
- `node --experimental-test-module-mocks --test src/lib/largo/run-tool.test.ts` (Node 20) —
  14/14 pass (dispatch change unaffected other tool cases).
- Full `npm test` (Node 20) — pass, 0 fail (see PR for exact count).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
