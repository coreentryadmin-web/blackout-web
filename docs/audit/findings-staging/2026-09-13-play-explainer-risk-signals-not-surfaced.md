> **kind:** FINDING

## Night Hawk Legacy — "Full Hawk Intel" play briefing silently dropped `earnings_risk` and `gate_promoted`/`gate_warnings` from its own required "Risks & invalidation" section — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (enhancement/completeness, not a grading or member-money-facing bug) |
| **Lane** | Night Hawk Legacy |
| **Found** | 2026-09-13, aggressive improvement-hunting sweep per the standing v3 mandate ("a signal that exists but isn't surfaced") |

### What was broken

`PlaybookPlay` (`src/features/nighthawk/lib/types.ts`) carries several real, already-computed
risk/quality signals on every published play — `earnings_risk` (true when the name reports
earnings inside the play's hold window, set by `scorer.ts`), `gate_promoted` +
`gate_warnings` (true when the evening pipeline could not fully clear its publish-time sanity
gates and surfaced the play anyway rather than publish an empty edition — set by
`edition-builder.ts`/`deterministic-edition.ts`/`publish-gates.ts`/`play-backfill.ts`), plus
`sector`, `rr_ratio`, `target_atr_multiple`, `confirming_signals`, and `exit_style`.

Two consumers of the full `PlaybookPlay` object never read most of these fields:

1. **`play-explainer.ts`'s `generatePlayExplanation`** — the on-demand "Full Hawk Intel" deep-dive
   a member requests to understand why a play made the top 5. Its own system prompt promises a
   **`**Risks & invalidation**`** section and instructs the model to "cover every dimension present
   in the data" — but `formatPlayBlock` (the function that builds the data block fed to the LLM)
   never included `earnings_risk`, `gate_promoted`, or `gate_warnings` at all, so the model
   structurally could not report on them even when they were true for the play being explained.
   The grounding guard (`checkNumbersGrounded`) would have actively blocked the model from
   mentioning them even if it somehow inferred them from context, since they weren't in `known`.

2. **`play-explainer-fallback.ts`'s `buildGroundedPlayExplanationFallback`** — the deterministic,
   no-LLM fallback used whenever `anthropicConfigured()` is false, generation times out, or the
   grounding guard rejects the LLM's output. Its "Risks & invalidation" section rendered ONLY
   `risk_note` (free-text prose), with zero LLM and zero grounding-guard involved — so this is the
   more clear-cut instance: the data was sitting right there on the object and simply never printed.

Net effect: a member who explicitly asks "why did this make the list, and what are the risks"
could get a briefing whose Risks section is silent about (a) an upcoming earnings print inside the
hold window, or (b) the play having been rescued into the edition specifically because it failed
the evening's own quality gates — arguably the two single most decision-relevant risk facts the
system had already computed about that play.

### Evidence

Traced the full pipeline: `scorer.ts:1253` sets `earnings_risk` on every scored candidate;
`publish-context.ts:262`, `play-outcomes.ts:323`, `play-backfill.ts:84`, and
`deterministic-edition.ts:786/1113` all persist it onto the published `PlaybookPlay`.
`publish-gates.ts:454-455`, `deterministic-edition.ts:1114-1115`, `edition-builder.ts:951-952`, and
`play-backfill.ts:168-169` set `gate_promoted`/`gate_warnings` for real rescue-mode plays. Confirmed
`src/app/api/market/nighthawk/play-explain/route.ts` passes the FULL published `play` object
(straight off `row.plays`) into `generatePlayExplanation` — the fields exist at call time, they were
just never read by `formatPlayBlock`.

RED→GREEN: added tests asserting `playRiskLines` and the fallback surface `earnings_risk` and
`gate_promoted`/`gate_warnings` when present; confirmed they fail against the pre-fix code (5/8 new
subtests red — `playRiskLines` didn't exist, the fallback text dropped the new signals) and pass
after the fix (8/8 green). Full suite (Node 20): 14094/14094 pass, 0 fail, 3 skipped. `npx tsc
--noEmit`: clean.

### Fix

Added `playRiskLines(play)` to `play-explainer-fallback.ts` — a small shared helper building the
risk-line list (risk_note, then an earnings-risk line, then a gate-promotion line plus every
`gate_warnings` entry) from real play fields only. Both `buildGroundedPlayExplanationFallback` and
`play-explainer.ts`'s `formatPlayBlock` now call it, so the LLM path and the no-LLM fallback path
can never disagree about which real risk signals exist on a given play. `formatPlayBlock` also now
includes `sector`, `rr_ratio`, `target_atr_multiple`, `confirming_signals`, and `exit_style` when
present — all real, already-computed fields relevant to the briefing's own "Market & sector
context" and "Entry · target · stop logic" sections that were previously invisible to the model.

### Fix rationale — why this, not something else

- **Additive only, strengthens grounding rather than loosening it.** These are real facts already
  computed elsewhere in the pipeline and trusted for other surfaces (the terminal UI, the publish
  gates themselves) — adding them to the data block only gives the grounding guard MORE real
  numbers to accept, never fewer. No change to the grounding-guard logic itself.
- **Shared helper, not duplicated logic.** `playRiskLines` lives in the fallback module (the
  simpler, LLM-free consumer) and is imported by the LLM path, so there is exactly one place that
  decides what counts as a "real risk signal on this play" — avoids the two call sites silently
  drifting apart the way `flow-polarity`/`bearish-posture`-style dead-field bugs have shipped
  before in this lane.
- **Left `factor_breakdown` and `tier`/`morning_checked_at` out of scope.** `factor_breakdown` is a
  raw per-component score dict better suited to a future structured rendering than free text jammed
  into a data block; `tier`/`morning_checked_at` are read-time overlays not always present on the
  object this function receives (`row.plays` is the as-published array, tier is merged separately
  in some paths) — pulling those in cleanly is a larger, separately-scoped follow-up, not bundled
  into this fix.

### Blast radius

Two call sites, both covered: `play-explainer.ts` (LLM data block) and
`play-explainer-fallback.ts` (deterministic fallback, used directly by `play-explainer.ts` on
timeout/failure AND by the no-Anthropic-configured path). No other module reads `formatPlayBlock`
or `buildGroundedPlayExplanationFallback`. No schema/API response shape changed — this only changes
the text fed to/generated for the `explanation` string members already receive from
`POST /api/market/nighthawk/play-explain`.
