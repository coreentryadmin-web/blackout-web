## 2026-09-16 — [FINDING, FIXED] Legacy play-explainer's required "Why ranked #N" section never received the real, already-computed score-component breakdown

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (product-quality/enhancement, not a correctness defect — no wrong data shown, just a real signal left out of a narrative section that promises to cover it) |
| **Lane** | Night Hawk Legacy |
| **Files** | `src/features/nighthawk/lib/play-explainer.ts`, `src/features/nighthawk/lib/play-explainer-fallback.ts`, `src/features/nighthawk/lib/play-explainer.test.ts` |
| **PR** | (see PR link in commit trailer) |

### Root cause

`play-explainer.ts`'s system prompt requires a **"Why ranked #N"** section, and further instructs
the model to "Cover every dimension present in the data" across Options flow, Positioning/GEX,
Technicals, News. `PlaybookPlay.factor_breakdown` exists precisely to answer this: it is a real,
already-computed per-component composite-score contribution map (`flow`, `tech`, `positioning`,
`news`, `smart_money`, etc. — `scorer.ts`), and its own type comment says it was added "so the
terminal can show real factor bars … instead of only iv_rank/rr_ratio." `PlaybookBriefingPanel.tsx`
already renders it as "Score components" chips in the member-facing terminal, sorted by magnitude.

But `formatPlayBlock` (the LLM's data block, `play-explainer.ts`) and
`buildGroundedPlayExplanationFallback` (the no-LLM deterministic fallback,
`play-explainer-fallback.ts`) never included it. So the one section explicitly promising to explain
"why ranked #N" across flow/technicals/positioning/etc. could only draw on qualitative dossier
prose, never the actual quantified score drivers already computed for that exact play — the same
numbers a member sees two clicks away in the "Score components" tab.

This is the same defect class as the 2026-09-13 fix for `earnings_risk`/`gate_promoted` (see
`docs/audit/findings-staging/2026-09-13-play-explainer-risk-signals-not-surfaced.md`): a real,
already-computed signal silently absent from a narrative section that explicitly claims to cover it.

### Fix

Added `factorBreakdownLines()` to `play-explainer-fallback.ts` — non-zero `factor_breakdown`
entries, sorted by magnitude descending, `"key: +N"`/`"key: -N"` — deliberately matching
`PlaybookBriefingPanel.tsx`'s own `scoreComponents()` filter/sort exactly, so the narrative cites
the same ranked-by-impact ordering a member already sees in the UI rather than an independent
re-derivation that could drift.

Wired into both:
- `formatPlayBlock` (LLM data block) — a new `Score components (largest impact first):` line.
  Since `factor_breakdown` is a genuinely computed fact (not invented), this only *widens* the
  known-numbers set the grounding guard checks the LLM's output against — it cannot weaken the
  fabrication guard, same property the 2026-09-13 fix already established for risk lines.
- `buildGroundedPlayExplanationFallback` (no-LLM fallback) — a `Score drivers (largest impact
  first): …` line appended to the "Why ranked #N" section.

### Evidence / regression tests

4 new tests in `play-explainer.test.ts`: `factorBreakdownLines` correctly drops zero-contribution
entries and sorts by magnitude; sign formatting (`+14` / `-5`); the fallback's "Why ranked" section
includes the score-drivers line when `factor_breakdown` is present and omits it entirely when
absent (never a fabricated empty line).

RED→GREEN proven via `git stash` of the fix-only diff (`play-explainer.ts` +
`play-explainer-fallback.ts`, test file kept): 9/13 pass pre-fix (4 new tests fail), 13/13 pass
post-fix. `tsc --noEmit` clean.

### Blast radius

- Both the LLM "Full Hawk Intel" briefing and its no-LLM fallback now have access to the same
  quantified score drivers already shown in the terminal's "Score components" UI — no other
  consumer of `factor_breakdown` (scorer.ts, deterministic-edition.ts, adapters.ts,
  PlaybookBriefingPanel.tsx, containers.tsx, ZeroDteBoard.tsx) is touched.
- `resolveDossierContext`/`formatMarketRecapBlock` unchanged.

### What was deliberately left unchanged

`factor_breakdown`'s own computation (`scorer.ts`) and the terminal's "Score components" chip UI
(`PlaybookBriefingPanel.tsx`) are untouched — this fix only makes the narrative-generation layer
aware of data that already existed and was already trusted elsewhere.
