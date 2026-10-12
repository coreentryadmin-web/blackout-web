## 2026-10-12 — [FINDING, P3 UI/a11y] `MeridianBeatHistory` rendered every row as a permanently-disabled button — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Meridian desk / earnings visualization | P3 — non-interactive markup wearing a control's semantics | FIXED |

**What's wrong.** `src/features/meridian/components/meridian-viz.tsx`'s `MeridianBeatHistory`
(the earnings track-record row list on the History/Report tabs) accepted an `onSelect?: (p:
PrintLike) => void` prop and rendered every row as a real `<button disabled={!onSelect}>`. Neither
of its two real call sites — `MeridianEarningsHistoryPanel.tsx:66` and
`MeridianEarningsReportPanel.tsx:270` — has ever passed `onSelect` (`git log -S"onSelect" --
src/features/meridian/components/meridian-viz.tsx` shows the prop unwired since the component's
introduction, commit `ab30af1d8`). So every row was always a `<button disabled>`: real interactive
markup for a control that can NEVER be activated — no click, no keyboard focus, nothing a
`disabled` state would ever lift.

**Exactly the same bug, already fixed twice in this same file for its siblings.**
`MeridianTargetRail`'s `onTargetClick` and `MeridianDarkPoolTape`'s `onPrintClick` carry the
identical "neither call site passes a handler" shape, and both were already fixed (citing
`UI-UX-OPPORTUNITIES.md` item 13 and `meridian-interaction-audit.mjs`'s button/`[role=button]`
selector, which is what originally caught them): render a plain `<span>` when no handler is passed,
a real `<button type="button">` only when one is. `MeridianBeatHistory` simply never got the same
treatment when those two were fixed.

**Fix.** Mirrors the established sibling pattern exactly: `MeridianBeatHistory` now branches on
`!onSelect || !prints` to render either a `<span className="mv-beat-row">` (no handler) or a real
`<button type="button" className="mv-beat-row" onClick={...}>` (handler present), sharing the row's
inner content via a local `rowChildren` fragment so the two branches can't drift apart visually.

**CSS caught in the same pass.** `.mv-beat-row`'s existing rules (`cursor: pointer` unconditionally,
`:hover:not(:disabled)`) assumed every row was always a button that was sometimes `disabled`. Once
the no-handler case is a `<span>` (which the `:disabled` pseudo-class never matches), those rules
would have made the non-interactive row claim pointer/hover affordance it doesn't have — the exact
inconsistency the sibling `.mv-target-dot[type="button"]` split was already written to avoid.
Rescoped `.mv-beat-row`'s cursor/hover rules to the `[type="button"]` attribute selector, matching
`.mv-target-dot` exactly.

**Test.** New `meridian-viz-beat-history-tap-target.test.ts` (source-scan, matching this file's
existing `meridian-viz-freshness.test.ts` convention — no React render harness in this codebase for
this component). RED→GREEN proven via `git stash`: 3/3 fail pre-fix, 3/3 pass post-fix.

**Verification.** `tsc --noEmit` clean. Full Meridian feature suite (`npx tsx
--experimental-test-module-mocks --test $(find src/features/meridian -name "*.test.ts" -o -name
"*.test.tsx")`) — 50/50 pass.

**Blast radius.** `meridian-viz.tsx` (`MeridianBeatHistory` only) + `desk-app.css` (`.mv-beat-row`
rule block) + the new test file. No change to either real call site — both already render
`<MeridianBeatHistory prints={...} />` with no `onSelect`, and continue to.

Found via a background Explore-agent sweep of Meridian's UI/component layer, independently
re-verified before fixing: confirmed both real call sites never pass `onSelect` via grep, confirmed
the prop has been dead since the component's introduction via `git log -S`, and confirmed the exact
sibling fix precedent (`MeridianTargetRail`/`MeridianDarkPoolTape`) already live in the same file.
