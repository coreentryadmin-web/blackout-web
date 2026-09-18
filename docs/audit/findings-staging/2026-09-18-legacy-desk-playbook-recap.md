> **kind:** FINDING

## Night Hawk Legacy — desk playbook (regime strategy line) computed but never exposed on the wire — FIXED (data layer only; live-UI wiring is a separate follow-up)

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
guaranteed the playbook sentence reached the API response deterministically, and there was no
structured field carrying it at all.

**Self-correction made during this same PR (recorded rather than silently fixed) — read before
trusting the "member-facing" framing of the first commit on this branch.** The first commit here
also added a "Desk Playbook" row to `PlaybookBoard.tsx`'s `MarketContextGrid`, believing that was
the live Legacy board. It is not: `PlaybookBoard.tsx`'s own header comment says so explicitly
("this component ... is DEAD CODE as of the tab-based NightHawkFeed rewrite — the live Legacy tab
(view=LEGACY) renders `LegacyPickLogBoard`, not `PlaybookBoard`") and a repo-wide grep for
`PlaybookBoard` usage confirms it: only re-exported from `features/nighthawk/index.ts`, never
rendered from any route. Worse, further tracing showed the REAL live component
(`LegacyPickLogBoard.tsx` → `LegacyMacroStrip.tsx`) doesn't read `market_recap` **at all** — its
`regime`/`gexBias` fields come from a completely different, morning-only pipeline
(`nighthawk-morning-confirm` cron → `GET /api/platform/intel` → `LegacyMacroContext`), populated
only after the next session's pre-market confirm job runs, not from the evening edition publish
this fix touches. Correctly wiring `desk_playbook` into the ACTUAL live board would mean adding
`playbook` to `/api/platform/intel`'s response and threading it through
`nighthawk-morning-confirm/route.ts` → `LegacyMacroContext` → `LegacyMacroStrip.tsx` — a materially
different, larger, cross-pipeline change than this PR, and one that touches the live board's
render path (the kind of change the standing escalation policy says needs its own careful scoping,
not a same-cycle addition on top of an already-wrong premise). The `PlaybookBoard.tsx` UI change
and its 2 tests were reverted in this PR's second commit rather than left in place — shipping a UI
change to confirmed-dead code would be actively misleading in the diff.

**What actually shipped.** Only the data-layer piece: `buildMarketRecap()` (`format.ts`) now
returns `desk_playbook: string` (empty string, never null, when `platform_intel`/`playbook` is
unavailable), forwarded through both `market_recap` construction sites in `edition-builder.ts`
(normal-publish path and recap-only/zero-plays path). This makes the sentence available on
`GET /api/market/nighthawk/edition`'s `market_recap.desk_playbook` for any consumer of that
endpoint (Largo, admin tooling, a future correctly-scoped frontend change) — genuinely useful,
zero new capture, zero behavior change — but it is **not**, by itself, visible to a Legacy member
in the live product yet.

**Blast radius.** Two files: `format.ts`, `edition-builder.ts`. No gate, scoring, ranking, or
live-picks logic touched.

**Fix rationale.** Ship the honest, correctly-scoped, low-risk half now (the data field — safe,
tested, additive) rather than block it on the larger cross-pipeline UI change, which is logged
separately below as the real remaining work.

**Sample size / evidence.** 2 unit tests in `format.test.ts` (desk_playbook sourced from
`platform_intel.playbook`; empty string, never null, when platform_intel is unavailable).
`npx tsc --noEmit` clean. Full `npm test`: 14860/14860 passing, 0 regressions (2 fewer than the
first commit's 14862, from reverting the dead-code UI tests).

**Next action.** Task #32 opened: correctly wire `playbook` into the LIVE Legacy macro strip via
`/api/platform/intel` → `nighthawk-morning-confirm` → `LegacyMacroContext` → `LegacyMacroStrip.tsx`
— a separate, properly-scoped PR, not rushed into this one. Originated from Task #31 (Ask Largo ×
Night Hawk Legacy standing mandate, "bring in your ideas" directive) during a quiet Friday-post-
close/weekend audit window; corrected same-session before merge once the dead-code premise was
caught.
