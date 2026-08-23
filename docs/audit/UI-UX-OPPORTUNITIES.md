# UI-UX-OPPORTUNITIES — the backlog

**Lane:** UI/UX & Product Experience (owner), per `docs/agents/briefs/ui-ux.md` item 16: "maintain
a backlog for larger ideas that aren't yet a PR — so a discovery doesn't disappear just because it
wasn't immediately implemented." Living document, updated as ideas surface and as they're either
shipped (move to a PR / `FINDINGS.md`, cross out here) or deliberately declined (say why, keep the
line so it isn't rediscovered from scratch).

This is distinct from `docs/audit/UI-UX-MAP.md` (the inventory of what exists) and
`docs/audit/findings-staging/` (confirmed defects with a code fix in flight). This file is for
ideas that are real but not yet scoped into either — a redesign direction, a missing interaction,
a pattern worth generalizing. Classify with the brief's own scale:

- **P0** — broken/confusing (usually belongs in `UI-UX-MAP.md`'s findings table or
  `findings-staging/` instead, once confirmed — see that file's §10 for the current candidates)
- **P1** — major UX problem
- **P2** — high-value enhancement
- **P3** — experimental interaction

---

## Open ideas

1. **[P2] Cross-product ticker/context carryover in the nav switcher.** `UI-UX-MAP.md` §1.1: the
   "Features" dropdown that switches between all 7 products is a set of bare static links — moving
   from Helix (viewing NVDA) to Thermal does not deep-link NVDA. A member investigating one name
   across products has to re-search on every switch. Needs a design for what "context" even means
   across products with different primary entities (a ticker on Helix/Thermal/Vector/Meridian vs.
   an engine tab on Night Hawk) before this is buildable — not a small fix, a real design question.

2. **[P2] A shared freshness/status badge component.** `UI-UX-MAP.md` §10 catalogs 4+ different
   visual forms for "how old is this data" across Helix, Thermal, Vector, Meridian, and Largo.
   Largo's per-subsystem "● HELIX ● THERMAL ● VECTOR ● NIGHT HAWK ● SLAYER ● 0DTE  5/6 ONLINE" row
   is the best existing example — worth studying as the starting point rather than designing from
   scratch. Needs a live-market pass first to see every product's "fresh" state, not just this
   pass's closed-market ones.

3. **[P2] iOS's Flow↔Thermal segment control has no equivalent for the other 5 products or on
   web.** `IosIntelligenceHubSegment` proves the pattern works (client-side product switch, no full
   navigation) but only covers 2 of 7 products and only inside the native shell. Worth asking
   whether it generalizes to Vector/Meridian/Night Hawk/SPX Slayer/Largo, and whether a desktop-web
   equivalent (not just iOS) is warranted given brief item 10's cross-product investigation
   standard.

4. **[P2] SPX Slayer's Vector/Matrix/Intel single-panel tabs vs. a true multi-panel desktop
   layout.** Once `UI-UX-MAP.md` §2's P0 (blank left column) is root-caused, there's a design
   question sitting behind the bug fix: should desktop SPX Slayer show all three panels at once
   (matching the multi-panel composition `SpxDashboard.tsx` actually wires up) rather than
   single-panel tabs borrowed from the compact/native layout? That's a bigger call than the bug fix
   and belongs here until it's decided, not folded silently into the P0 fix PR.

5. **[P3] Night Hawk's empty state on a no-session day leaves ~45% of the mobile viewport
   blank.** (`UI-UX-MAP.md` §7.) Candidate content for that space: recent closed plays, a teaser
   for the other 3 engine tabs (Swings/Bangers/Legacy), or a countdown to the next session. Not
   urgent — it's not broken, just under-used space on a day with genuinely nothing to show.

6. **[P3] A shared chart-footer-legend component to prevent the overlap bug from recurring.**
   `UI-UX-MAP.md` finding #3 is confirmed on `/vector` mobile; whether it also affects `/dashboard`
   desktop (same `VectorChart.tsx` via `SpxVectorEmbed`) is still an open question pending a
   chart-loaded re-check. If it does turn out to affect both, the larger opportunity is auditing
   whether other embeds of the same component (any future ones) inherit the same footer-legend
   layout logic, so a fix to the shared component doesn't need to be re-verified per embed site by
   hand each time.

7. **[DONE, 2026-08-23] `proxy-browser.cjs` now warns loud when `--viewport` implies desktop but
   `--desktop` is omitted.** This Phase 0 pass shipped 8 desktop findings built on the wrong UA
   (`docs/audit/UI-UX-MAP.md`'s top-of-file correction) because the script's own doc comment warned
   about this exact trap but nothing enforced it — a viewport of `1440x900` silently rendering with
   `isMobile:true` and the `BlackOutiOSApp` UA is a footgun the tool handed every user of it, on
   every lane, not just this one. Fixed in the same PR as this file's correction pass: `mobileUaWarning()`
   in `proxy-browser.cjs` prints a loud stderr warning (not a hard refusal — an intentional
   mobile-UA-at-wide-viewport shot is rare but legitimate) when width ≥ 1024px is passed without
   `--desktop`. Unit-tested in `proxy-browser.test.mjs`. Kept here rather than deleted so the next
   reader can see WHY the warning exists, not just that it does.

---

## Declined / deferred

*(none yet)*
