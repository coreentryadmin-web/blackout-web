> **kind:** FINDING

## Night Hawk session-analytics panel pushed the whole play ledger below the fold on mobile — FIXED

| **Status** | Fixed in PR (fix/nighthawk-collapse-analytics-panel) |
|---|---|

**Symptom:** Member screenshot (2026-08-28, mobile) showed the `/nighthawk` 0DTE deck opening
directly onto the "Session analytics" panel (win-rate/avg-return/graded/session-P&L tiles + by-merit-tier
bars + by-exit-outcome bars + a session P&L curve) — the live play ledger (OPEN/WATCH/CLOSED tabs
and the play cards, rendered by `CommandDeck`) was entirely below the fold, requiring a scroll past
the whole analytics section before any play was visible. Member described it as "literally blocking
the play panels fully."

**Root cause:** `NighthawkAnalyticsPanel` (added by the 2026-08-XX Night Hawk UI redesign) always
rendered its full contents — 4 stat tiles, a 2-3 column bar-chart grid, and a `recharts` P&L curve
— unconditionally above `CommandDeck` in `containers.tsx`. That is a reasonable amount of content on
a wide desktop viewport but stacks to several screen-heights on a phone, and there was no way to
collapse it.

**Fix:** `NighthawkAnalyticsPanel.tsx` now defaults to a collapsed state — a single tappable summary
row (`Session analytics · Win X% · Y% avg · tap to expand`) with a chevron, `aria-expanded`, and
`aria-controls` on a real `<button>`. Tapping it reveals the full tiles/grid/curve exactly as
before. The choice persists per-device via `localStorage` (`nh-analytics-collapsed`), read/written
best-effort so a blocked/private-mode store just keeps the safe collapsed default. New CSS in
`globals.css` (`.nh-analytics-toggle`, `.nh-analytics-panel-collapsed`, `.nh-analytics-chevron*`).

**Blast radius:** `NighthawkAnalyticsPanel.tsx` only — `CommandDeck`/the play ledger itself is
untouched (it was never actually narrowed, just pushed down by the panel above it; the "full width"
part of the report was this panel eating the screen, not a real width regression in the ledger).

**Evidence:** New `NighthawkAnalyticsPanel.test.ts` (3 tests, SSR via `renderToStaticMarkup` + SWR's
`fallback` cache seed for a synchronous first render) asserts the full tier/outcome/curve sections
do NOT reach the first render, that the collapsed summary text and a real accessible toggle button
do. `npx tsc --noEmit` clean; full `src/features/nighthawk/{components,lib}` + `command-deck` suite
(396 tests) green on Node 20.
