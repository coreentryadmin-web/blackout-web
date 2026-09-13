> **kind:** FINDING

## Ask Largo's Structure Ladder / risk read was invisible on mobile for Night Hawk Swings — fix/swing-largo-mobile-visibility — 2026-09-13

- **What was broken (operator direct report, live 2026-09-13):** the operator compared our Swing
  play detail against a competitor's ("Talon") full-screen structural readout and said "when I
  click a play... I still don't get it" — on their phone, tapping a Swing play opened the position
  stats but never showed the Ask Largo intelligence panel (Structure Ladder, gatekeeper tags,
  "Risk — the other side" callout) at all. Root cause traced in `src/app/globals.css`: the desktop
  3-column layout's Largo rail (`.nh-deck-largo`, rendered by `SwingLargoInsightsPanel` inside
  `CommandDeck.tsx`) is unconditionally `display:none` below the 1100px 3-column breakpoint
  (`@media (max-width:1100px){.nh-deck--swing-largo .nh-deck-largo{display:none}}`), and
  `PlayTerminal.tsx` — the component that renders the mobile "tap a play" full-screen detail
  overlay (`.nh-deck-right`, shown via `data-mobile-view="detail"` at ≤820px per the existing
  mobile-stacked-layout CSS) — never rendered `SwingLargoInsightsPanel` at all. So any member on a
  phone or a narrow tablet (anything under 1100px) genuinely could not reach the Structure Ladder,
  the gatekeeper annotations, or the risk-the-other-side callout for a Swing play — not a rendering
  bug, a total reach gap for that entire viewport range.
- **What changed:** `PlayTerminal.tsx` now mounts a second `SwingLargoInsightsPanel` for
  `play.horizon === "SWING"`, wrapped in `.nh-deck-right-largo-mobile`, positioned at the top of
  the Swing command section (above `ZeroDteCommandPanel`) inside the mobile detail overlay.
  `globals.css` gates it the opposite way from the desktop rail — hidden by default, shown only
  below 1100px, with a 3-class override selector (`.nh-deck--swing-largo .nh-deck-right-largo-mobile
  .nh-deck-largo`) that beats the existing 2-class hide rule on specificity regardless of source
  order, so the desktop copy is never duplicated and the mobile copy is never hidden by the same
  rule that hides the desktop one. Same component, same `useSwingPlayBrief` SWR cache key as the
  desktop rail — no extra fetch, no new data path, purely a visibility/placement fix.
- **Test gap this exposed:** `PlayTerminal.ssr.test.ts` renders under raw `renderToStaticMarkup`
  with no App Router context — `SwingLargoInsightsPanel`'s `useRouter()` call (for its follow-up
  chip links) threw `invariant expected app router to be mounted` the moment it was mounted a
  second time from `PlayTerminal`. Mocked `next/navigation`'s `useRouter` in the test file (this
  harness never needed it before, since `CommandDeck.ssr.test.ts` — the only other place
  `SwingLargoInsightsPanel` mounts — has never actually exercised the SWING+commandCenter
  combination that triggers this component). Production is unaffected: every real page provides a
  genuine App Router context.
- **Evidence:** `PlayTerminal.ssr.test.ts` — 3 new tests (mobile fallback mounts for SWING,
  absent for ZERO_DTE, absent for LEGACY), RED confirmed pre-fix (`git stash` on `PlayTerminal.tsx`
  alone) then GREEN post-fix, 23/23 passing. Full suite 14052/14052 pass, `tsc --noEmit` clean.
- **Not attempted here:** a full visual redesign of the ladder/rails to match the competitor's
  layout more closely (targets table styling, plain-language structural narrative, a possible
  "moonshot" far-dated tier) — this fix is scoped to the pure reach gap (mobile members could not
  see the feature at all); further presentation/design iteration is a separate, ongoing pass.

| **Status** | Fixed — PR opened, CI pending |
