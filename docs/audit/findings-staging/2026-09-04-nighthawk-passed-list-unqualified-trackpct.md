## 2026-09-04 — [FINDING, P1 UI trust] Night Hawk's compact play-list row never renders the "Since flag"/"Peak Return" qualifier — a never-entered PASSED play's hypothetical return reads as achieved P&L — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P1 UI trust (misleading outcome, no data corruption) |
| **Surface** | `src/features/nighthawk/command-deck/PlayLifecycleCard.tsx` (`PlayLifecycleCardBody`) |
| **Status** | FIXED |

### Root cause

A member screenshotted the mobile 0DTE PASSED tab: 12 top rows with huge unqualified green
"+PNL%" numbers (one board showed +463%-class figures) and asked why none of these "winning
plays" ever moved to OPEN. They never did, because SKIP/PASSED rows were never entered — the
number shown was `trackPct`, a purely hypothetical "how would this have moved since it was
flagged" tracking figure (`play-card-lifecycle.ts`'s `playListReturnPct`, `phase === "watch"`
branch — `isWatchTrackStatus` covers both WATCH and SKIP), not realized or even achievable P&L.

The distinction already existed correctly in the data layer: `play-card-display.ts`'s
`primaryReturnLabel(play)` returns `"Since flag"` for any watch/SKIP row and `"Peak Return"` for
a CLOSED row, specifically so the number is never mistaken for live P&L. `CommandDeck.tsx` even
has a rendering branch that calls it (lines ~832-903) — but that branch is **dead code**:
`useLifecyclePlayCard` (`play-card-display.ts:89`) unconditionally returns `true`, so every play
on every board renders through the OTHER branch, `PlayLifecycleCardBody`
(`PlayLifecycleCard.tsx`), which computes the same number via `playListReturnPct` and renders it
raw — no label, no qualifier, just a green/red colored `+N%` — for every status including
WATCH/SKIP/CLOSED. This is the same bug CLASS as the 2026-08-11 incident already documented in
`play-card-lifecycle.ts` (SKIP rendering as "FAILED"/loss-red for a never-entered play), just
flipped from a false-loss implication to a false-win one, and on a different, newer component
that was never updated to carry the same protection.

### Evidence

Added `"watch compact row shows track and rank"` assertion + a new
`'SKIP ("PASSED") compact row labels its return as hypothetical, not P&L'` test in
`CommandDeck.ssr.test.ts`. Pre-fix (verified via `git stash` on `PlayLifecycleCard.tsx` alone):
both fail — the SSR HTML for a SKIP row with `trackPct: 463` renders
`<span class="nh-deck-play-pnl">+463%</span>` with no adjacent label anywhere in the row.
Post-fix: both pass, full `CommandDeck.ssr.test.ts` 10/10, full
`command-deck/*.test.ts` 361/361, `tsc --noEmit` clean.

### Fix

`PlayLifecycleCardBody` now renders `primaryReturnLabel(play)` (already correct, already
unit-covered, just never called from this component) in a `.nh-deck-premlab` span beside the
return figure, same class CommandDeck's own dead branch already used — no new CSS. Applies
uniformly: WATCH/SKIP get "Since flag", CLOSED gets "Peak Return", everything else keeps the
existing "P&L" label. No change to any underlying number, gate, or trading logic — this is a
label-only fix; the numbers themselves were always correctly computed, just never captioned.

### Blast radius

Checked for a second call site of the same unlabeled pattern: none found — `PlayLifecycleCard.tsx`
is the only component `CommandDeck.tsx` and `NighthawkPageShell.tsx` route play rows through
(`useLifecyclePlayCard` always true, so the legacy branch is unreachable in practice; left as-is,
not deleted — out of scope for a label fix). The Legacy-desk / SPX-desk detail panels
(`ZeroDteBoard.tsx`) already carry their own explicit chase-guard/status explanations checked
earlier this session and are unaffected.

### What was deliberately NOT changed

Also investigated, per the same "keep going" request, whether the G-3 `ZERODTE_SCORE_FLOOR=65`
gate is itself over-blocking good plays into PASSED instead of OPEN. Pulled a fresh
`/api/market/zerodte/record?days=90` live sample: the server's own `by_score_band` aggregate
shows the 55-64 band (n=27) currently *outperforming* the 65+ population (n=308) — on its face a
case for lowering the floor. Traced further: `scoreForBanding` bands legacy pre-context rows by
`score_max` (ratcheted peak) rather than commit-time score, so 19 of those 27 rows never actually
committed in 55-64 at all. Of the true commit-time-scored population, only 8 rows in the entire
90-day window ever committed with a real score in 55-64 (plus 6 more <55) — and every one of them
is dated 2026-08-25, the exact single-day incident `gates.ts`'s own comment already documents (a
temporarily-lowered floor let weak BREAKOUT-only names through while blocking 90 stronger
candidates; restored to 65 same day). There is no live population since that day to judge the
floor against. **No gate changed** — the one dataset that ever tested a lower floor is the exact
evidence that justified raising it back to 65, so this is "still correctly set, not demonstrated
wrong," not "confirmed correct forever." A dedicated forward-looking measurement (shadow-logging
would-be 55-64 commits without committing them) is the only way to actually re-test this and was
not built this session — flagged as a follow-up, not started.
